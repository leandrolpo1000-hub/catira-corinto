const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const official = require('./official');
const orders = require('./orders');
const { authOptional } = require('./middleware');

const WEBHOOK_TOKEN = 'whsec_test_unpredictable_token_2d25';
const ADDRESS = {
  recipientName: 'João Ferreira',
  phone: '38988881111',
  cep: '39200-000',
  street: 'Rua das Flores',
  number: '100',
  complement: 'Casa',
  district: 'Centro',
  city: 'Corinto',
  state: 'MG',
  cityId: 'corinto',
};

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

async function expectStatus(fn, status, label) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, label + ' deveria lançar');
  assert.strictEqual(err.status, status, label + ' (status ' + err.status + ': ' + err.message + ')');
  return err;
}

function mockAppmax(handlers) {
  const calls = { customer: [], order: [], pix: [], card: [], getOrder: [] };
  const h = handlers || {};
  return {
    calls,
    async createCustomer(body) {
      calls.customer.push(body);
      if (h.customer) return h.customer(body);
      return { id: 17 };
    },
    async createOrder(body) {
      calls.order.push(body);
      if (h.order) return h.order(body);
      return { id: 99, status: 'pendente' };
    },
    async createPixPayment(body) {
      calls.pix.push(body);
      if (h.pix) return h.pix(body);
      return {
        pix_emv: '00020126580014br.gov.bcb.pix',
        pix_qrcode: 'iVBORw0KGgo=',
        pix_expiration_date: '2026-11-03 15:00:00',
        pix_ref: 'PIX-REF-99',
      };
    },
    async createCreditCardPayment(body) {
      calls.card.push(body);
      if (h.card) return h.card(body);
      return {
        order: { id: 99, status: 'autorizado' },
        payment: {
          id: 55,
          method: 'creditcard',
          installments: body.installments || 1,
          status: 'autorizado',
        },
      };
    },
    async getOrder(id) {
      calls.getOrder.push(id);
      if (h.getOrder) return h.getOrder(id);
      return { id, status: 'pendente', paid_value: 0 };
    },
  };
}

