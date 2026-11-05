const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const lance = require('./lance');
const { authOptional, signToken } = require('./middleware');

function fail(msg) {
  throw new Error(msg);
}

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

async function run() {
  lance.ensureSettings();
  const settings = lance.getSettings();
  assert.strictEqual(settings.ownBuyEnabled, false, 'compra própria deve nascer desligada');
  assert.notStrictEqual(settings.intermediationEnabled, false, 'intermediação ligada');

  const admin = user('admin@catira.com');
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  const pedro = user('pedro@email.com');
  assert.ok(admin && joao && maria && pedro, 'usuários demo');

  // Fixture idempotente: o credenciamento do catireiro sobrevive ao banco,
  // então limpamos antes para revalidar o bloqueio de não-catireiro.
  [maria, pedro].forEach((u) => {
    db.findWhere('dealerProfiles', (p) => p.userId === u.id).forEach((p) => db.remove('dealerProfiles', p.id));
    db.findWhere('dealerApplications', (a) => a.userId === u.id).forEach((a) => db.remove('dealerApplications', a.id));
  });

  const cat = db.findOne('categories', () => true);
  const now = new Date().toISOString();
  const listing = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Lance Full geladeira',
    description: 'Item de teste do módulo Lance Full. Não é venda real.',
    categoryId: cat.id,
    subcategory: '',
    price: 500,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    acceptsTrade: false,
    acceptsCash: true,
    tradeWishes: '',
    status: 'published',
    featured: false,
    vip: false,
    premium: false,
    quickOfferEnabled: true,
    waitForEvaluation: false,
    views: 0,
    createdAt: now,
    publishedAt: now,
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    paidAt: now,
  });

  const opp = lance.onListingCreated(listing, { quickOfferEnabled: true }, joao);
  assert.ok(opp, 'fila de avaliação criada');
  assert.strictEqual(opp.status, 'under_review');
  assert.strictEqual(opp.mode, 'intermediation');

  try {
    lance.forwardToHub(opp.id, { referencePrice: 600, goodsPrice: 500, intermediationFee: 100 }, admin);
    fail('encaminhar sem consentimento deveria falhar');
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }

  try {
    lance.sellerConsent(listing.id, joao, true);
    fail('autorizar sem pedido com resumo deveria falhar');
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }

  const asked = lance.requestConsent(opp.id, admin, {
    goodsPrice: 500,
    intermediationFee: 100,
    validHours: 72,
    conditions: 'Retirada em Corinto. Intermediação, não compra do CATIRA.',
  });
  assert.ok(asked.pendingConsent);
  assert.strictEqual(asked.feeConfigured, true);

  try {
    lance.sellerConsent(listing.id, admin, true);
    fail('admin não autoriza no lugar do vendedor');
  } catch (e) {
    assert.strictEqual(e.status, 403);
  }

  lance.sellerConsent(listing.id, joao, true);
  const forwarded = lance.forwardToHub(opp.id, {
    referencePrice: 600,
    goodsPrice: 500,
    intermediationFee: 100,
    validHours: 72,
    conditions: 'Retirada em Corinto. Intermediação, não compra do CATIRA.',
  }, admin);
  assert.strictEqual(forwarded.status, 'available');
  assert.strictEqual(forwarded.referencePrice, 600);
  assert.strictEqual(forwarded.goodsPrice, 500);
  assert.strictEqual(forwarded.intermediationFee, 100);

  try {
    lance.expressInterest(opp.id, maria, 'quero');
    fail('não-catireiro não entra na central');
  } catch (e) {
    assert.strictEqual(e.status, 403);
  }

  function ensureDealer(u, regions) {
    if (lance.isActiveDealer(u) && u.role === 'user') return;
    const pending = db.findOne('dealerApplications', (a) => a.userId === u.id && a.status === 'pending');
    if (pending) {
      lance.reviewDealer(pending.id, 'approve', admin, '');
      return;
    }
    const app = lance.applyDealer(u, {
      name: u.name,
      city: u.city,
      phone: u.phone || '38999990000',
      categories: [cat.id],
      regions,
      termsAccepted: true,
    });
    lance.reviewDealer(app.id, 'approve', admin, '');
  }
  ensureDealer(maria, ['Corinto']);
  ensureDealer(pedro, ['Curvelo']);
  assert.ok(lance.isActiveDealer(maria));

  const interest = lance.expressInterest(opp.id, maria, 'Tenho interesse');
  assert.strictEqual(interest.sale, false);
  assert.strictEqual(interest.charged, false);
  const still = db.findById('opportunities', opp.id);
  assert.notStrictEqual(still.status, 'completed', 'interesse não conclui venda');

  const again = lance.expressInterest(opp.id, maria, '');
  assert.strictEqual(again.already, true);
  assert.strictEqual(again.sale, false);

  const reserved = lance.reserveOpportunity(opp.id, maria.id, admin, 1);
  assert.strictEqual(reserved.status, 'reserved');
  try {
    lance.reserveOpportunity(opp.id, pedro.id, admin, 1);
    fail('reserva duplicada deveria falhar');
  } catch (e) {
    assert.strictEqual(e.status, 409);
  }
  try {
    lance.expressInterest(opp.id, pedro, 'também quero');
    fail('interesse em reserva alheia deveria falhar');
  } catch (e) {
    assert.strictEqual(e.status, 409);
  }

  db.update('opportunities', opp.id, { reservedUntil: new Date(Date.now() - 1000).toISOString() });
  lance.expireReservations();
  const afterExp = db.findById('opportunities', opp.id);
  assert.strictEqual(afterExp.status, 'available', 'reserva expirada volta a disponível');

  const offer = lance.sendOffer(listing.id, { amount: 480, validHours: 1, conditions: 'Proposta de teste' }, admin);
  assert.strictEqual(offer.offer.status, 'sent');
  db.update('opportunityOffers', offer.offer.id, { validUntil: new Date(Date.now() - 1000).toISOString() });
  lance.expireOffers();
  const expiredOffer = db.findById('opportunityOffers', offer.offer.id);
  assert.strictEqual(expiredOffer.status, 'expired');

  const offer2 = lance.sendOffer(listing.id, { amount: 490, validHours: 48, conditions: 'Nova proposta' }, admin);
  const accepted = lance.respondOffer(offer2.offer.id, 'accept', joao);
  assert.strictEqual(accepted.offer.status, 'accepted');
  assert.notStrictEqual(accepted.opportunity.status, 'completed', 'aceite de proposta não é compra do CATIRA');

  try {
    lance.changeStatus(opp.id, 'completed', admin, { acceptedConditions: true, adminJustification: 'fecha no chip' });
    fail('justificativa administrativa não substitui confirmação das partes');
  } catch (e) {
    assert.ok(e.status === 400);
  }

  try {
    lance.saveSettings({ ownBuyEnabled: true }, maria);
    fail('usuário comum não liga compra própria');
  } catch (e) {
    assert.ok(e.status === 403 || e.status === 400);
  }

  const sent = lance.sendOffer(listing.id, { amount: 500, validHours: 24, conditions: '' }, admin);
  const rejected = lance.respondOffer(sent.offer.id, 'reject', joao);
  assert.strictEqual(rejected.offer.status, 'rejected');

  lance.changeStatus(opp.id, 'cancelled', admin, { reason: 'Teste de cancelamento' });
  const cancelled = db.findById('opportunities', opp.id);
  assert.strictEqual(cancelled.status, 'cancelled');

  const hub = lance.hubList({}, maria);
  assert.ok(!hub.find((h) => h.id === opp.id), 'cancelada some da central');

  const noFlag = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Sem proposta rápida',
    description: 'Controle sem autorização.',
    categoryId: cat.id,
    price: 200,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    status: 'published',
    quickOfferEnabled: false,
    createdAt: now,
    publishedAt: now,
  });
  assert.strictEqual(lance.onListingCreated(noFlag, { quickOfferEnabled: false }, joao), null);

  const bd = lance.feeBreakdown({ goodsPrice: 500, intermediationFee: 50 });
  assert.strictEqual(bd.toSeller, 500);
  assert.strictEqual(bd.toPlatform, 50);
  assert.strictEqual(bd.totalBuyer, 550);
  assert.strictEqual(bd.sellerCharged, false);
  assert.strictEqual(bd.chargedNow, false);
  assert.strictEqual(bd.payer, 'catireiro');

  const listing2 = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Confirmação e disputa',
    description: 'Fluxo de confirmação das partes.',
    categoryId: cat.id,
    price: 400,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    status: 'published',
    quickOfferEnabled: true,
    createdAt: now,
    publishedAt: now,
  });
  const opp2 = lance.onListingCreated(listing2, { quickOfferEnabled: true }, joao);
  lance.requestConsent(opp2.id, admin, { goodsPrice: 400, intermediationFee: 40, validHours: 48, conditions: '' });
  const granted = lance.sellerConsent(listing2.id, joao, true);
  assert.ok(granted.consentTermsVersion);
  assert.strictEqual(granted.consentModality, 'intermediation');
  const fwd2 = lance.forwardToHub(opp2.id, { goodsPrice: 400, intermediationFee: 40, validHours: 48, conditions: '' }, admin);
  assert.strictEqual(fwd2.feeBreakdown.toPlatform, 40);
  assert.strictEqual(fwd2.feeBreakdown.totalBuyer, 440);
  lance.expressInterest(opp2.id, maria, '');
  lance.reserveOpportunity(opp2.id, maria.id, admin, 2);
  lance.confirmCompletion(opp2.id, maria, 'dealer');
  lance.confirmCompletion(opp2.id, joao, 'seller');
  const both = db.findById('opportunities', opp2.id);
  assert.ok(both.sellerConfirmedAt && both.dealerConfirmedAt);
  assert.notStrictEqual(both.status, 'completed', 'confirmação das partes não cobra sozinha');
  assert.strictEqual(!!both.feeCharged, false);

  lance.changeStatus(opp2.id, 'completed', admin, { acceptedConditions: true });
  const done = db.findById('opportunities', opp2.id);
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(done.feeDue, true);
  assert.strictEqual(!!done.feeCharged, false, 'não cobra automaticamente');

  const listing3 = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Disputa e caixa própria',
    description: 'Disputa e compra própria desligada.',
    categoryId: cat.id,
    price: 300,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    status: 'published',
    quickOfferEnabled: true,
    createdAt: now,
    publishedAt: now,
  });
  const opp3 = lance.onListingCreated(listing3, { quickOfferEnabled: true }, joao);
  lance.requestConsent(opp3.id, admin, { goodsPrice: 300, intermediationFee: 30, validHours: 24, conditions: '' });
  lance.sellerConsent(listing3.id, joao, true);
  lance.forwardToHub(opp3.id, { goodsPrice: 300, intermediationFee: 30, validHours: 24, conditions: '' }, admin);
  lance.expressInterest(opp3.id, maria, '');
  lance.reserveOpportunity(opp3.id, maria.id, admin, 2);
  const disp = lance.openDispute(opp3.id, maria, 'Não combinamos a retirada no combinado.');
  assert.strictEqual(disp.status, 'disputed');
  assert.strictEqual(!!disp.feeDue, false);

  try {
    lance.putInOwnBox(opp3.id, admin);
    fail('caixa própria com flag off deveria falhar');
  } catch (e) {
    assert.strictEqual(e.status, 403);
  }
  try {
    lance.putInOwnBox(opp3.id, maria);
    fail('usuário comum não entra na caixa própria');
  } catch (e) {
    assert.ok(e.status === 403 || e.status === 400);
  }
  assert.strictEqual(lance.publicOwnResale().length, 0);

  try {
    lance.forwardToHub(opp2.id, { mode: 'own_buy' }, admin);
    fail('não desvia intermediação concluída para compra própria');
  } catch (e) {
    assert.ok(e.status === 400 || e.status === 403);
  }

  const ev = db.findWhere('opportunityEvents', (e) => e.action === 'modality_changed');
  assert.ok(Array.isArray(ev));

  const listing4 = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Autorização, taxa e retirada',
    description: 'Revalidação de consentimento e privacidade.',
    categoryId: cat.id,
    price: 800,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    status: 'published',
    quickOfferEnabled: true,
    createdAt: now,
    publishedAt: now,
  });
  const opp4 = lance.onListingCreated(listing4, { quickOfferEnabled: true }, joao);
  try {
    lance.forwardToHub(opp4.id, { goodsPrice: 800 }, admin);
    fail('encaminhar sem taxa definida deveria falhar');
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }
  lance.requestConsent(opp4.id, admin, { goodsPrice: 800, intermediationFee: 80, conditions: 'Retirada local', validHours: 48 });
  lance.sellerConsent(listing4.id, joao, true);
  try {
    lance.forwardToHub(opp4.id, { goodsPrice: 800, intermediationFee: 80, conditions: 'Outra condição' }, admin);
    fail('mudança de condição exige nova autorização');
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }
  lance.sellerConsent(listing4.id, joao, false);
  try {
    lance.forwardToHub(opp4.id, { goodsPrice: 800, intermediationFee: 80, conditions: 'Retirada local' }, admin);
    fail('autorização revogada impede divulgação');
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }
  lance.requestConsent(opp4.id, admin, { goodsPrice: 800, intermediationFee: 80, conditions: 'Retirada local', validHours: 48 });
  lance.sellerConsent(listing4.id, joao, true);
  const fwd4 = lance.forwardToHub(opp4.id, { goodsPrice: 800, intermediationFee: 80, conditions: 'Retirada local', validHours: 48 }, admin);
  assert.strictEqual(fwd4.status, 'available');
  assert.strictEqual(fwd4.feeBreakdown.isEstimate, true);
  const interest4 = lance.expressInterest(opp4.id, maria, '');
  assert.strictEqual(interest4.sale, false);
  assert.strictEqual(interest4.charged, false);
  const afterInterest = db.findById('opportunities', opp4.id);
  assert.strictEqual(afterInterest.status, 'available');
  assert.strictEqual(!!afterInterest.feeDue, false);
  const withdrawn = lance.withdrawInterest(opp4.id, maria);
  assert.strictEqual(withdrawn.interest.status, 'withdrawn');
  const againInterest = lance.expressInterest(opp4.id, maria, '');
  assert.strictEqual(againInterest.already, false);
  const reserved4 = lance.reserveOpportunity(opp4.id, maria.id, admin, 2);
  assert.strictEqual(reserved4.status, 'reserved');
  try {
    lance.withdrawInterest(opp4.id, maria);
    fail('não retira interesse com reserva ativa');
  } catch (e) {
    assert.strictEqual(e.status, 400);
  }
  try {
    lance.confirmCompletion(opp4.id, admin, 'seller');
    fail('admin não confirma no lugar do vendedor');
  } catch (e) {
    assert.strictEqual(e.status, 403);
  }
  try {
    lance.confirmCompletion(opp4.id, admin, 'dealer');
    fail('admin não confirma no lugar do catireiro');
  } catch (e) {
    assert.strictEqual(e.status, 403);
  }
  lance.startNegotiation(opp4.id, admin, {});
  const negotiating = db.findById('opportunities', opp4.id);
  assert.strictEqual(negotiating.status, 'negotiating');
  const hubItem = lance.serializeOpportunity(negotiating, { dealerId: maria.id });
  assert.ok(!hubItem.seller || !hubItem.seller.phone, 'catireiro não vê telefone');
  assert.ok(!JSON.stringify(hubItem).includes('38988881111'));
  const disp4 = lance.openDispute(opp4.id, maria, 'Divergência sobre a retirada combinada.');
  assert.strictEqual(disp4.status, 'disputed');
  try {
    lance.changeStatus(opp4.id, 'completed', admin, { acceptedConditions: true });
    fail('disputa não conclui no silêncio');
  } catch (e) {
    assert.ok(e.status === 400);
  }
  try {
    lance.resolveDispute(opp4.id, admin, { resolution: 'ok', nextStatus: 'completed' });
    fail('resolver disputa não pode concluir a venda');
  } catch (e) {
    assert.ok(e.status === 400);
  }
  const resolved = lance.resolveDispute(opp4.id, admin, { resolution: 'Partes voltam a negociar com as mesmas condições.', nextStatus: 'available' });
  assert.strictEqual(resolved.status, 'available');
  assert.strictEqual(!!resolved.sellerConfirmedAt, false);
  assert.strictEqual(!!resolved.feeDue, false);

  const offerOwn = (() => {
    try {
      lance.sendOffer(listing4.id, { amount: 750, validHours: 24, origin: 'own_buy' }, admin);
      fail('proposta de compra própria com flag off deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 403);
    }
    return lance.sendOffer(listing4.id, { amount: 750, validHours: 24, origin: 'third_party', presentedBy: 'Comprador encaminhado' }, admin);
  })();
  assert.strictEqual(offerOwn.offer.origin, 'third_party');

  try {
    lance.respondOffer(offerOwn.offer.id, 'accept', maria);
    fail('outro usuário não responde proposta do vendedor');
  } catch (e) {
    assert.strictEqual(e.status, 403);
  }

  const waitListing = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Aguardar avaliação',
    description: 'Não publica sozinho.',
    categoryId: cat.id,
    price: 150,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    status: 'awaiting_review',
    quickOfferEnabled: true,
    waitForEvaluation: true,
    createdAt: now,
  });
  const waitOpp = lance.onListingCreated(waitListing, { quickOfferEnabled: true, waitForEvaluation: true }, joao);
  assert.ok(waitOpp);
  assert.strictEqual(waitListing.status, 'awaiting_review');
  assert.ok(!lance.hubList({}, maria).find((h) => h.id === waitOpp.id), 'sem encaminhar não entra na Central');

  const m = lance.metrics();
  assert.ok(m.intermediation);
  assert.ok(m.ownBuy);
  assert.strictEqual(m.ownBuyEnabled, false);

  await testLanceListPagination(admin, joao, maria, cat, now);

  console.log('OK lance tests');
}

