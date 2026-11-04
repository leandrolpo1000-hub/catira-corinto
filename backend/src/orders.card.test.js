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

const CARD_INPUT = {
  token: 'tok_front_end_422146c7',
  documentNumber: '19100000000',
  ip: '127.0.0.1',
  holderName: 'João Ferreira',
  installments: 1,
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
  const calls = { customer: [], order: [], pix: [], card: [], installments: [] };
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
      title: '[TESTE] Cartão Furadeira',
      description: 'Produto de teste cartão.',
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
    idempotencyKey: 'card-key-1',
  });
  ids.orders.push(first.order.id);
  ids.items.push(...first.items.map((i) => i.id));
  ids.events.push(...first.events.map((e) => e.id));

  const installmentOrder = orders.createOrder({
    userId: extraBuyer(ids, 'Lia Parcelas', 'lia-card@test.local').id,
    offerId: catira.offer.id,
    quantity: 2,
    address: ADDRESS,
    idempotencyKey: 'card-installments-1',
  });
  ids.orders.push(installmentOrder.order.id);
  ids.items.push(...installmentOrder.items.map((i) => i.id));

  official.upsertOffer(created.product.id, { provider: 'catira', price: 999 }, { id: seller.id });

  const appmax = mockAppmax();
  const quoted = await orders.quoteInstallments(first.order.id, { installments: 3 }, { appmax });
  assert.strictEqual(appmax.calls.installments.length, 1);
  assert.strictEqual(appmax.calls.installments[0].total_value, 27100, 'parcelas usam total congelado');
  assert.strictEqual(appmax.calls.installments[0].installments, 3);
  assert.ok(Array.isArray(quoted.installments));
  assert.strictEqual(quoted.installments[0].installment, 1);
  assert.notStrictEqual(appmax.calls.installments[0].total_value, 99900);

  await expectStatus(
    () => orders.quoteInstallments(first.order.id, { installments: 3, totalCents: 1, total: 1 }, { appmax }),
    400,
    'parcelas recusam total do cliente'
  );

  const charged = await orders.prepareCardCharge(first.order.id, CARD_INPUT, { appmax });
  ids.events.push(...orders.eventsOf(first.order.id).map((e) => e.id));

  assert.strictEqual(charged.order.status, 'awaiting_payment');
  assert.notStrictEqual(charged.order.status, 'paid', 'autorizado não confirma pagamento');
  assert.strictEqual(charged.order.appmaxCustomerId, 17);
  assert.strictEqual(charged.order.appmaxOrderId, 99);
  assert.strictEqual(charged.order.paymentMethod, 'credit_card');
  assert.strictEqual(charged.order.appmaxPaymentId, 55);
  assert.strictEqual(charged.order.cardInstallments, 1);
  assert.ok(['autorizado', 'pendente'].includes(charged.order.appmaxPaymentStatus));
  assert.notStrictEqual(charged.order.appmaxPaymentStatus, 'aprovado');
  assert.strictEqual(charged.order.unitPriceCents, 13550, 'preço congelado');
  assert.strictEqual(charged.order.totalCents, 27100);

  assert.strictEqual(appmax.calls.customer.length, 1);
  assert.strictEqual(appmax.calls.customer[0].ip, '127.0.0.1');
  assert.strictEqual(appmax.calls.customer[0].document_number, '19100000000');
  assert.strictEqual(appmax.calls.order[0].products_value, 27100);
  assert.strictEqual(appmax.calls.order[0].products[0].unit_value, 13550);
  assert.notStrictEqual(appmax.calls.order[0].products[0].unit_value, 99900);

  assert.strictEqual(appmax.calls.card.length, 1);
  assert.strictEqual(appmax.calls.card[0].order_id, 99);
  assert.strictEqual(appmax.calls.card[0].customer_id, 17);
  assert.strictEqual(appmax.calls.card[0].token, 'tok_front_end_422146c7');
  assert.strictEqual(appmax.calls.card[0].installments, 1);
  assert.strictEqual(appmax.calls.card[0].holder_document_number, '19100000000');
  assert.ok(!appmax.calls.card[0].number);
  assert.ok(!appmax.calls.card[0].cvv);

  const events = orders.eventsOf(first.order.id);
  assert.ok(events.some((e) => e.type === 'order.appmax_customer_created'));
  assert.ok(events.some((e) => e.type === 'order.appmax_order_created'));
  assert.ok(events.some((e) => e.type === 'order.card_created'));
  events.forEach((e) => {
    const blob = JSON.stringify(e);
    assert.ok(!/USER_APPMAX|client_secret|Bearer /i.test(blob), 'evento sem credencial');
    assert.ok(!blob.includes('tok_front_end_422146c7'), 'evento sem token do cartão');
    assert.ok(!/400000000000|cvv/i.test(blob), 'evento sem PAN/CVV');
  });

  const again = await orders.prepareCardCharge(first.order.id, CARD_INPUT, { appmax });
  assert.strictEqual(again.order.appmaxPaymentId, 55);
  assert.strictEqual(appmax.calls.customer.length, 1, 'idempotente: não recria cliente');
  assert.strictEqual(appmax.calls.order.length, 1, 'idempotente: não recria pedido Appmax');
  assert.strictEqual(appmax.calls.card.length, 1, 'idempotente: não recobra cartão');
  assert.notStrictEqual(again.order.status, 'paid');

  await expectStatus(
    () => orders.prepareCardCharge(first.order.id, { ...CARD_INPUT, unitPrice: 1, totalCents: 1 }),
    400,
    'recusa preço do cliente'
  );

  await expectStatus(
    () => orders.prepareCardCharge(first.order.id, {
      ...CARD_INPUT,
      number: '4000000000000010',
      cvv: '123',
      expiration_month: '12',
      expiration_year: '28',
    }),
    400,
    'recusa PAN/CVV no backend'
  );

  await expectStatus(
    () => orders.prepareCardCharge(first.order.id, { documentNumber: '19100000000', ip: '127.0.0.1' }),
    400,
    'token obrigatório'
  );

  await expectStatus(
    () => orders.prepareCardCharge(first.order.id, { token: 'tok_x', ip: '127.0.0.1' }),
    400,
    'CPF obrigatório no cartão'
  );

  await expectStatus(
    () => orders.prepareCardCharge(first.order.id, { token: 'tok_x', documentNumber: '19100000000' }),
    400,
    'IP obrigatório no cartão'
  );

  const instMock = mockAppmax();
  const three = await orders.prepareCardCharge(installmentOrder.order.id, {
    ...CARD_INPUT,
    installments: 3,
  }, { appmax: instMock });
  assert.strictEqual(three.order.cardInstallments, 3);
  assert.strictEqual(instMock.calls.installments[0].total_value, 27100);
  assert.strictEqual(instMock.calls.card[0].installments, 3);
  assert.notStrictEqual(three.order.status, 'paid');

  await expectStatus(
    () => orders.prepareCardCharge(installmentOrder.order.id, { ...CARD_INPUT, installments: 99 }, { appmax: mockAppmax() }),
    400,
    'parcela inválida'
  );

  const partial = orders.createOrder({
    userId: extraBuyer(ids, 'Ana Card', 'ana-card@test.local').id,
    offerId: catira.offer.id,
    quantity: 1,
    address: ADDRESS,
    idempotencyKey: 'card-partial-1',
  });
  ids.orders.push(partial.order.id);
  ids.items.push(...partial.items.map((i) => i.id));

  const failOrder = mockAppmax({
    order: () => { throw fail(502, 'pedido Appmax falhou'); },
  });
  await expectStatus(
    () => orders.prepareCardCharge(partial.order.id, CARD_INPUT, { appmax: failOrder }),
    502,
    'falha ao criar pedido Appmax no cartão'
  );
  const afterOrderFail = orders.getOrder(partial.order.id).order;
  assert.strictEqual(afterOrderFail.appmaxCustomerId, 17);
  assert.strictEqual(afterOrderFail.appmaxOrderId, null);
  assert.strictEqual(afterOrderFail.status, 'draft');

  const failCard = mockAppmax({
    customer: () => { throw new Error('não deveria recriar cliente'); },
    card: () => { throw fail(502, 'cartão falhou'); },
  });
  await expectStatus(
    () => orders.prepareCardCharge(partial.order.id, CARD_INPUT, { appmax: failCard }),
    502,
    'falha ao cobrar cartão'
  );
  const afterCardFail = orders.getOrder(partial.order.id).order;
  assert.strictEqual(afterCardFail.appmaxOrderId, 99);
  assert.strictEqual(afterCardFail.status, 'draft', 'sem pagamento o pedido não aguarda');
  assert.strictEqual(failCard.calls.customer.length, 0);
  assert.strictEqual(failCard.calls.card.length, 1);

  const resume = mockAppmax({
    customer: () => { throw new Error('não deveria recriar cliente'); },
    order: () => { throw new Error('não deveria recriar pedido'); },
  });
  const resumed = await orders.prepareCardCharge(partial.order.id, CARD_INPUT, { appmax: resume });
  assert.strictEqual(resumed.order.status, 'awaiting_payment');
  assert.strictEqual(resumed.order.appmaxPaymentId, 55);
  assert.strictEqual(resume.calls.customer.length, 0);
  assert.strictEqual(resume.calls.order.length, 0);
  assert.strictEqual(resume.calls.card.length, 1);

  const refused = orders.createOrder({
    userId: extraBuyer(ids, 'Rui Recusa', 'rui-card@test.local').id,
    offerId: catira.offer.id,
    quantity: 1,
    address: ADDRESS,
    idempotencyKey: 'card-refused-1',
  });
  ids.orders.push(refused.order.id);
  ids.items.push(...refused.items.map((i) => i.id));
  const refuseMock = mockAppmax({
    card: () => { throw fail(422, 'Appmax recusou a requisição (422).'); },
  });
  const refusal = await expectStatus(
    () => orders.prepareCardCharge(refused.order.id, CARD_INPUT, { appmax: refuseMock }),
    422,
    'recusa do emissor'
  );
  assert.match(String(refusal.message), /recus|422/i);
  assert.strictEqual(orders.getOrder(refused.order.id).order.status, 'draft');
  assert.notStrictEqual(orders.getOrder(refused.order.id).order.status, 'paid');

  const pixOrder = orders.createOrder({
    userId: extraBuyer(ids, 'Pix Card', 'pix-card@test.local').id,
    offerId: catira.offer.id,
    quantity: 1,
    address: ADDRESS,
    idempotencyKey: 'card-pix-compat',
  });
  ids.orders.push(pixOrder.order.id);
  ids.items.push(...pixOrder.items.map((i) => i.id));
  const pixMock = mockAppmax();
  const pixed = await orders.preparePixCharge(pixOrder.order.id, {
    documentNumber: '19100000000',
    ip: '127.0.0.1',
  }, { appmax: pixMock });
  assert.strictEqual(pixed.order.paymentMethod, 'pix');
  await expectStatus(
    () => orders.prepareCardCharge(pixOrder.order.id, CARD_INPUT, { appmax: mockAppmax() }),
    409,
    'pedido com Pix não aceita cartão'
  );

  const paidGuard = orders.createOrder({
    userId: extraBuyer(ids, 'Paulo Card', 'paulo-card@test.local').id,
    offerId: catira.offer.id,
    quantity: 1,
    address: ADDRESS,
    idempotencyKey: 'card-paid-guard',
  });
  ids.orders.push(paidGuard.order.id);
  ids.items.push(...paidGuard.items.map((i) => i.id));
  orders.transition(paidGuard.order.id, 'awaiting_payment');
  orders.transition(paidGuard.order.id, 'paid');
  const paidMock = mockAppmax();
  await expectStatus(
    () => orders.prepareCardCharge(paidGuard.order.id, CARD_INPUT, { appmax: paidMock }),
    409,
    'pedido pago não gera nova cobrança'
  );
  assert.strictEqual(paidMock.calls.card.length, 0);
  assert.strictEqual(orders.getOrder(paidGuard.order.id).order.status, 'paid');

  db.reload();
  const persisted = orders.getOrder(first.order.id).order;
  assert.strictEqual(persisted.appmaxOrderId, 99);
  assert.strictEqual(persisted.appmaxPaymentId, 55);
  assert.strictEqual(persisted.paymentMethod, 'credit_card');
  assert.strictEqual(persisted.status, 'awaiting_payment');
  assert.notStrictEqual(persisted.status, 'paid');
  assert.ok(!JSON.stringify(persisted).includes('tok_front_end_422146c7'), 'pedido persistido sem token');

  cleanup(ids);
  console.log('orders.card.test.js ok');
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
