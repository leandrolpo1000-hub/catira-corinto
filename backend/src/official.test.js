const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const official = require('./official');
const social = require('./listingSocial');
const action = require('./action');
const { authOptional } = require('./middleware');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function expectStatus(fn, status, label) {
  try {
    fn();
  } catch (err) {
    assert.strictEqual(err.status, status, label + ' (status ' + err.status + ')');
    return;
  }
  assert.fail(label + ' deveria lançar erro ' + status);
}

function cleanup(ids) {
  (ids.offers || []).forEach((id) => db.remove('officialProductOffers', id));
  (ids.products || []).forEach((id) => {
    const row = db.findById('officialProducts', id);
    if (row && row.listingId) db.remove('listings', row.listingId);
    db.remove('officialProducts', id);
  });
  (ids.listings || []).forEach((id) => db.remove('listings', id));
}

async function run() {
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  assert.ok(joao && maria, 'usuários demo');
  const cat = db.findOne('categories', () => true);
  const city = db.findOne('cities', () => true);
  assert.ok(cat && city, 'categoria e cidade demo');

  const ids = { products: [], offers: [], listings: [] };

  try {
    // Identidade institucional oculta e idempotente.
    const seller = official.ensureOfficialSeller();
    assert.strictEqual(official.ensureOfficialSeller().id, seller.id, 'vendedor oficial é único');
    assert.strictEqual(seller.role, official.PLATFORM_ROLE, 'papel institucional');
    assert.strictEqual(seller.profileHidden, true, 'perfil oculto');
    assert.ok(official.isPlatformUser(seller), 'reconhece a plataforma');

    // Preço comercial: manual vence o cálculo; custo/margem separados.
    assert.strictEqual(
      official.computePrice({ costPrice: 100, marginValue: 20, pricingRule: 'fixed' }),
      120,
      'custo + margem fixa'
    );
    assert.strictEqual(
      official.computePrice({ costPrice: 100, marginValue: 10, pricingRule: 'percent' }),
      110,
      'custo + margem percentual'
    );
    assert.strictEqual(
      official.computePrice({ costPrice: 100, marginValue: 20, manualPrice: 99 }),
      99,
      'preço manual vence o cálculo'
    );

    // Produto nasce sem oferta: fora do catálogo.
    const created = official.createProduct(
      {
        title: '[TESTE] Cafeteira oficial',
        description: 'Produto de teste do catálogo oficial.',
        categoryId: cat.id,
        condition: 'novo',
        costPrice: 100,
        pricingRule: 'fixed',
        marginValue: 30,
        published: true,
        cityId: city.id,
        city: city.name,
        delivery: { mode: 'cities', cityIds: [city.id] },
      },
      { id: seller.id }
    );
    const product = created.product;
    const listing = created.listing;
    assert.ok(product && listing, 'materializado em listings');
    ids.products.push(product.id);
    assert.strictEqual(product.available, false, 'sem oferta confiável fica indisponível');
    assert.strictEqual(listing.status, 'paused', 'anúncio pausado sem oferta');
    assert.strictEqual(listing.origin, 'official', 'origem marcada');
    assert.strictEqual(listing.protected, true, 'protegido');

    // Oferta externa manual entra no catálogo.
    const up = official.upsertOffer(
      product.id,
      { provider: 'mercadolivre', price: 149.9, url: 'https://www.mercadolivre.com.br/p/1', stock: 5 },
      { id: seller.id }
    );
    ids.offers.push(up.offer.id);
    const refreshed = db.findById('officialProducts', product.id);
    assert.strictEqual(refreshed.available, true, 'oferta ativa publica o produto');
    assert.strictEqual(db.findById('listings', listing.id).status, 'published', 'anúncio publicado');
    assert.ok(official.offerIsLive(up.offer, Date.now()), 'oferta manual é considerada ativa');

    // Serialização institucional: sem vendedor real, sem interações sociais.
    const serialized = require('./helpers').serializeListing(db.findById('listings', listing.id), {
      userId: maria.id,
      user: maria,
    });
    assert.strictEqual(serialized.isOfficial, true, 'marcado como oficial');
    assert.strictEqual(serialized.seller, null, 'sem vendedor pessoa física');
    assert.strictEqual(serialized.socialEnabled, false, 'sem interações sociais');
    assert.strictEqual(serialized.price, 130, 'preço comercial calculado');
    assert.strictEqual(serialized.officialOffers.length, 1, 'ofertas expostas');

    // Oferta processada expira conforme staleness.
    const staleOffer = official.upsertOffer(
      product.id,
      { provider: 'shopee', price: 120, url: 'https://shopee.com.br/p/1', stock: 1, source: 'process' },
      { id: seller.id }
    );
    ids.offers.push(staleOffer.offer.id);
    const staleRow = db.findById('officialProductOffers', staleOffer.offer.id);
    assert.ok(official.offerIsLive(staleRow, Date.now()), 'sincronizada recente é ativa');
    assert.strictEqual(
      official.offerIsLive(staleRow, Date.now() + (official.STALE_HOURS + 1) * 3600000),
      false,
      'sincronizada vencida sai do catálogo'
    );

    // Oferta suspensa remove a fonte do catálogo.
    official.upsertOffer(
      product.id,
      { provider: 'mercadolivre', price: 149.9, url: 'https://www.mercadolivre.com.br/p/1', stock: 0, status: 'suspended' },
      { id: seller.id }
    );
    official.upsertOffer(
      product.id,
      { provider: 'shopee', price: 120, url: 'https://shopee.com.br/p/1', stock: 1, status: 'suspended', source: 'process' },
      { id: seller.id }
    );
    assert.strictEqual(db.findById('officialProducts', product.id).available, false, 'todas suspensas pausam o produto');

    // Reativa a oferta para os testes de busca.
    official.upsertOffer(
      product.id,
      { provider: 'mercadolivre', price: 149.9, url: 'https://www.mercadolivre.com.br/p/1', stock: 5 },
      { id: seller.id }
    );

    // Anúncio convencional do mesmo termo para ordenação.
    const now = new Date().toISOString();
    const regular = db.insert('listings', {
      userId: joao.id,
      title: '[TESTE] Cafeteira usada',
      description: 'Item de teste para ordenação da busca.',
      categoryId: cat.id,
      subcategory: '',
      price: 80,
      condition: 'usado',
      city: city.name,
      cityId: city.id,
      listingType: 'venda',
      acceptsTrade: false,
      acceptsCash: true,
      tradeWishes: '',
      status: 'published',
      featured: false,
      vip: false,
      premium: false,
      views: 0,
      createdAt: now,
      publishedAt: now,
    });
    ids.listings.push(regular.id);

    const app = express();
    app.use(express.json());
    app.use(authOptional);
    app.use('/api/listings', require('./routes/listings'));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));

    try {
      // Busca encontra o produto oficial.
      const found = await get(server, '/api/listings?q=cafeteira&limit=48');
      assert.ok(found.items.some((i) => i.id === listing.id), 'busca acha o produto oficial');

      // Ordenação secundária: anúncio de usuário antes do oficial.
      const ri = found.items.findIndex((i) => i.id === regular.id);
      const oi = found.items.findIndex((i) => i.id === listing.id);
      assert.ok(ri >= 0 && oi >= 0, 'ambos aparecem');
      assert.ok(ri < oi, 'anúncio convencional vem antes do oficial');

      // Oferta externa ignora a cobertura Catira.
      const inCity = await get(server, '/api/listings?city=' + encodeURIComponent(city.id) + '&limit=48');
      assert.ok(inCity.items.some((i) => i.id === listing.id), 'aparece na cidade coberta');
      const externalCity = await get(server, '/api/listings?city=inexistente&limit=48');
      assert.ok(externalCity.items.some((i) => i.id === listing.id), 'oferta externa ignora cobertura');

      // Cobertura só restringe quando a compra é interna (Catira).
      official.upsertOffer(
        product.id,
        { provider: 'catira', price: 135, url: '', stock: 2 },
        { id: seller.id }
      );
      const otherCity = await get(server, '/api/listings?city=inexistente&limit=48');
      assert.ok(!otherCity.items.some((i) => i.id === listing.id), 'fora da cobertura não aparece na compra interna');
      const coveredCity = await get(server, '/api/listings?city=' + encodeURIComponent(city.id) + '&limit=48');
      assert.ok(coveredCity.items.some((i) => i.id === listing.id), 'dentro da cobertura aparece');

      // Cobertura nacional.
      official.updateProduct(product.id, { delivery: { mode: 'all', cityIds: [] } }, { id: seller.id });
      const national = await get(server, '/api/listings?city=inexistente&limit=48');
      assert.ok(national.items.some((i) => i.id === listing.id), 'cobertura nacional aparece em qualquer cidade');

      // Fora das seções da home e de trocas/procuro.
      const section = await get(server, '/api/listings?section=recentes&limit=48');
      assert.ok(!section.items.some((i) => i.id === listing.id), 'não entra nas seções da home');
      const homeFeed = await get(server, '/api/listings?home=1&limit=48');
      assert.ok(!homeFeed.items.some((i) => i.id === listing.id), 'não entra no feed editorial da home');
      const homeCity = await get(server, '/api/listings?home=1&city=' + encodeURIComponent(city.id) + '&limit=48');
      assert.ok(!homeCity.items.some((i) => i.id === listing.id), 'não entra no feed da home filtrado por cidade');
      const trade = await get(server, '/api/listings?acceptsTrade=true&limit=48');
      assert.ok(!trade.items.some((i) => i.id === listing.id), 'não entra em trocas');
      const procuro = await get(server, '/api/listings?type=procuro&limit=48');
      assert.ok(!procuro.items.some((i) => i.id === listing.id), 'não entra em procuro');

      // Vendedor oficial não aparece em sugestões de anunciantes.
      assert.ok(!section.sellers.some((s) => s.id === seller.id), 'plataforma oculta das sugestões');
    } finally {
      await new Promise((r) => server.close(r));
    }

    // Bloqueios server-side de interação social.
    expectStatus(() => social.toggleLike(maria, listing.id), 403, 'curtir bloqueado');
    expectStatus(
      () => social.addComment(maria, listing.id, { text: 'oi' }),
      403,
      'comentar bloqueado'
    );
    expectStatus(
      () => require('./trades').createTrade(maria, { listingId: listing.id, description: 'Troco por bicicleta' }),
      403,
      'proposta de troca bloqueada'
    );
    await assert.rejects(
      () => action.createPost(seller, { listingId: listing.id, text: 'Produto oficial no em ação' }, [{}], null),
      (err) => err.status === 403,
      'publicação da plataforma bloqueada no em ação'
    );
    assert.strictEqual(
      action.eligibleListings(seller).length,
      0,
      'produto oficial não é elegível ao em ação'
    );

    // Fase 2A: gestão de ofertas externas.
    expectStatus(
      () => official.upsertOffer(product.id, { provider: 'amazon', price: 10, url: 'javascript:alert(1)' }, { id: seller.id }),
      400,
      'URL perigosa bloqueada'
    );
    expectStatus(
      () => official.upsertOffer(product.id, { provider: 'amazon', price: 10, url: 'ftp://amazon.com/x' }, { id: seller.id }),
      400,
      'esquema não http bloqueado'
    );
    expectStatus(
      () => official.upsertOffer(product.id, { provider: 'amazon', price: 199, url: '' }, { id: seller.id }),
      400,
      'oferta ativa sem URL bloqueada'
    );
    const amazon = official.upsertOffer(
      product.id,
      { provider: 'amazon', price: 210, previousPrice: 250, url: 'https://www.amazon.com.br/dp/smoke', stock: 4 },
      { id: seller.id }
    );
    ids.offers.push(amazon.offer.id);
    const shopee = official.upsertOffer(
      product.id,
      { provider: 'shopee', price: 205, url: 'https://shopee.com.br/p/smoke' },
      { id: seller.id }
    );
    ids.offers.push(shopee.offer.id);
    const listed = official.serializeProduct(official.productOf(product.id));
    assert.ok(listed.offers.length >= 3, 'múltiplas ofertas no mesmo produto');
    const publicLive = official.publicOffersOf(product.id);
    assert.ok(publicLive.every((o) => o.url && official.isSafeHttpUrl(o.url)), 'comprador só vê URL válida');
    assert.ok(publicLive.every((o) => o.provider !== 'catira'), 'checkout interno não entra em Onde comprar');

    const edited = official.updateOffer(
      product.id,
      amazon.offer.id,
      { price: 189.9, previousPrice: 210, note: 'preço conferido' },
      { id: seller.id }
    );
    assert.strictEqual(edited.offer.price, 189.9, 'edição altera só a oferta');
    assert.strictEqual(edited.offer.previousPrice, 210, 'preço anterior registrado');
    assert.strictEqual(db.findById('officialProducts', product.id).title, product.title, 'editar oferta não altera o produto');

    const suspended = official.setOfferStatus(product.id, amazon.offer.id, 'suspended', { id: seller.id });
    assert.strictEqual(suspended.offer.status, 'suspended');
    assert.ok(!official.publicOffersOf(product.id).some((o) => o.id === amazon.offer.id), 'suspensa some para o comprador');
    official.setOfferStatus(product.id, amazon.offer.id, 'manual', { id: seller.id });
    assert.ok(official.publicOffersOf(product.id).some((o) => o.id === amazon.offer.id), 'reativada volta ao comprador');

    const other = official.createProduct(
      {
        title: '[TESTE] Outro oficial',
        categoryId: cat.id,
        costPrice: 10,
        marginValue: 5,
        published: true,
        delivery: { mode: 'all', cityIds: [] },
      },
      { id: seller.id }
    );
    ids.products.push(other.product.id);
    const isolated = official.upsertOffer(
      other.product.id,
      { provider: 'mercadolivre', price: 40, url: 'https://www.mercadolivre.com.br/p/other' },
      { id: seller.id }
    );
    ids.offers.push(isolated.offer.id);
    assert.ok(!official.publicOffersOf(product.id).some((o) => o.id === isolated.offer.id), 'ofertas isoladas por produto');
    assert.strictEqual(
      official.publicOffersOf(other.product.id).every((o) => o.id === isolated.offer.id || o.provider === 'mercadolivre'),
      true,
      'segundo produto não herda ofertas do primeiro'
    );

    const logs = db.findWhere('officialAdminLogs', (l) => l.payload && l.payload.productId === product.id);
    assert.ok(logs.length > 0, 'alterações administrativas registradas');

    official.deleteProduct(other.product.id);
    ids.products = ids.products.filter((id) => id !== other.product.id);

    const appAdmin = express();
    appAdmin.use(express.json());
    appAdmin.use('/api/admin', require('./routes/admin'));
    const adminServer = http.createServer(appAdmin);
    await new Promise((r) => adminServer.listen(0, r));
    try {
      const denied = await new Promise((resolve, reject) => {
        const { port } = adminServer.address();
        const req = http.request(
          { host: '127.0.0.1', port, path: '/api/admin/official/products/' + product.id + '/offers', method: 'POST' },
          (res) => resolve(res.statusCode)
        );
        req.on('error', reject);
        req.end(JSON.stringify({ provider: 'amazon', url: 'https://www.amazon.com.br/x' }));
      });
      assert.ok(denied === 401 || denied === 403, 'rota administrativa protegida');
    } finally {
      await new Promise((r) => adminServer.close(r));
    }

    const mappedItem = {
      id: 'MLB1828680414',
      title: 'Controle Xbox Series S Lacrado',
      seller_id: 35204426,
      domain_id: 'MLB-GAMEPADS_AND_JOYSTICKS',
      condition: 'new',
      status: 'active',
      permalink: 'https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-series-s-lacrado-_JM',
      pictures: [{ secure_url: 'https://http2.mlstatic.com/D_938331-MLA45268824993_032021-O.jpg' }],
    };
    const first = official.importMappedMeli({
      item: mappedItem,
      descriptionPlain: 'Descrição ML',
      sale: { amount: 599.9, regular_amount: 699.9 },
      catalogId: 'MLB60968045',
      actor: { id: 'admin-test' },
    });
    ids.products.push(first.product.id);
    ids.offers.push(first.offer.id);
    assert.strictEqual(first.created, true, 'cria na primeira vez');
    assert.strictEqual(first.product.published, false, 'rascunho');
    assert.strictEqual(first.product.manualPrice, null, 'sem preço comercial');
    assert.strictEqual(first.product.costPrice, 0, 'sem custo');
    assert.strictEqual(first.product.meliItemId, 'MLB1828680414');
    assert.strictEqual(first.product.meliCatalogId, 'MLB60968045');
    assert.strictEqual(first.listing.status, 'paused', 'listing pausado');
    assert.strictEqual(first.offer.provider, 'mercadolivre');
    assert.strictEqual(first.offer.source, 'process');
    assert.strictEqual(first.offer.externalId, 'MLB1828680414');
    assert.strictEqual(first.offer.price, 599.9);
    assert.strictEqual(first.offer.previousPrice, 699.9);
    assert.ok(!first.offer.stock, 'sem available_quantity não inventa estoque');

    const second = official.importMappedMeli({
      item: { ...mappedItem, title: 'Título novo ML' },
      descriptionPlain: 'Outra desc',
      sale: { amount: 580, regular_amount: 699.9 },
      actor: { id: 'admin-test' },
    });
    assert.strictEqual(second.created, false, 'não duplica');
    assert.strictEqual(second.product.id, first.product.id);
    assert.strictEqual(second.product.title, 'Título novo ML');
    assert.strictEqual(second.product.meliCatalogId, 'MLB60968045', 'segundo import preserva catalogId');
    assert.strictEqual(second.offer.price, 580);

    official.updateProduct(first.product.id, { manualPrice: 650, published: true });
    const priced = db.findById('officialProducts', first.product.id);
    assert.strictEqual(priced.manualPrice, 650);
    assert.strictEqual(priced.published, true);

    const synced = official.syncMappedMeli(first.product.id, {
      item: { ...mappedItem, title: 'Sync título', status: 'paused' },
      descriptionPlain: 'Sync desc',
      sale: { amount: 500, regular_amount: null },
      actor: { id: 'admin-test' },
    });
    assert.strictEqual(synced.product.title, 'Sync título');
    assert.strictEqual(synced.product.description, 'Sync desc');
    assert.strictEqual(synced.product.manualPrice, 650, 'sync não toca manualPrice');
    assert.strictEqual(synced.product.published, true, 'sync não toca published');
    assert.strictEqual(synced.offer.status, 'suspended');
    assert.strictEqual(synced.offer.price, 500);

    // Exclusão limpa ofertas e anúncio materializado.
    official.deleteProduct(product.id);
    ids.products = ids.products.filter((id) => id !== product.id);
    ids.offers = ids.offers.filter((id) => {
      const row = db.findById('officialProductOffers', id);
      return row && row.productId !== product.id;
    });
    assert.strictEqual(db.findById('officialProducts', product.id), null, 'produto removido');
    assert.strictEqual(db.findById('listings', listing.id), null, 'anúncio removido');
    assert.strictEqual(
      db.findWhere('officialProductOffers', (o) => o.productId === product.id).length,
      0,
      'ofertas removidas'
    );
  } finally {
    cleanup(ids);
  }

  console.log('OK official tests');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