function jsonGet(server, path, token) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port,
      path,
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
        resolve({ status: res.statusCode, body: parsed });
      });
    }).on('error', reject);
  });
}

async function testLanceListPagination(admin, joao, maria, cat, now) {
  const listingIds = [];
  const oppIds = [];
  const interestIds = [];
  const ts = Date.now();
  for (let i = 0; i < 21; i++) {
    const listing = db.insert('listings', {
      userId: joao.id,
      title: '[P9] lance hub ' + i,
      description: 'Task 9 lance pagination.',
      categoryId: cat.id,
      subcategory: '',
      price: 200 + i,
      condition: 'usado',
      city: 'Corinto',
      cityId: 'corinto',
      listingType: 'venda',
      acceptsTrade: false,
      acceptsCash: true,
      tradeWishes: '',
      status: 'published',
      featured: false,
      vip: false,
      premium: false,
      quickOfferEnabled: true,
      views: 0,
      createdAt: new Date(ts - i * 1000).toISOString(),
      publishedAt: new Date(ts - i * 1000).toISOString(),
    });
    listingIds.push(listing.id);
    const opp = db.insert('opportunities', {
      listingId: listing.id,
      sellerId: joao.id,
      status: 'available',
      mode: 'intermediation',
      sellerAskPrice: 200 + i,
      referencePrice: 200 + i,
      goodsPrice: 200 + i,
      intermediationFee: 0,
      conditions: '',
      city: 'Corinto',
      cityId: 'corinto',
      categoryId: cat.id,
      forwardedAt: new Date(ts - i * 1000).toISOString(),
      inOwnBox: false,
      createdAt: new Date(ts - i * 1000).toISOString(),
      updatedAt: new Date(ts - i * 1000).toISOString(),
    });
    oppIds.push(opp.id);
    const interest = db.insert('opportunityInterests', {
      opportunityId: opp.id,
      dealerId: maria.id,
      status: 'interested',
      note: 'p9 ' + i,
      createdAt: new Date(ts - i * 1000).toISOString(),
    });
    interestIds.push(interest.id);
  }

  const app = express();
  app.use(express.json());
  app.use(authOptional);
  app.use('/api/lance', require('./routes/lance').publicRouter);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const token = signToken(maria);

  try {
    const hub = await jsonGet(server, '/api/lance/hub', token);
    assert.strictEqual(hub.status, 200);
    assert.ok(Array.isArray(hub.body.items), 'hub items array');
    assert.ok(hub.body.items.length <= 20, 'hub default page size');
    assert.ok(hub.body.total >= 21, 'hub total is full set');
    assert.strictEqual(typeof hub.body.page, 'number');
    assert.strictEqual(typeof hub.body.limit, 'number');
    assert.strictEqual(hub.body.limit, 20);
    const hub2 = await jsonGet(server, '/api/lance/hub?page=2', token);
    assert.strictEqual(hub2.body.page, 2);
    assert.ok(hub2.body.items.length >= 1, 'hub page 2 has remainder');

    const mine = await jsonGet(server, '/api/lance/mine', token);
    assert.strictEqual(mine.status, 200);
    assert.ok(Array.isArray(mine.body.items), 'mine items array');
    assert.ok(mine.body.items.length <= 20, 'lance mine default page size');
    assert.ok(mine.body.total >= 21, 'lance mine total is full set');
    assert.strictEqual(mine.body.page, 1);
    assert.strictEqual(mine.body.limit, 20);
  } finally {
    await new Promise((r) => server.close(r));
    interestIds.forEach((id) => db.remove('opportunityInterests', id));
    oppIds.forEach((id) => db.remove('opportunities', id));
    listingIds.forEach((id) => db.remove('listings', id));
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