function jsonRequest(server, { method, path, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function extraBuyer(ids, name, email) {
  const u = db.insert('users', {
    name,
    email,
    role: 'user',
    status: 'active',
    passwordHash: 'x',
  });
  ids.users = ids.users || [];
  ids.users.push(u.id);
  return u;
}

function cleanup(ids) {
  const opts = { allowOrderWrite: true };
  (ids.events || []).forEach((id) => { try { db.remove('orderEvents', id, opts); } catch {} });
  db.findWhere('orderEvents', (e) => (ids.orders || []).includes(e.orderId)).forEach((e) => {
    try { db.remove('orderEvents', e.id, opts); } catch {}
  });
  (ids.items || []).forEach((id) => { try { db.remove('orderItems', id, opts); } catch {} });
  (ids.orders || []).forEach((id) => { try { db.remove('orders', id, opts); } catch {} });
  (ids.offers || []).forEach((id) => { try { db.remove('officialProductOffers', id); } catch {} });
  (ids.products || []).forEach((id) => {
    const row = db.findById('officialProducts', id);
    if (row && row.listingId) try { db.remove('listings', row.listingId); } catch {}
    try { db.remove('officialProducts', id); } catch {}
  });
  (ids.users || []).forEach((id) => { try { db.remove('users', id); } catch {} });
}

async function run() {
  const prevToken = process.env.USER_APPMAX_WEBHOOK_TOKEN;
  process.env.USER_APPMAX_WEBHOOK_TOKEN = WEBHOOK_TOKEN;

  const joao = user('joao@email.com');
  const cat = db.findOne('categories', () => true);
  assert.ok(joao && cat, 'fixture demo');
  const seller = official.ensureOfficialSeller();
  const ids = { products: [], offers: [], orders: [], items: [], events: [] };

  const created = official.createProduct(
    {
      title: '[TESTE] Webhook Furadeira',
      description: 'Produto de teste webhook.',
      categoryId: cat.id,
      condition: 'novo',
      costPrice: 80,
      pricingRule: 'fixed',
      marginValue: 20,
      published: true,
      cityId: 'corinto',
      city: 'Corinto',
      delivery: { mode: 'cities', cityIds: ['corinto'] },
    },
    { id: seller.id }
  );
  ids.products.push(created.product.id);
  const catira = official.upsertOffer(
    created.product.id,
    { provider: 'catira', price: 135.5, stock: 8, status: 'manual', buyEnabled: true },
    { id: seller.id }
  );
  ids.offers.push(catira.offer.id);

  function newOrder(key, buyer) {
    const out = orders.createOrder({
      userId: (buyer || joao).id,
      offerId: catira.offer.id,
      quantity: 2,
      address: ADDRESS,
      idempotencyKey: key,
    });
    ids.orders.push(out.order.id);
    ids.items.push(...out.items.map((i) => i.id));
    ids.events.push(...out.events.map((e) => e.id));
    return out;
  }

  try {
    const pixOrder = newOrder('wh-pix-1');
    const pixPrep = mockAppmax();
    await orders.preparePixCharge(pixOrder.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: pixPrep });
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.status, 'awaiting_payment');

    const pendingGet = mockAppmax({
      getOrder: (id) => ({ id, status: 'pendente', paid_value: 0 }),
    });
    const stillWaiting = await orders.handleAppmaxWebhook(
      { data: { id: 99, status: 'aprovado' } },
      { appmax: pendingGet }
    );
    assert.strictEqual(pendingGet.calls.getOrder.length, 1);
    assert.strictEqual(pendingGet.calls.getOrder[0], 99);
    assert.strictEqual(stillWaiting.confirmed, false);
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.status, 'awaiting_payment');

    const shortPix = mockAppmax({
      getOrder: (id) => ({ id, status: 'aprovado', paid_value: 13550, total: 13550 }),
    });
    const underpaid = await orders.handleAppmaxWebhook(
      { data: { id: 99 } },
      { appmax: shortPix }
    );
    assert.strictEqual(underpaid.confirmed, false, 'Pix parcial não confirma');
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.status, 'awaiting_payment');

    const paidPix = mockAppmax({
      getOrder: (id) => ({
        id,
        status: 'aprovado',
        paid_value: 27100,
        total: 27100,
        payment_type: 'pix',
      }),
    });
    const confirmedPix = await orders.handleAppmaxWebhook(
      { event: 'OrderPaid', data: { id: 99, status: 'pago' } },
      { appmax: paidPix }
    );
    assert.strictEqual(paidPix.calls.getOrder.length, 1, 'confirmação exige GET /v1/orders/{id}');
    assert.strictEqual(confirmedPix.confirmed, true);
    assert.strictEqual(confirmedPix.order.status, 'paid');
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.status, 'paid');
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.totalCents, 27100, 'snapshot congelado');
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.unitPriceCents, 13550);
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.appmaxPaymentStatus, 'aprovado');

    const adminPix = orders.getOrderAdmin(pixOrder.order.id);
    assert.ok(adminPix.order.payment, 'admin expõe bloco técnico de pagamento');
    assert.strictEqual(adminPix.order.payment.method, 'pix');
    assert.strictEqual(adminPix.order.payment.appmaxOrderId, 99);
    assert.strictEqual(adminPix.order.payment.appmaxPaymentStatus, 'aprovado');
    assert.strictEqual(adminPix.order.payment.catiraStatus, 'paid');
    assert.strictEqual(adminPix.order.pixEmv, undefined, 'admin não expõe EMV');
    assert.strictEqual(adminPix.order.pixQrcode, undefined, 'admin não expõe QR');
    assert.ok(Array.isArray(adminPix.events));
    assert.ok(adminPix.events.some((e) => e.toStatus === 'paid' || e.type === 'order.transitioned'));
    const listedPix = orders.listOrdersAdmin().find((o) => o.id === pixOrder.order.id);
    assert.strictEqual(listedPix.paymentMethod, 'pix');
    assert.strictEqual(listedPix.appmaxOrderId, 99);
    assert.strictEqual(listedPix.appmaxPaymentStatus, 'aprovado');
    assert.strictEqual(listedPix.userId, undefined);

    const pixAgain = await orders.handleAppmaxWebhook(
      { data: { id: 99 } },
      { appmax: paidPix }
    );
    assert.strictEqual(pixAgain.confirmed, true, 'webhook idempotente');
    assert.strictEqual(pixAgain.order.status, 'paid');
    assert.strictEqual(
      orders.eventsOf(pixOrder.order.id).filter((e) => e.toStatus === 'paid').length,
      1,
      'não retransiciona para paid'
    );

    const cardOrder = newOrder('wh-card-1', extraBuyer(ids, 'Lia Card Wh', 'lia-wh@test.local'));
    await orders.prepareCardCharge(cardOrder.order.id, {
      token: 'tok_front_end_422146c7',
      documentNumber: '19100000000',
      ip: '127.0.0.1',
      holderName: 'Lia Card',
      installments: 1,
    }, { appmax: mockAppmax({ order: () => ({ id: 66, status: 'pendente' }) }) });

    const authorized = mockAppmax({
      getOrder: (id) => ({ id, status: 'autorizado', paid_value: 27100, total: 27100 }),
    });
    const authOut = await orders.handleAppmaxWebhook(
      { data: { id: 66, status: 'aprovado' } },
      { appmax: authorized }
    );
    assert.strictEqual(authOut.confirmed, false, 'autorizado não confirma cartão');
    assert.strictEqual(orders.getOrder(cardOrder.order.id).order.status, 'awaiting_payment');
    assert.notStrictEqual(orders.getOrder(cardOrder.order.id).order.status, 'paid');

    const approvedCard = mockAppmax({
      getOrder: (id) => ({
        id,
        status: 'aprovado',
        paid_value: 27100,
        total: 27100,
        payment_type: 'creditcard',
      }),
    });
    const cardPaid = await orders.handleAppmaxWebhook(
      { data: { id: 66 } },
      { appmax: approvedCard }
    );
    assert.strictEqual(cardPaid.confirmed, true);
    assert.strictEqual(cardPaid.order.status, 'paid');
    const adminCard = orders.getOrderAdmin(cardOrder.order.id);
    assert.strictEqual(adminCard.order.payment.method, 'credit_card');
    assert.strictEqual(adminCard.order.payment.appmaxOrderId, 66);
    assert.strictEqual(adminCard.order.payment.appmaxPaymentId, 55);
    assert.strictEqual(adminCard.order.payment.cardInstallments, 1);
    assert.strictEqual(adminCard.order.payment.catiraStatus, 'paid');

    const integratedOrder = newOrder('wh-card-int', extraBuyer(ids, 'Ivo Int', 'ivo-wh@test.local'));
    await orders.prepareCardCharge(integratedOrder.order.id, {
      token: 'tok_int',
      documentNumber: '19100000000',
      ip: '127.0.0.1',
      holderName: 'Ivo Int',
      installments: 1,
    }, { appmax: mockAppmax({ order: () => ({ id: 77, status: 'pendente' }) }) });
    const integrated = mockAppmax({
      getOrder: (id) => ({ id, status: 'integrado', paid_value: 27100, total: 27100 }),
    });
    const intOut = await orders.handleAppmaxWebhook(
      { order_id: 77 },
      { appmax: integrated }
    );
    assert.strictEqual(integrated.calls.getOrder[0], 77);
    assert.strictEqual(intOut.confirmed, true);
    assert.strictEqual(intOut.order.status, 'paid');

    const unknown = mockAppmax({
      getOrder: (id) => ({ id, status: 'aprovado', paid_value: 27100, total: 27100 }),
    });
    const miss = await orders.handleAppmaxWebhook({ data: { id: 404404 } }, { appmax: unknown });
    assert.strictEqual(miss.confirmed, false);
    assert.strictEqual(unknown.calls.getOrder.length, 1);

    const mismatchOrder = newOrder('wh-mismatch', extraBuyer(ids, 'Mia Match', 'mia-wh@test.local'));
    await orders.preparePixCharge(mismatchOrder.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: mockAppmax({ order: () => ({ id: 301, status: 'pendente' }) }) });
    const mismatch = mockAppmax({
      getOrder: () => ({ id: 999, status: 'aprovado', paid_value: 27100, total: 27100 }),
    });
    const mismatched = await orders.handleAppmaxWebhook({ data: { id: 301 } }, { appmax: mismatch });
    assert.strictEqual(mismatched.confirmed, false, 'GET com id diferente não confirma');
    assert.strictEqual(orders.getOrder(mismatchOrder.order.id).order.status, 'awaiting_payment');

    const raceOrder = newOrder('wh-race', extraBuyer(ids, 'Rui Race', 'rui-wh@test.local'));
    await orders.preparePixCharge(raceOrder.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: mockAppmax({ order: () => ({ id: 401, status: 'pendente' }) }) });
    let raceGets = 0;
    const racing = mockAppmax({
      getOrder: async (id) => {
        raceGets += 1;
        if (raceGets === 1) await new Promise((r) => setImmediate(r));
        return { id, status: 'aprovado', paid_value: 27100, total: 27100 };
      },
    });
    const raced = await Promise.all([
      orders.handleAppmaxWebhook({ data: { id: 401 } }, { appmax: racing }),
      orders.handleAppmaxWebhook({ data: { id: 401 } }, { appmax: racing }),
    ]);
    assert.ok(raced.every((row) => row.confirmed), 'webhooks concorrentes são idempotentes');
    assert.strictEqual(orders.getOrder(raceOrder.order.id).order.status, 'paid');
    assert.strictEqual(
      orders.eventsOf(raceOrder.order.id).filter((e) => e.toStatus === 'paid').length,
      1,
      'uma única transição para paid'
    );

    const getFailOrder = newOrder('wh-get-fail', extraBuyer(ids, 'Gil Get', 'gil-wh@test.local'));
    await orders.preparePixCharge(getFailOrder.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: mockAppmax({ order: () => ({ id: 88, status: 'pendente' }) }) });
    const boom = mockAppmax({
      getOrder: () => {
        const err = new Error('Tempo esgotado na Appmax.');
        err.status = 504;
        throw err;
      },
    });
    await expectStatus(
      () => orders.handleAppmaxWebhook({ data: { id: 88 } }, { appmax: boom }),
      504,
      'falha no GET não confirma'
    );
    assert.strictEqual(orders.getOrder(getFailOrder.order.id).order.status, 'awaiting_payment');

    const events = orders.eventsOf(pixOrder.order.id);
    assert.ok(events.some((e) => e.type === 'order.webhook_received'));
    assert.ok(events.some((e) => e.toStatus === 'paid'));
    events.forEach((e) => {
      const blob = JSON.stringify(e);
      assert.ok(!/USER_APPMAX|client_secret|Bearer |whsec_test/i.test(blob), 'evento sem credencial/token');
      assert.ok(!blob.includes('tok_front_end'), 'evento sem token de cartão');
    });

    const app = express();
    app.use(express.json());
    app.use(authOptional);
    app.use('/api/appmax/webhooks', require('./routes/appmaxWebhooks'));
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ error: err.message || 'Erro interno.' });
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));

    const httpPix = newOrder('wh-http-pix', extraBuyer(ids, 'Eva Http', 'eva-wh@test.local'));
    await orders.preparePixCharge(httpPix.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: mockAppmax({ order: () => ({ id: 201, status: 'pendente' }) }) });

    try {
      const denied = await jsonRequest(server, {
        path: '/api/appmax/webhooks/wrong-token',
        body: { data: { id: 201, status: 'aprovado' } },
      });
      assert.strictEqual(denied.status, 404, 'token inválido não revela a rota');
      assert.strictEqual(orders.getOrder(httpPix.order.id).order.status, 'awaiting_payment');

      const emptyTok = await jsonRequest(server, {
        path: '/api/appmax/webhooks/',
        body: { data: { id: 201 } },
      });
      assert.ok(emptyTok.status === 404 || emptyTok.status === 405, 'token ausente recusado');

      const origClient = require('./appmax').createClient;
      require('./appmax').createClient = () => mockAppmax({
        getOrder: (id) => ({ id, status: 'aprovado', paid_value: 27100, total: 27100 }),
      });
      try {
        const ok = await jsonRequest(server, {
          path: '/api/appmax/webhooks/' + WEBHOOK_TOKEN,
          body: { data: { id: 201, status: 'pago' } },
        });
        assert.strictEqual(ok.status, 200, 'webhook HTTP responde rápido');
        assert.strictEqual(orders.getOrder(httpPix.order.id).order.status, 'paid');
      } finally {
        require('./appmax').createClient = origClient;
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    cleanup(ids);
    if (prevToken === undefined) delete process.env.USER_APPMAX_WEBHOOK_TOKEN;
    else process.env.USER_APPMAX_WEBHOOK_TOKEN = prevToken;
  }

  console.log('orders.webhook.test.js ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
