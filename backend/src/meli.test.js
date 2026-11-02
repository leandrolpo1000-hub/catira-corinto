const assert = require('assert');
const meli = require('./meli');

const ITEM = {
  id: 'MLB1828680414',
  title: 'Controle Xbox Series S Lacrado',
  seller_id: 35204426,
  domain_id: 'MLB-GAMEPADS_AND_JOYSTICKS',
  condition: 'new',
  status: 'active',
  permalink: 'https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-series-s-lacrado-_JM',
  pictures: [
    { secure_url: 'https://http2.mlstatic.com/D_938331-MLA45268824993_032021-O.jpg' },
    { url: 'http://http2.mlstatic.com/D_643476-MLA45268824996_032021-O.jpg' },
  ],
  attributes: [{ id: 'ITEM_CONDITION', value_name: 'Novo' }],
};

async function run() {
  assert.strictEqual(meli.parseItemId('MLB1828680414'), 'MLB1828680414');
  assert.strictEqual(meli.parseItemId('MLB-1828680414'), 'MLB1828680414');
  assert.strictEqual(
    meli.parseItemId('https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-_JM'),
    'MLB1828680414'
  );
  assert.strictEqual(
    meli.parseItemId('https://produto.mercadolivre.com.br/MLB-5885455180-kit-_JM'),
    'MLB5885455180'
  );
  assert.strictEqual(
    meli.parseItemId('https://www.mercadolivre.com.br/kit/p/MLB60968045?wid=MLB5885455180'),
    'MLB5885455180'
  );
  assert.strictEqual(
    meli.parseItemId('https://www.mercadolivre.com.br/kit/p/MLB60968045#wid=MLB5885455180&sid=offers'),
    'MLB5885455180'
  );
  const refWid = meli.parseImportRef('https://www.mercadolivre.com.br/kit/p/MLB60968045?wid=MLB5885455180');
  assert.deepStrictEqual(refWid, { itemId: 'MLB5885455180', catalogId: 'MLB60968045' });
  const refHash = meli.parseImportRef('https://www.mercadolivre.com.br/kit/p/MLB60968045#wid=MLB5885455180&sid=offers');
  assert.deepStrictEqual(refHash, { itemId: 'MLB5885455180', catalogId: 'MLB60968045' });
  const refPage = meli.parseImportRef('https://www.mercadolivre.com.br/controle/p/MLB60968045');
  assert.deepStrictEqual(refPage, { itemId: null, catalogId: 'MLB60968045' });
  const refClassic = meli.parseImportRef('https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-_JM');
  assert.deepStrictEqual(refClassic, { itemId: 'MLB1828680414', catalogId: null });
  let threw = false;
  let productPageErr;
  try {
    meli.parseItemId('https://www.mercadolivre.com.br/controle/p/MLB60968045');
  } catch (e) {
    threw = e.status === 400;
    productPageErr = e;
  }
  assert.ok(threw, 'página /p/ sem wid');
  assert.ok(/anúncio|vendedor|wid/i.test(productPageErr.message), productPageErr.message);
  threw = false;
  try { meli.parseItemId('javascript:alert(1)'); } catch (e) { threw = e.status === 400; }
  assert.ok(threw, 'URL insegura');
  threw = false;
  try { meli.parseItemId('https://shopee.com.br/p/1'); } catch (e) { threw = e.status === 400; }
  assert.ok(threw, 'não é MLB');
  threw = false;
  let catalogErr;
  try {
    meli.parseItemId('https://www.mercadolivre.com.br/semi-eixo-direito-gol-g5-fox-voyage-10-manual-2009-a-2021/up/MLBU3386616398');
  } catch (e) {
    threw = e.status === 400;
    catalogErr = e;
  }
  assert.ok(threw, 'catálogo MLBU');
  assert.ok(/catálogo|anúncio/i.test(catalogErr.message), catalogErr.message);

  assert.strictEqual(meli.mapCondition(ITEM), 'novo');
  assert.strictEqual(meli.mapCondition({ condition: 'used' }), 'usado');
  assert.strictEqual(meli.mapCondition({ attributes: [{ id: 'ITEM_CONDITION', value_name: 'Recondicionado' }] }), 'seminovo');

  assert.strictEqual(meli.mapCategorySlug(ITEM), 'tecnologia');
  assert.strictEqual(meli.mapCategorySlug({ domain_id: 'MLB-CARS_AND_VANS' }), 'veiculos');
  assert.strictEqual(meli.mapCategorySlug({ domain_id: 'MLB-UNKNOWN_WIDGETS' }), 'servicos');

  const imgs = meli.mapImages(ITEM);
  assert.strictEqual(imgs.length, 2);
  assert.ok(imgs[0].url.startsWith('https://'));
  assert.ok(imgs[1].url.startsWith('https://'));

  assert.strictEqual(meli.mapOfferStatus({ status: 'active' }), 'active');
  assert.strictEqual(meli.mapOfferStatus({ status: 'paused' }), 'suspended');
  assert.strictEqual(meli.mapOfferStatus({ status: 'closed' }), 'suspended');

  assert.deepStrictEqual(
    meli.mapSalePrice({ amount: 39200, regular_amount: 49000 }),
    { price: 39200, previousPrice: 49000 }
  );
  assert.deepStrictEqual(
    meli.mapSalePrice({ amount: 10, regular_amount: null }),
    { price: 10, previousPrice: null }
  );

  const ficha = meli.mapFicha(ITEM, 'Texto da descrição ML\nlinha 2');
  assert.strictEqual(ficha.meliItemId, 'MLB1828680414');
  assert.strictEqual(ficha.title, ITEM.title);
  assert.ok(ficha.description.includes('Texto da descrição'));
  assert.strictEqual(ficha.sellerId, 35204426);
  assert.strictEqual(ficha.permalink, ITEM.permalink);

  const PRODUCT = {
    id: 'MLB60968045',
    name: 'Principia Kit Essencial',
    domain_id: 'MLB-SKINCARE_KITS',
    permalink: 'https://www.mercadolivre.com.br/principia-kit/p/MLB60968045',
    pictures: [{ url: 'http://http2.mlstatic.com/D_1.jpg' }],
  };
  const RESULTS = [
    { item_id: 'MLB111', seller_id: 9, price: 200, original_price: 250, condition: 'new' },
    { item_id: 'MLB5885455180', seller_id: 518092731, price: 137.15, original_price: 211, condition: 'new' },
  ];
  const pickedWid = meli.pickCatalogItem(RESULTS, 'MLB5885455180');
  assert.strictEqual(pickedWid.item_id, 'MLB5885455180');
  const cheapest = meli.pickCatalogItem(RESULTS, null);
  assert.strictEqual(cheapest.item_id, 'MLB5885455180');
  assert.strictEqual(
    meli.catalogPermalink(PRODUCT.permalink, 'MLB5885455180'),
    'https://www.mercadolivre.com.br/principia-kit/p/MLB60968045?wid=MLB5885455180'
  );
  const mapped = meli.mapCatalogItem(PRODUCT, pickedWid);
  assert.strictEqual(mapped.id, 'MLB5885455180');
  assert.strictEqual(mapped.title, PRODUCT.name);
  assert.strictEqual(mapped.seller_id, 518092731);
  assert.ok(mapped.permalink.includes('wid=MLB5885455180'));
  assert.ok(!Object.prototype.hasOwnProperty.call(mapped, 'available_quantity'));
  const fichaCat = meli.mapFicha(mapped, 'Texto desc');
  assert.strictEqual(fichaCat.title, PRODUCT.name);
  assert.ok(fichaCat.images[0].url.startsWith('https://'));
  assert.deepStrictEqual(meli.mapCatalogSale(pickedWid), { amount: 137.15, regular_amount: 211 });
  const noLink = meli.mapCatalogItem({ ...PRODUCT, permalink: null }, pickedWid);
  assert.ok(/^https:\/\/www\.mercadolivre\.com\.br\/p\/MLB60968045\?wid=MLB5885455180/.test(noLink.permalink), noLink.permalink);

  const db = require('./db');
  db.all('meliAuth').slice().forEach((r) => db.remove('meliAuth', r.id));
  db.all('meliOauthStates').slice().forEach((r) => db.remove('meliOauthStates', r.id));

  const prev = {
    id: process.env.USER_MELI_CLIENT_ID,
    secret: process.env.USER_MELI_CLIENT_SECRET,
    redir: process.env.USER_MELI_REDIRECT_URI,
  };
  delete process.env.USER_MELI_CLIENT_ID;
  delete process.env.USER_MELI_CLIENT_SECRET;
  delete process.env.USER_MELI_REDIRECT_URI;
  const meliSetting = db.findById('settings', 'meli');
  if (meliSetting) db.remove('settings', 'meli');
  assert.strictEqual(meli.configured(), false);

  const savedApp = meli.saveAppSettings({
    clientId: 'db-id',
    clientSecret: 'db-secret-value',
    redirectUri: 'https://example.monkeycode-ai.live/admin',
  });
  assert.ok(!JSON.stringify(savedApp).includes('db-secret-value'), 'secret não volta na API');
  assert.strictEqual(meli.configured(), true);
  assert.strictEqual(meli.envConfig().clientId, 'db-id');
  assert.strictEqual(meli.envConfig().clientSecret, 'db-secret-value');
  const pub = meli.publicAppSettings();
  assert.strictEqual(pub.secretSet, true);
  assert.strictEqual(pub.clientId, 'db-id');
  assert.ok(!JSON.stringify(pub).includes('db-secret-value'));
  meli.saveAppSettings({ clientSecret: '••••keep' });
  assert.strictEqual(meli.envConfig().clientSecret, 'db-secret-value', 'máscara não sobrescreve');
  db.remove('settings', 'meli');
  assert.strictEqual(meli.configured(), false);

  process.env.USER_MELI_CLIENT_ID = 'app-id';
  process.env.USER_MELI_CLIENT_SECRET = 'app-secret';
  process.env.USER_MELI_REDIRECT_URI = 'https://example.monkeycode-ai.live/admin';
  assert.strictEqual(meli.configured(), true);

  assert.strictEqual(
    meli.suggestedRedirectUri('https://5173-abc.monkeycode-ai.live'),
    'https://5173-abc.monkeycode-ai.live/api/meli/callback'
  );
  assert.strictEqual(
    meli.suggestedRedirectUri('https://5173-abc.monkeycode-ai.live/'),
    'https://5173-abc.monkeycode-ai.live/api/meli/callback'
  );

  const auth = meli.createAuthUrl('admin-1');
  assert.ok(auth.url.includes('https://auth.mercadolivre.com.br/authorization'));
  assert.ok(auth.url.includes('client_id=app-id'));
  assert.ok(auth.url.includes('offline_access'));
  assert.ok(auth.state);

  const calls = [];
  meli.setHttp(async (req) => {
    calls.push(req);
    if (String(req.url).includes('/oauth/token')) {
      return {
        status: 200,
        json: {
          access_token: 'APP_USR-aaa',
          token_type: 'bearer',
          expires_in: 21600,
          scope: 'offline_access read',
          user_id: 35204426,
          refresh_token: 'TG-refresh-1',
        },
      };
    }
    return { status: 200, json: {} };
  });
  const done = await meli.completeAuth('admin-1', 'CODE123', auth.state);
  assert.strictEqual(done.meliUserId, 35204426);
  const st = meli.authStatus();
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.meliUserId, 35204426);
  assert.ok(!JSON.stringify(st).includes('APP_USR'));
  assert.ok(calls[0].body.includes('grant_type=authorization_code'));

  meli.setHttp(async (req) => {
    if (String(req.body || '').includes('grant_type=refresh_token')) {
      return {
        status: 200,
        json: {
          access_token: 'APP_USR-bbb',
          expires_in: 21600,
          user_id: 35204426,
          refresh_token: 'TG-refresh-2',
          scope: 'offline_access read',
        },
      };
    }
    return { status: 200, json: { id: 'MLB1' } };
  });
  const row = db.all('meliAuth')[0];
  db.update('meliAuth', row.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const token = await meli.getAccessToken();
  assert.strictEqual(token, 'APP_USR-bbb');
  assert.strictEqual(db.all('meliAuth')[0].refreshToken, 'TG-refresh-2');

  await meli.disconnect();
  assert.strictEqual(meli.authStatus().connected, false);

  process.env.USER_MELI_CLIENT_ID = 'app-id';
  process.env.USER_MELI_CLIENT_SECRET = 'app-secret';
  process.env.USER_MELI_REDIRECT_URI = 'https://example.monkeycode-ai.live/admin';
  meli.setHttp(async (req) => {
    if (String(req.url).includes('/oauth/token')) {
      return {
        status: 200,
        json: {
          access_token: 'APP_USR-aaa',
          expires_in: 21600,
          user_id: 35204426,
          refresh_token: 'TG-refresh-1',
          scope: 'offline_access read',
        },
      };
    }
    if (String(req.url).includes('/sale_price')) {
      return { status: 200, json: { amount: 599.9, regular_amount: 699.9 } };
    }
    if (String(req.url).includes('/description')) {
      return { status: 200, json: { plain_text: 'Descrição ML' } };
    }
    if (String(req.url).includes('/items/MLB1828680414')) {
      return { status: 200, json: ITEM };
    }
    return { status: 404, json: {} };
  });
  const auth2 = meli.createAuthUrl('admin-1');
  await meli.completeAuth('admin-1', 'CODE', auth2.state);
  db.findWhere('officialProducts', (p) => p.meliItemId === 'MLB1828680414').forEach((p) => {
    require('./official').deleteProduct(p.id);
  });
  const imported = await meli.importFromUrl(ITEM.permalink, { id: 'admin-1' });
  assert.strictEqual(imported.created, true);
  assert.strictEqual(imported.product.meliItemId, 'MLB1828680414');
  const again = await meli.importFromUrl('MLB1828680414', { id: 'admin-1' });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.product.id, imported.product.id);

  meli.setHttp(async (req) => {
    const url = String(req.url);
    if (url.includes('/oauth/token')) {
      return { status: 200, json: { access_token: 'APP_USR-aaa', expires_in: 21600, user_id: 35204426, refresh_token: 'TG-refresh-1' } };
    }
    if (url.includes('/items/MLB5885455180/description')) {
      return { status: 200, json: { plain_text: 'Desc terceiro' } };
    }
    if (url.includes('/items/MLB5885455180')) {
      return { status: 403, json: { error: 'access_denied' } };
    }
    if (url.includes('/products/MLB60968045/items')) {
      return { status: 200, json: { results: RESULTS } };
    }
    if (url.includes('/products/MLB60968045')) {
      return { status: 200, json: PRODUCT };
    }
    return { status: 404, json: {} };
  });
  let needPage;
  try { await meli.importFromUrl('MLB5885455180', { id: 'admin-1' }); }
  catch (e) { needPage = e; }
  assert.strictEqual(needPage.status, 400);
  assert.ok(/\/p\//i.test(needPage.message), needPage.message);

  const third = await meli.importFromUrl(
    'https://www.mercadolivre.com.br/kit/p/MLB60968045#wid=MLB5885455180',
    { id: 'admin-1' }
  );
  assert.strictEqual(third.created, true);
  assert.strictEqual(third.product.meliItemId, 'MLB5885455180');
  assert.strictEqual(third.product.meliCatalogId, 'MLB60968045');
  assert.strictEqual(third.offer.price, 137.15);
  assert.ok(!third.offer.stock);

  meli.setHttp(async (req) => {
    if (String(req.url).includes('/oauth/token')) {
      return {
        status: 200,
        json: {
          access_token: 'APP_USR-aaa',
          expires_in: 21600,
          user_id: 35204426,
          refresh_token: 'TG-refresh-1',
          scope: 'offline_access read',
        },
      };
    }
    if (String(req.url).includes('/sale_price')) {
      return { status: 200, json: { amount: 10, regular_amount: null } };
    }
    if (String(req.url).includes('/description')) {
      return { status: 200, json: { plain_text: 'x' } };
    }
    if (String(req.url).includes('/items/')) {
      return { status: 200, json: { ...ITEM, id: 'MLB9999999999', seller_id: 1, available_quantity: 50 } };
    }
    return { status: 404, json: {} };
  });
  const otherSeller = await meli.importFromUrl('MLB9999999999', { id: 'admin-1' });
  assert.strictEqual(otherSeller.created, true, 'anúncio de outro vendedor');
  assert.ok(!otherSeller.offer.stock);

  let hits = 0;
  meli.setHttp(async (req) => {
    if (String(req.url).includes('/oauth/token')) {
      return { status: 200, json: { access_token: 'APP_USR-aaa', expires_in: 21600, user_id: 35204426, refresh_token: 'TG-refresh-1' } };
    }
    hits += 1;
    if (hits === 1) return { status: 429, json: {} };
    if (String(req.url).includes('/sale_price')) return { status: 200, json: { amount: 10, regular_amount: null } };
    if (String(req.url).includes('/description')) return { status: 200, json: { plain_text: 'x' } };
    return { status: 200, json: { ...ITEM, title: 'Depois do 429', seller_id: 35204426, status: 'active' } };
  });
  const waits = [];
  const tick = await meli.runSyncTick({
    sleep: (ms) => { waits.push(ms); return Promise.resolve(); },
  });
  assert.strictEqual(tick.delayed, true);
  assert.ok(waits[0] >= 500);

  const official = require('./official');
  official.deleteProduct(imported.product.id);
  await meli.disconnect();

  if (prev.id == null) delete process.env.USER_MELI_CLIENT_ID; else process.env.USER_MELI_CLIENT_ID = prev.id;
  if (prev.secret == null) delete process.env.USER_MELI_CLIENT_SECRET; else process.env.USER_MELI_CLIENT_SECRET = prev.secret;
  if (prev.redir == null) delete process.env.USER_MELI_REDIRECT_URI; else process.env.USER_MELI_REDIRECT_URI = prev.redir;

  console.log('OK meli tests');
}

run().catch((e) => { console.error(e); process.exit(1); });
