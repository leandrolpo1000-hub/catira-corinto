const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const db = require('./db');
const official = require('./official');
const orders = require('./orders');
const appmax = require('./appmax');
const { authOptional, signToken } = require('./middleware');

const WEBHOOK_TOKEN = 'whsec_homolog_sandbox_token_2d27';
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
  const calls = { customer: [], order: [], pix: [], card: [], installments: [], getOrder: [] };
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
    async getInstallments(body) {
      calls.installments.push(body);
      if (h.installments) return h.installments(body);
      return {
        installments: [
          { installment: 1, amount: body.total_value },
          { installment: 2, amount: Math.ceil(body.total_value / 2) },
          { installment: 3, amount: Math.ceil(body.total_value / 3) },
        ],
      };
    },
    async getOrder(id) {
      calls.getOrder.push(id);
      if (h.getOrder) return h.getOrder(id);
      return { id, status: 'pendente', paid_value: 0 };
    },
  };
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function jsonRequest(server, { method, path: urlPath, token, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
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

function assertDefaultProduction() {
  const urls = appmax.resolveUrls({ USER_APPMAX_ENV: 'sandbox' });
  assert.ok(urls.apiUrl.includes('sandboxappmax.com.br'), 'sandbox explícito ainda aponta sandbox');
  const def = appmax.resolveUrls({});
  assert.strictEqual(def.apiUrl, 'https://api.appmax.com.br');
  assert.strictEqual(process.env.USER_APPMAX_ENV || '', '', 'env de processo sem USER_APPMAX_ENV');
}

async function run() {
  const prevToken = process.env.USER_APPMAX_WEBHOOK_TOKEN;
  process.env.USER_APPMAX_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
  assertDefaultProduction();

  const joao = user('joao@email.com');
  const admin = user('admin@email.com') || db.findOne('users', (u) => u.role === 'admin' || u.role === 'master');
  const cat = db.findOne('categories', () => true);
  assert.ok(joao && cat && admin, 'fixture demo');
  const seller = official.ensureOfficialSeller();
  const ids = { products: [], offers: [], orders: [], items: [], events: [] };

  const created = official.createProduct(
    {
      title: '[TESTE] Homolog Furadeira',
      description: 'Produto de homologação sandbox.',
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
    { provider: 'catira', price: 135.5, stock: 12, status: 'manual', buyEnabled: true },
    { id: seller.id }
  );
  ids.offers.push(catira.offer.id);

  function newOrder(key, buyer, quantity) {
    const out = orders.createOrder({
      userId: (buyer || joao).id,
      offerId: catira.offer.id,
      quantity: quantity || 2,
      address: ADDRESS,
      idempotencyKey: key,
    });
    ids.orders.push(out.order.id);
    ids.items.push(...out.items.map((i) => i.id));
    return out;
  }

  try {
    const pixOrder = newOrder('homolog-pix');
    const expiredOrder = newOrder('homolog-pix-exp', extraBuyer(ids, 'Eva Exp', 'eva-hom@test.local'));
    const failedPix = newOrder('homolog-pix-fail', extraBuyer(ids, 'Fábio Hom', 'fabio-hom@test.local'));
    const cardOk = newOrder('homolog-card-ok', extraBuyer(ids, 'Lia Hom', 'lia-hom@test.local'));
    const refused = newOrder('homolog-card-refused', extraBuyer(ids, 'Rui Hom', 'rui-hom@test.local'));
    const inst = newOrder('homolog-card-inst', extraBuyer(ids, 'Ivo Hom', 'ivo-hom@test.local'));
    official.upsertOffer(created.product.id, { provider: 'catira', price: 999 }, { id: seller.id });
    const pixPrep = mockAppmax({ order: () => ({ id: 501, status: 'pendente' }) });
    const charged = await orders.preparePixCharge(pixOrder.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: pixPrep });
    assert.strictEqual(charged.order.status, 'awaiting_payment');
    assert.strictEqual(charged.order.pixEmv, '00020126580014br.gov.bcb.pix');
    assert.ok(charged.order.pixQrcode);
    assert.strictEqual(charged.order.pixExpirationDate, '2026-11-03 15:00:00');
    assert.strictEqual(charged.order.totalCents, 27100, 'snapshot congelado');
    assert.notStrictEqual(charged.order.unitPriceCents, 99900);
    assert.notStrictEqual(charged.order.status, 'paid');

    const pending = await orders.handleAppmaxWebhook(
      { data: { id: 501, status: 'aprovado' } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'pendente', paid_value: 0 }) }) }
    );
    assert.strictEqual(pending.confirmed, false);
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.status, 'awaiting_payment');

    const paidPix = await orders.handleAppmaxWebhook(
      { event: 'OrderPaid', data: { id: 501 } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'aprovado', paid_value: 27100, total: 27100 }) }) }
    );
    assert.strictEqual(paidPix.confirmed, true);
    assert.strictEqual(paidPix.order.status, 'paid');
    assert.strictEqual(orders.getOrder(pixOrder.order.id).order.appmaxPaymentStatus, 'aprovado');

    await orders.preparePixCharge(expiredOrder.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: mockAppmax({ order: () => ({ id: 502, status: 'pendente' }) }) });
    const expiredOut = await orders.handleAppmaxWebhook(
      { data: { id: 502 } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'expirado', paid_value: 0 }) }) }
    );
    assert.strictEqual(expiredOut.confirmed, false);
    assert.strictEqual(orders.getOrder(expiredOrder.order.id).order.status, 'expired');
    assert.notStrictEqual(orders.getOrder(expiredOrder.order.id).order.status, 'paid');

    await orders.preparePixCharge(failedPix.order.id, {
      documentNumber: '19100000000',
      ip: '127.0.0.1',
    }, { appmax: mockAppmax({ order: () => ({ id: 503, status: 'pendente' }) }) });
    const failOut = await orders.handleAppmaxWebhook(
      { data: { id: 503 } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'cancelado', paid_value: 0 }) }) }
    );
    assert.strictEqual(failOut.order.status, 'failed');

    const cardCharged = await orders.prepareCardCharge(cardOk.order.id, {
      token: 'tok_front_end_homolog',
      documentNumber: '19100000000',
      ip: '127.0.0.1',
      holderName: 'Lia Hom',
      installments: 1,
    }, { appmax: mockAppmax({ order: () => ({ id: 601, status: 'pendente' }) }) });
    assert.strictEqual(cardCharged.order.status, 'awaiting_payment');
    assert.ok(['autorizado', 'pendente'].includes(cardCharged.order.appmaxPaymentStatus));
    assert.notStrictEqual(cardCharged.order.status, 'paid');

    const authorized = await orders.handleAppmaxWebhook(
      { data: { id: 601, status: 'aprovado' } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'autorizado', paid_value: 27100, total: 27100 }) }) }
    );
    assert.strictEqual(authorized.confirmed, false, 'autorizado não captura');
    assert.strictEqual(orders.getOrder(cardOk.order.id).order.status, 'awaiting_payment');

    const cardPaid = await orders.handleAppmaxWebhook(
      { data: { id: 601 } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'aprovado', paid_value: 27100, total: 27100 }) }) }
    );
    assert.strictEqual(cardPaid.confirmed, true);
    assert.strictEqual(cardPaid.order.status, 'paid');

    await expectStatus(
      () => orders.prepareCardCharge(refused.order.id, {
        token: 'tok_refused',
        documentNumber: '19100000000',
        ip: '127.0.0.1',
        holderName: 'Rui Hom',
        installments: 1,
      }, { appmax: mockAppmax({ card: () => { throw fail(422, 'Appmax recusou a requisição (422).'); } }) }),
      422,
      'cartão recusado'
    );
    assert.strictEqual(orders.getOrder(refused.order.id).order.status, 'draft');
    assert.notStrictEqual(orders.getOrder(refused.order.id).order.status, 'paid');

    const three = await orders.prepareCardCharge(inst.order.id, {
      token: 'tok_inst',
      documentNumber: '19100000000',
      ip: '127.0.0.1',
      holderName: 'Ivo Hom',
      installments: 3,
    }, { appmax: mockAppmax({ order: () => ({ id: 602, status: 'pendente' }) }) });
    assert.strictEqual(three.order.cardInstallments, 3);
    assert.notStrictEqual(three.order.status, 'paid');

    const latePending = await orders.handleAppmaxWebhook(
      { data: { id: 501, status: 'pendente' } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'pendente', paid_value: 0 }) }) }
    );
    assert.strictEqual(latePending.confirmed, true);
    assert.strictEqual(latePending.order.status, 'paid', 'evento fora de ordem não desfaz paid');

    const again = await orders.handleAppmaxWebhook(
      { data: { id: 501 } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'aprovado', paid_value: 27100, total: 27100 }) }) }
    );
    assert.strictEqual(again.confirmed, true);
    assert.strictEqual(
      orders.eventsOf(pixOrder.order.id).filter((e) => e.toStatus === 'paid').length,
      1
    );

    const unknown = await orders.handleAppmaxWebhook(
      { data: { id: 404404 } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'aprovado', paid_value: 27100 }) }) }
    );
    assert.strictEqual(unknown.confirmed, false);

    const mismatch = await orders.handleAppmaxWebhook(
      { data: { id: 602 } },
      { appmax: mockAppmax({ getOrder: () => ({ id: 999, status: 'aprovado', paid_value: 27100, total: 27100 }) }) }
    );
    assert.strictEqual(mismatch.confirmed, false);
    assert.strictEqual(orders.getOrder(inst.order.id).order.status, 'awaiting_payment');

    const short = await orders.handleAppmaxWebhook(
      { data: { id: 602 } },
      { appmax: mockAppmax({ getOrder: (id) => ({ id, status: 'aprovado', paid_value: 100, total: 100 }) }) }
    );
    assert.strictEqual(short.confirmed, false);

    await expectStatus(
      () => orders.handleAppmaxWebhook(
        { data: { id: 602 } },
        {
          appmax: mockAppmax({
            getOrder: () => { throw fail(504, 'Tempo esgotado na Appmax.'); },
          }),
        }
      ),
      504,
      'GET timeout'
    );
    assert.strictEqual(orders.getOrder(inst.order.id).order.status, 'awaiting_payment');

    db.close();
    db.reload();
    const persisted = orders.getOrder(pixOrder.order.id).order;
    assert.strictEqual(persisted.status, 'paid');
    assert.strictEqual(persisted.totalCents, 27100);
    assert.strictEqual(persisted.unitPriceCents, 13550);
    assert.strictEqual(persisted.paymentMethod, 'pix');
    assert.ok(orders.eventsOf(pixOrder.order.id).some((e) => e.toStatus === 'paid'));

    const backup = db.backupNow();
    assert.ok(backup && fs.existsSync(backup), 'backup gerado em diretório de teste');
    assert.ok(backup.startsWith(db.BACKUP_DIR), 'backup isolado, não toca produção');
    const restored = new DatabaseSync(backup, { readOnly: true });
    const rows = restored.prepare('SELECT json FROM records WHERE table_name = ? AND id = ?').all('orders', pixOrder.order.id);
    assert.strictEqual(rows.length, 1);
    const restoredOrder = JSON.parse(rows[0].json);
    assert.strictEqual(restoredOrder.status, 'paid');
    assert.strictEqual(restoredOrder.totalCents, 27100);
    restored.close();

    db.close();
    const walCheck = new DatabaseSync(db.SQLITE_FILE);
    const mode = walCheck.prepare('PRAGMA journal_mode').get();
    const journal = String(mode.journal_mode || mode.journalMode || Object.values(mode)[0] || '').toLowerCase();
    assert.strictEqual(journal, 'wal');
    walCheck.close();
    db.reload();

    const app = express();
    app.use(express.json());
    app.use(authOptional);
    app.use('/api/orders', require('./routes/orders'));
    app.use('/api/checkout', require('./routes/orders').checkout);
    app.use('/api/admin', require('./routes/admin'));
    app.use('/api/appmax/webhooks', require('./routes/appmaxWebhooks'));
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ error: err.message || 'Erro interno.' });
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const createdHttp = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders',
        token: signToken(joao),
        body: { offerId: catira.offer.id, quantity: 1, address: ADDRESS },
      });
      assert.strictEqual(createdHttp.status, 200, 'logado compra oferta buyEnabled');
      ids.orders.push(createdHttp.body.id);
      const checkout = await jsonRequest(server, {
        method: 'POST',
        path: '/api/checkout/sessions',
        token: signToken(joao),
        body: { offerId: catira.offer.id },
      });
      assert.strictEqual(checkout.status, 403);

      const wrong = await jsonRequest(server, {
        method: 'POST',
        path: '/api/appmax/webhooks/wrong-token',
        body: { data: { id: 501 } },
      });
      assert.strictEqual(wrong.status, 404);

      const list = await jsonRequest(server, {
        path: '/api/admin/orders',
        token: signToken(admin),
      });
      assert.strictEqual(list.status, 200);
      const listed = list.body.items.find((o) => o.id === pixOrder.order.id);
      assert.strictEqual(listed.paymentMethod, 'pix');
      assert.strictEqual(listed.appmaxOrderId, 501);
      assert.strictEqual(listed.status, 'paid');
      const blob = JSON.stringify(listed);
      assert.ok(!/00020126580014|iVBORw0KGgo|tok_front_end|USER_APPMAX|cvv/i.test(blob), 'lista sem EMV/QR/token');

      const detail = await jsonRequest(server, {
        path: '/api/admin/orders/' + pixOrder.order.id,
        token: signToken(admin),
      });
      assert.strictEqual(detail.status, 200);
      assert.ok(detail.body.order.payment);
      assert.strictEqual(detail.body.order.payment.method, 'pix');
      assert.strictEqual(detail.body.order.pixEmv, undefined);
      assert.strictEqual(detail.body.order.pixQrcode, undefined);
      assert.ok(Array.isArray(detail.body.events));
      const cardDetail = await jsonRequest(server, {
        path: '/api/admin/orders/' + cardOk.order.id,
        token: signToken(admin),
      });
      assert.strictEqual(cardDetail.body.order.payment.cardInstallments, 1);
      const patch = await jsonRequest(server, {
        method: 'POST',
        path: '/api/admin/orders/' + pixOrder.order.id,
        token: signToken(admin),
        body: { status: 'refunded' },
      });
      assert.ok(patch.status === 404 || patch.status === 405);
      assert.strictEqual(orders.getOrder(pixOrder.order.id).order.status, 'paid');
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    cleanup(ids);
    if (prevToken === undefined) delete process.env.USER_APPMAX_WEBHOOK_TOKEN;
    else process.env.USER_APPMAX_WEBHOOK_TOKEN = prevToken;
  }

  console.log('orders.homolog.test.js ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
