const assert = require('assert');
const db = require('./db');
const official = require('./official');
const orders = require('./orders');

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

const PIX_INPUT = {
  documentNumber: '19100000000',
  ip: '127.0.0.1',
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
  const calls = { customer: [], order: [], pix: [] };
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
  };
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function run() {
  const joao = user('joao@email.com');
  const cat = db.findOne('categories', () => true);
  assert.ok(joao && cat, 'fixture demo');
  const seller = official.ensureOfficialSeller();
  const ids = { products: [], offers: [], orders: [], items: [], events: [] };

  const created = official.createProduct(
    {
      title: '[TESTE] Pix Furadeira',
      description: 'Produto de teste Pix.',
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
    { provider: 'catira', price: 135.5, stock: 3, status: 'manual', buyEnabled: true },
    { id: seller.id }
  );
  ids.offers.push(catira.offer.id);

  const first = orders.createOrder({
    userId: joao.id,
    offerId: catira.offer.id,
    quantity: 2,
    address: ADDRESS,
    idempotencyKey: 'pix-key-1',
  });
  ids.orders.push(first.order.id);
  ids.items.push(...first.items.map((i) => i.id));
  ids.events.push(...first.events.map((e) => e.id));

  official.upsertOffer(created.product.id, { provider: 'catira', price: 999 }, { id: seller.id });

  const appmax = mockAppmax();
  const charged = await orders.preparePixCharge(first.order.id, PIX_INPUT, { appmax });
  ids.events.push(...orders.eventsOf(first.order.id).map((e) => e.id));

  assert.strictEqual(charged.order.status, 'awaiting_payment');
  assert.notStrictEqual(charged.order.status, 'paid', 'criação Pix não confirma pagamento');
  assert.strictEqual(charged.order.appmaxCustomerId, 17);
  assert.strictEqual(charged.order.appmaxOrderId, 99);
  assert.strictEqual(charged.order.paymentMethod, 'pix');
  assert.strictEqual(charged.order.pixEmv, '00020126580014br.gov.bcb.pix');
  assert.strictEqual(charged.order.pixQrcode, 'iVBORw0KGgo=');
  assert.strictEqual(charged.order.pixExpirationDate, '2026-11-03 15:00:00');
  assert.strictEqual(charged.order.unitPriceCents, 13550, 'preço congelado');
  assert.strictEqual(charged.order.totalCents, 27100);

  assert.strictEqual(appmax.calls.customer.length, 1);
  assert.strictEqual(appmax.calls.customer[0].first_name, 'João');
  assert.strictEqual(appmax.calls.customer[0].last_name, 'Ferreira');
  assert.strictEqual(appmax.calls.customer[0].email, joao.email);
  assert.strictEqual(appmax.calls.customer[0].phone, '38988881111');
  assert.strictEqual(appmax.calls.customer[0].document_number, '19100000000');
  assert.strictEqual(appmax.calls.customer[0].ip, '127.0.0.1');
  assert.strictEqual(appmax.calls.customer[0].address.postcode, '39200000');
  assert.strictEqual(appmax.calls.customer[0].address.street, 'Rua das Flores');

  assert.strictEqual(appmax.calls.order.length, 1);
  assert.strictEqual(appmax.calls.order[0].customer_id, 17);
  assert.strictEqual(appmax.calls.order[0].products_value, 27100);
  assert.strictEqual(appmax.calls.order[0].shipping_value, 0);
  assert.strictEqual(appmax.calls.order[0].discount_value, 0);
  assert.strictEqual(appmax.calls.order[0].products[0].unit_value, 13550);
  assert.strictEqual(appmax.calls.order[0].products[0].quantity, 2);
  assert.strictEqual(appmax.calls.order[0].products[0].type, 'physical');
  assert.notStrictEqual(appmax.calls.order[0].products[0].unit_value, 99900);

  assert.strictEqual(appmax.calls.pix.length, 1);
  assert.strictEqual(appmax.calls.pix[0].order_id, 99);
  assert.strictEqual(appmax.calls.pix[0].document_number, '19100000000');

  const events = orders.eventsOf(first.order.id);
  assert.ok(events.some((e) => e.type === 'order.appmax_customer_created'));
  assert.ok(events.some((e) => e.type === 'order.appmax_order_created'));
  assert.ok(events.some((e) => e.type === 'order.pix_created'));
  events.forEach((e) => {
    const blob = JSON.stringify(e);
    assert.ok(!/USER_APPMAX|client_secret|Bearer /i.test(blob), 'evento sem credencial');
  });

  const again = await orders.preparePixCharge(first.order.id, PIX_INPUT, { appmax });
  assert.strictEqual(again.order.appmaxOrderId, 99);
  assert.strictEqual(appmax.calls.customer.length, 1, 'idempotente: não recria cliente');
  assert.strictEqual(appmax.calls.order.length, 1, 'idempotente: não recria pedido Appmax');
  assert.strictEqual(appmax.calls.pix.length, 1, 'idempotente: não recria Pix');
  assert.notStrictEqual(again.order.status, 'paid');

  await expectStatus(
    () => orders.preparePixCharge(first.order.id, { ...PIX_INPUT, unitPrice: 1, totalCents: 1 }),
    400,
    'recusa preço do cliente'
  );

  await expectStatus(
    () => orders.preparePixCharge(first.order.id, { ip: '127.0.0.1' }),
    400,
    'CPF obrigatório'
  );

  await expectStatus(
    () => orders.preparePixCharge(first.order.id, { documentNumber: '19100000000' }),
    400,
    'IP obrigatório'
  );

  const wrappedIpOrder = orders.createOrder({
    userId: extraBuyer(ids, 'Bia Pix', 'bia-pix@test.local').id,
    offerId: catira.offer.id,
    quantity: 1,
    address: ADDRESS,
    idempotencyKey: 'pix-onip-object-1',
  });
  ids.orders.push(wrappedIpOrder.order.id);
  ids.items.push(...wrappedIpOrder.items.map((i) => i.id));
  const wrapAppmax = mockAppmax();
  await orders.preparePixCharge(
    wrappedIpOrder.order.id,
    { documentNumber: '19100000000', ip: { ip: '187.0.0.1' } },
    { appmax: wrapAppmax }
  );
  assert.strictEqual(wrapAppmax.calls.customer[0].ip, '187.0.0.1', 'onIp {ip} unwrap');

  const partial = orders.createOrder({
    userId: extraBuyer(ids, 'Ana Partial', 'ana-pix@test.local').id,
    offerId: catira.offer.id,
    quantity: 1,
    address: ADDRESS,
    idempotencyKey: 'pix-partial-1',
  });
  ids.orders.push(partial.order.id);
  ids.items.push(...partial.items.map((i) => i.id));

  const failOrder = mockAppmax({
    order: () => { throw fail(502, 'pedido Appmax falhou'); },
  });
  await expectStatus(
    () => orders.preparePixCharge(partial.order.id, PIX_INPUT, { appmax: failOrder }),
    502,
    'falha ao criar pedido Appmax'
  );
  const afterOrderFail = orders.getOrder(partial.order.id).order;
  assert.strictEqual(afterOrderFail.appmaxCustomerId, 17, 'cliente persistido após falha parcial');
  assert.strictEqual(afterOrderFail.appmaxOrderId, null);
  assert.strictEqual(afterOrderFail.status, 'draft');
  assert.strictEqual(failOrder.calls.customer.length, 1);

  const failPix = mockAppmax({
    customer: () => { throw new Error('não deveria recriar cliente'); },
    pix: () => { throw fail(502, 'pix falhou'); },
  });
  await expectStatus(
    () => orders.preparePixCharge(partial.order.id, PIX_INPUT, { appmax: failPix }),
    502,
    'falha ao gerar Pix'
  );
  const afterPixFail = orders.getOrder(partial.order.id).order;
  assert.strictEqual(afterPixFail.appmaxOrderId, 99, 'pedido Appmax persistido após falha do Pix');
  assert.strictEqual(afterPixFail.status, 'draft', 'sem Pix o pedido não aguarda pagamento');
  assert.strictEqual(failPix.calls.customer.length, 0);
  assert.strictEqual(failPix.calls.order.length, 1);
  assert.strictEqual(failPix.calls.pix.length, 1);

  const resume = mockAppmax({
    customer: () => { throw new Error('não deveria recriar cliente'); },
    order: () => { throw new Error('não deveria recriar pedido'); },
  });
  const resumed = await orders.preparePixCharge(partial.order.id, PIX_INPUT, { appmax: resume });
  assert.strictEqual(resumed.order.status, 'awaiting_payment');
  assert.ok(resumed.order.pixEmv);
  assert.strictEqual(resume.calls.customer.length, 0);
  assert.strictEqual(resume.calls.order.length, 0);
  assert.strictEqual(resume.calls.pix.length, 1);
  assert.strictEqual(resume.calls.pix[0].order_id, 99);

  const paidGuard = orders.createOrder({
    userId: extraBuyer(ids, 'Paulo Pago', 'paulo-pix@test.local').id,
    offerId: catira.offer.id,
    quantity: 1,
    address: ADDRESS,
    idempotencyKey: 'pix-paid-guard',
  });
  ids.orders.push(paidGuard.order.id);
  ids.items.push(...paidGuard.items.map((i) => i.id));
  orders.transition(paidGuard.order.id, 'awaiting_payment');
  orders.transition(paidGuard.order.id, 'paid');
  const paidMock = mockAppmax();
  await expectStatus(
    () => orders.preparePixCharge(paidGuard.order.id, PIX_INPUT, { appmax: paidMock }),
    409,
    'pedido pago não gera nova cobrança'
  );
  assert.strictEqual(paidMock.calls.pix.length, 0);
  assert.strictEqual(orders.getOrder(paidGuard.order.id).order.status, 'paid');

  db.reload();
  const persisted = orders.getOrder(first.order.id).order;
  assert.strictEqual(persisted.appmaxOrderId, 99);
  assert.strictEqual(persisted.pixEmv, '00020126580014br.gov.bcb.pix');
  assert.strictEqual(persisted.status, 'awaiting_payment');
  assert.notStrictEqual(persisted.status, 'paid');

  cleanup(ids);
  console.log('orders.pix.test.js ok');
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

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
