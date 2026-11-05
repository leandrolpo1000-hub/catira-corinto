const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const official = require('./official');
const { authOptional, signToken } = require('./middleware');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function expectStatus(fn, status, label) {
  try {
    fn();
  } catch (err) {
    assert.strictEqual(err.status, status, label + ' (status ' + err.status + ': ' + err.message + ')');
    return err;
  }
  assert.fail(label + ' deveria lançar erro ' + status);
}

function jsonRequest(server, { method, path, token, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
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
  (ids.events || []).forEach((id) => db.remove('orderEvents', id, opts));
  (ids.items || []).forEach((id) => db.remove('orderItems', id, opts));
  (ids.orders || []).forEach((id) => db.remove('orders', id, opts));
  (ids.sessions || []).forEach((id) => db.remove('checkoutSessions', id, opts));
  (ids.addresses || []).forEach((id) => db.remove('userAddresses', id, opts));
  (ids.offers || []).forEach((id) => db.remove('officialProductOffers', id));
  (ids.products || []).forEach((id) => {
    const row = db.findById('officialProducts', id);
    if (row && row.listingId) db.remove('listings', row.listingId);
    db.remove('officialProducts', id);
  });
  (ids.users || []).forEach((id) => db.remove('users', id));
}

async function run() {
  const orders = require('./orders');
    const joao = user('joao@email.com');
    const maria = user('maria@email.com');
    const pedro = user('pedro@email.com');
    const admin = user('admin@catira.com');
    assert.ok(joao && maria && pedro && admin, 'usuários demo');
  const cat = db.findOne('categories', () => true);
  const seller = official.ensureOfficialSeller();
  const ids = { products: [], offers: [], orders: [], items: [], events: [], sessions: [], addresses: [] };

  try {
    expectStatus(
      () => orders.validateAddress({ recipientName: '', phone: '1', cep: '1', street: '', number: '', district: '', city: '', state: '' }),
      400,
      'endereço vazio'
    );
    expectStatus(() => orders.validateAddress({ ...ADDRESS, cep: '123' }), 400, 'CEP curto');
    expectStatus(() => orders.validateAddress({ ...ADDRESS, state: 'XX' }), 400, 'UF inválida');
    const okAddr = orders.validateAddress({ ...ADDRESS, cep: '39200-000', phone: '(38) 98888-1111' });
    assert.strictEqual(okAddr.cep, '39200000', 'CEP só dígitos');
    assert.strictEqual(okAddr.phone, '38988881111', 'telefone só dígitos');
    assert.strictEqual(okAddr.state, 'MG');

    assert.strictEqual(orders.toCents(135.5), 13550);
    assert.strictEqual(orders.toCents(10.99), 1099);
    assert.strictEqual(orders.toCents(0), 0);
    assert.strictEqual(orders.toCents(-3), 0);
    assert.strictEqual(orders.toCents(NaN), 0);
    assert.strictEqual(orders.toCents('12.34'), 1234);
    assert.strictEqual(orders.toCents(1.005), 101, '1.005 reais arredonda para 101 centavos');
    assert.strictEqual(orders.toCents(0.29), 29);
    assert.strictEqual(orders.toCents(19.99), 1999);
    expectStatus(() => orders.toCents(100000000), 400, 'preço acima do teto');

    const created = official.createProduct(
      {
        title: '[TESTE] Pedido Furadeira',
        description: 'Produto de teste do domínio de pedidos.',
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
    assert.strictEqual(catira.offer.commercialReady, false);

    const closedProduct = official.createProduct(
      {
        title: '[TESTE] Catira fechada',
        description: 'Produto de teste sem compra habilitada.',
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
    ids.products.push(closedProduct.product.id);
    const closedCatira = official.upsertOffer(
      closedProduct.product.id,
      { provider: 'catira', price: 135.5, stock: 3, status: 'manual' },
      { id: seller.id }
    );
    ids.offers.push(closedCatira.offer.id);
    expectStatus(
      () => orders.createOrder({
        userId: joao.id,
        offerId: closedCatira.offer.id,
        quantity: 1,
        address: ADDRESS,
      }),
      403,
      'oferta Catira sem buyEnabled não gera pedido'
    );

    const ml = official.upsertOffer(
      created.product.id,
      { provider: 'mercadolivre', price: 140, url: 'https://www.mercadolivre.com.br/p/pedido-teste', stock: 2 },
      { id: seller.id }
    );
    ids.offers.push(ml.offer.id);

    expectStatus(
      () => orders.createOrder({ userId: joao.id, offerId: ml.offer.id, quantity: 1, address: ADDRESS }),
      400,
      'oferta externa não vira pedido Catira'
    );

    expectStatus(
      () => orders.createOrder({
        userId: joao.id,
        offerId: catira.offer.id,
        quantity: 1,
        address: ADDRESS,
        unitPrice: 1,
        total: 1,
      }),
      400,
      'cliente não manda preço'
    );

    const first = orders.createOrder({
      userId: joao.id,
      offerId: catira.offer.id,
      quantity: 2,
      address: ADDRESS,
      idempotencyKey: 'key-furadeira-1',
    });
    ids.orders.push(first.order.id);
    ids.items.push(...first.items.map((i) => i.id));
    ids.events.push(...first.events.map((e) => e.id));
    if (first.session) ids.sessions.push(first.session.id);

    assert.strictEqual(first.order.status, 'draft');
    assert.strictEqual(first.order.commercialReady, false);
    assert.strictEqual(first.order.userId, joao.id);
    assert.strictEqual(first.order.currency, 'BRL');
    assert.strictEqual(first.order.unitPriceCents, 13550);
    assert.strictEqual(first.order.quantity, 2);
    assert.strictEqual(first.order.freightCents, 0);
    assert.strictEqual(first.order.discountCents, 0);
    assert.strictEqual(first.order.totalCents, 27100);
    assert.strictEqual(first.order.appmaxOrderId, null);
    assert.strictEqual(first.order.paymentId, null);
    assert.strictEqual(first.items.length, 1);
    assert.strictEqual(first.items[0].title, '[TESTE] Pedido Furadeira');
    assert.strictEqual(first.items[0].offerId, catira.offer.id);
    assert.strictEqual(first.items[0].provider, 'catira');
    assert.strictEqual(first.items[0].unitPriceCents, 13550);
    assert.strictEqual(first.items[0].lineTotalCents, 27100);
    assert.strictEqual(first.order.address.cep, '39200000');
    assert.strictEqual(first.order.address.street, 'Rua das Flores');
    assert.ok(first.order.productSnapshot);
    assert.strictEqual(first.order.productSnapshot.title, '[TESTE] Pedido Furadeira');
    assert.strictEqual(first.order.offerSnapshot.priceCents, 13550);
    assert.ok(first.events.some((e) => e.type === 'order.created'));
    assert.strictEqual(first.order.leadTimeLabel, first.order.leadTimeLabel);

    const buyerView = orders.serializeBuyerOrder(first);
    assert.ok(buyerView.createdAt, 'serializeBuyerOrder inclui createdAt');
    assert.strictEqual(buyerView.freightCents, 0);
    assert.strictEqual(buyerView.discountCents, 0);
    assert.strictEqual(buyerView.unitPriceCents, 13550);
    assert.strictEqual(buyerView.listingId, first.order.listingId || null);
    assert.ok(!('userId' in buyerView), 'serializeBuyerOrder omite userId');
    assert.ok(!('appmaxOrderId' in buyerView), 'serializeBuyerOrder omite appmaxOrderId');

    official.updateProduct(created.product.id, { title: 'Título novo NÃO deve ir ao pedido' }, { id: seller.id });
    official.upsertOffer(created.product.id, { provider: 'catira', price: 999 }, { id: seller.id });
    const mutatedAddr = orders.validateAddress({ ...ADDRESS, street: 'Outra rua' });
    const frozen = orders.getOrder(first.order.id);
    assert.strictEqual(frozen.order.productSnapshot.title, '[TESTE] Pedido Furadeira', 'snapshot de produto imutável');
    assert.strictEqual(frozen.order.offerSnapshot.priceCents, 13550, 'snapshot de preço imutável');
    assert.strictEqual(frozen.order.unitPriceCents, 13550);
    assert.strictEqual(frozen.order.totalCents, 27100);
    assert.strictEqual(frozen.order.address.street, 'Rua das Flores', 'endereço do pedido imutável');
    assert.notStrictEqual(mutatedAddr.street, frozen.order.address.street);

    expectStatus(
      () => orders.updateOrderSnapshot(first.order.id, { unitPriceCents: 1 }),
      409,
      'snapshot não aceita patch direto'
    );

    expectStatus(
      () => db.update('orders', first.order.id, { unitPriceCents: 1, totalCents: 2 }),
      409,
      'db.update não altera snapshot do pedido'
    );
    expectStatus(
      () => db.update('orders', first.order.id, { status: 'paid' }),
      409,
      'db.update não altera status do pedido'
    );
    expectStatus(
      () => db.update('orderItems', first.items[0].id, { unitPriceCents: 1 }),
      409,
      'db.update não altera snapshot do item'
    );
    assert.strictEqual(db.findById('orders', first.order.id).unitPriceCents, 13550);
    assert.strictEqual(db.findById('orders', first.order.id).status, 'draft');
    assert.strictEqual(db.findById('orderItems', first.items[0].id).unitPriceCents, 13550);

    const leaked = db.getCache().orders.find((o) => o.id === first.order.id);
    leaked.unitPriceCents = 1;
    leaked.status = 'paid';
    assert.strictEqual(db.findById('orders', first.order.id).unitPriceCents, 13550, 'getCache não altera snapshot');
    assert.strictEqual(db.findById('orders', first.order.id).status, 'draft', 'getCache não altera status');
    expectStatus(
      () => { db.getCache().orders = []; },
      409,
      'getCache não substitui a coleção de pedidos'
    );
    expectStatus(
      () => db.remove('orders', first.order.id),
      409,
      'remove genérico de pedido'
    );
    expectStatus(
      () => db.remove('orderEvents', first.events[0].id),
      409,
      'remove genérico de evento'
    );
    expectStatus(
      () => db.remove('orderItems', first.items[0].id),
      409,
      'remove genérico de item'
    );
    assert.ok(db.findById('orders', first.order.id), 'pedido permanece após remove genérico');
    assert.ok(db.findById('orderEvents', first.events[0].id), 'evento permanece após remove genérico');

    expectStatus(
      () => orders.createOrder({
        userId: extraBuyer(ids, 'Nara Freeze', 'nara-freeze@test.local').id,
        offerId: catira.offer.id,
        quantity: 1,
        address: ADDRESS,
        frozenUnitPriceCents: 1,
      }),
      400,
      'createOrder não aceita frozenUnitPriceCents'
    );

    db.reload();
    const persisted = orders.getOrder(first.order.id);
    assert.strictEqual(persisted.order.unitPriceCents, 13550, 'pedido sobrevive ao reload');
    assert.strictEqual(persisted.order.totalCents, 27100);
    assert.strictEqual(persisted.order.productSnapshot.title, '[TESTE] Pedido Furadeira');
    assert.strictEqual(persisted.items.length, 1);
    assert.strictEqual(persisted.items[0].lineTotalCents, 27100);
    assert.ok(persisted.events.some((e) => e.type === 'order.created'));

    const again = orders.createOrder({
      userId: joao.id,
      offerId: catira.offer.id,
      quantity: 2,
      address: ADDRESS,
      idempotencyKey: 'key-furadeira-1',
    });
    assert.strictEqual(again.order.id, first.order.id, 'idempotencyKey devolve o mesmo pedido');
    assert.strictEqual(db.count('orders', (o) => o.idempotencyKey === 'key-furadeira-1'), 1);

    const openDup = orders.createOrder({
      userId: joao.id,
      offerId: catira.offer.id,
      quantity: 2,
      address: ADDRESS,
    });
    assert.strictEqual(openDup.order.id, first.order.id, 'draft aberto do mesmo user+oferta não duplica');

    const reuseBuyer = extraBuyer(ids, 'Reuse Addr', 'reuse-addr@test.local');
    const reuseFirst = orders.createOrder({
      userId: reuseBuyer.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
    });
    ids.orders.push(reuseFirst.order.id);
    ids.items.push(...reuseFirst.items.map((i) => i.id));
    ids.events.push(...reuseFirst.events.map((e) => e.id));
    const reuseSecond = orders.createOrder({
      userId: reuseBuyer.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: { ...ADDRESS, street: 'Rua Nova Checkout', number: '200' },
    });
    assert.strictEqual(reuseSecond.order.id, reuseFirst.order.id, 'reusa draft sem Pix');
    assert.strictEqual(reuseSecond.order.address.street, 'Rua Nova Checkout', 'endereço do POST entra no draft sem Pix');
    assert.strictEqual(reuseSecond.order.address.number, '200');
    assert.strictEqual(reuseSecond.order.unitPriceCents, reuseFirst.order.unitPriceCents, 'preço do snapshot não muda no reuso');
    assert.strictEqual(reuseSecond.order.quantity, 1, 'quantidade do snapshot não muda no reuso');

    db.update('orders', reuseFirst.order.id, { pixEmv: '000201...', appmaxOrderId: 99 }, { allowOrderWrite: true });
    const reusePix = orders.createOrder({
      userId: reuseBuyer.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: { ...ADDRESS, street: 'Nao Pode Mudar' },
    });
    assert.strictEqual(reusePix.order.id, reuseFirst.order.id);
    assert.strictEqual(reusePix.order.address.street, 'Rua Nova Checkout', 'com Pix o endereço não muda');

    const parallel = [1, 2, 3].map(() =>
      orders.createOrder({
        userId: joao.id,
        offerId: catira.offer.id,
        quantity: 2,
        address: ADDRESS,
        idempotencyKey: 'key-furadeira-parallel',
      })
    );
    const parallelIds = new Set(parallel.map((p) => p.order.id));
    assert.strictEqual(parallelIds.size, 1, 'chamadas concorrentes com a mesma chave criam um pedido');
    ids.orders.push(parallel[0].order.id);

    const otherKey = orders.createOrder({
      userId: joao.id,
      offerId: catira.offer.id,
      quantity: 2,
      address: ADDRESS,
      idempotencyKey: 'key-furadeira-outra',
    });
    assert.strictEqual(otherKey.order.id, first.order.id, 'chave nova não abre segundo draft do mesmo user+oferta');
    assert.strictEqual(
      db.count('orders', (o) => o.userId === joao.id && o.offerId === catira.offer.id && ['draft', 'awaiting_payment'].includes(o.status)),
      1,
      'um pedido aberto por user+oferta'
    );

    const raced = [1, 2, 3].map((n) =>
      orders.createOrder({
        userId: joao.id,
        offerId: catira.offer.id,
        quantity: 2,
        address: ADDRESS,
        idempotencyKey: 'key-furadeira-raced-' + n,
      })
    );
    assert.strictEqual(new Set(raced.map((p) => p.order.id)).size, 1, 'chaves diferentes na mesma corrida não duplicam draft');

    const session = orders.createCheckoutSession({
      userId: maria.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
    });
    ids.sessions.push(session.id);
    assert.strictEqual(session.status, 'open');
    assert.ok(new Date(session.expiresAt).getTime() > Date.now());
    const sessionAgain = orders.createCheckoutSession({
      userId: maria.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
    });
    assert.strictEqual(sessionAgain.id, session.id, 'sessão aberta reutilizada');

    const fromSession = orders.promoteSession(session.id);
    ids.orders.push(fromSession.order.id);
    ids.items.push(...fromSession.items.map((i) => i.id));
    ids.events.push(...fromSession.events.map((e) => e.id));
    assert.strictEqual(fromSession.order.status, 'draft');
    assert.strictEqual(fromSession.order.userId, maria.id);
    assert.strictEqual(fromSession.order.unitPriceCents, session.unitPriceCents);
    assert.strictEqual(fromSession.order.totalCents, session.unitPriceCents * session.quantity);
    assert.strictEqual(db.findById('checkoutSessions', session.id).status, 'promoted');

    const freezeSession = orders.createCheckoutSession({
      userId: pedro.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
    });
    ids.sessions.push(freezeSession.id);
    assert.strictEqual(freezeSession.unitPriceCents, 99900);
    expectStatus(
      () => db.update('checkoutSessions', freezeSession.id, { unitPriceCents: 1 }),
      409,
      'preço da sessão não aceita patch direto'
    );
    official.upsertOffer(created.product.id, { provider: 'catira', price: 50 }, { id: seller.id });
    const frozenPromo = orders.promoteSession(freezeSession.id);
    ids.orders.push(frozenPromo.order.id);
    ids.items.push(...frozenPromo.items.map((i) => i.id));
    ids.events.push(...frozenPromo.events.map((e) => e.id));
    assert.strictEqual(frozenPromo.order.unitPriceCents, 99900, 'promoteSession não relê o preço da oferta');
    assert.strictEqual(frozenPromo.order.totalCents, 99900);

    const blockedUser = extraBuyer(ids, 'Sueli Suspend', 'sueli-suspend@test.local');
    const blockedSession = orders.createCheckoutSession({
      userId: blockedUser.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
    });
    ids.sessions.push(blockedSession.id);
    official.upsertOffer(created.product.id, { provider: 'catira', price: 50, status: 'suspended' }, { id: seller.id });
    expectStatus(() => orders.promoteSession(blockedSession.id), 400, 'oferta suspensa não promove sessão');
    official.upsertOffer(created.product.id, { provider: 'catira', price: 50, status: 'manual' }, { id: seller.id });

    const expiredSession = orders.createCheckoutSession({
      userId: maria.id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
    });
    ids.sessions.push(expiredSession.id);
    db.update('checkoutSessions', expiredSession.id, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const expiredCount = orders.expireSessions(Date.now());
    assert.ok(expiredCount >= 1, 'sessão vencida marcada');
    assert.strictEqual(db.findById('checkoutSessions', expiredSession.id).status, 'expired');
    expectStatus(() => orders.promoteSession(expiredSession.id), 409, 'sessão expirada não vira pedido');

    const machine = orders.createOrder({
      userId: extraBuyer(ids, 'Teresa Pedidos', 'teresa-pedidos@test.local').id,
      offerId: catira.offer.id,
      quantity: 1,
      address: { ...ADDRESS, recipientName: 'Teresa Pedidos' },
      idempotencyKey: 'key-machine',
    });
    ids.orders.push(machine.order.id);
    ids.items.push(...machine.items.map((i) => i.id));
    ids.events.push(...machine.events.map((e) => e.id));

    expectStatus(() => orders.transition(machine.order.id, 'paid'), 409, 'draft não salta para paid');
    expectStatus(() => orders.transition(machine.order.id, 'shipped'), 409, 'draft não vai a shipped');

    const awaiting = orders.transition(machine.order.id, 'awaiting_payment', { type: 'payment.requested' });
    assert.strictEqual(awaiting.order.status, 'awaiting_payment');
    ids.events.push(awaiting.event.id);

    const paid = orders.transition(machine.order.id, 'paid', { type: 'payment.paid', source: 'test' });
    assert.strictEqual(paid.order.status, 'paid');
    ids.events.push(paid.event.id);

    const supplier = orders.transition(machine.order.id, 'awaiting_supplier');
    const purchased = orders.transition(machine.order.id, 'purchased');
    const shipped = orders.transition(machine.order.id, 'shipped');
    const completed = orders.transition(machine.order.id, 'completed');
    ids.events.push(supplier.event.id, purchased.event.id, shipped.event.id, completed.event.id);
    assert.strictEqual(completed.order.status, 'completed');
    expectStatus(() => orders.transition(machine.order.id, 'paid'), 409, 'completed não volta a paid');
    const afterCompleted = orders.createOrder({
      userId: machine.order.userId,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
      idempotencyKey: 'key-machine-again',
    });
    ids.orders.push(afterCompleted.order.id);
    ids.items.push(...afterCompleted.items.map((i) => i.id));
    ids.events.push(...afterCompleted.events.map((e) => e.id));
    assert.notStrictEqual(afterCompleted.order.id, machine.order.id, 'concluído libera novo pedido');

    const refundTarget = orders.createOrder({
      userId: extraBuyer(ids, 'Rita Refund', 'rita-refund@test.local').id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
      idempotencyKey: 'key-refund',
    });
    ids.orders.push(refundTarget.order.id);
    ids.items.push(...refundTarget.items.map((i) => i.id));
    ids.events.push(...refundTarget.events.map((e) => e.id));
    orders.transition(refundTarget.order.id, 'awaiting_payment');
    orders.transition(refundTarget.order.id, 'paid');
    const refunded = orders.transition(refundTarget.order.id, 'refunded', { type: 'payment.refunded' });
    ids.events.push(refunded.event.id);
    assert.strictEqual(refunded.order.status, 'refunded');
    expectStatus(() => orders.transition(refundTarget.order.id, 'paid'), 409, 'refunded é terminal');
    expectStatus(() => orders.transition(refundTarget.order.id, 'completed'), 409, 'refunded não avança');

    const cancelable = orders.createOrder({
      userId: extraBuyer(ids, 'Caio Cancel', 'caio-cancel@test.local').id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
      idempotencyKey: 'key-cancel',
    });
    ids.orders.push(cancelable.order.id);
    ids.items.push(...cancelable.items.map((i) => i.id));
    ids.events.push(...cancelable.events.map((e) => e.id));
    const cancelled = orders.transition(cancelable.order.id, 'cancelled');
    ids.events.push(cancelled.event.id);
    assert.strictEqual(cancelled.order.status, 'cancelled');
    const afterCancel = orders.createOrder({
      userId: cancelable.order.userId,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
      idempotencyKey: 'key-cancel-again',
    });
    ids.orders.push(afterCancel.order.id);
    ids.items.push(...afterCancel.items.map((i) => i.id));
    ids.events.push(...afterCancel.events.map((e) => e.id));
    assert.notStrictEqual(afterCancel.order.id, cancelable.order.id, 'cancelado libera novo pedido');
    assert.strictEqual(afterCancel.order.status, 'draft');

    const expirable = orders.createOrder({
      userId: extraBuyer(ids, 'Eva Expire', 'eva-expire@test.local').id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
      idempotencyKey: 'key-expire',
    });
    ids.orders.push(expirable.order.id);
    ids.items.push(...expirable.items.map((i) => i.id));
    ids.events.push(...expirable.events.map((e) => e.id));
    orders.transition(expirable.order.id, 'awaiting_payment');
    const expiredOrder = orders.transition(expirable.order.id, 'expired');
    ids.events.push(expiredOrder.event.id);
    assert.strictEqual(expiredOrder.order.status, 'expired');
    const afterExpire = orders.createOrder({
      userId: expirable.order.userId,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
      idempotencyKey: 'key-expire-again',
    });
    ids.orders.push(afterExpire.order.id);
    ids.items.push(...afterExpire.items.map((i) => i.id));
    ids.events.push(...afterExpire.events.map((e) => e.id));
    assert.notStrictEqual(afterExpire.order.id, expirable.order.id, 'expirado libera novo pedido');

    const failed = orders.createOrder({
      userId: extraBuyer(ids, 'Fábio Fail', 'fabio-fail@test.local').id,
      offerId: catira.offer.id,
      quantity: 1,
      address: ADDRESS,
      idempotencyKey: 'key-fail',
    });
    ids.orders.push(failed.order.id);
    ids.items.push(...failed.items.map((i) => i.id));
    ids.events.push(...failed.events.map((e) => e.id));
    orders.transition(failed.order.id, 'awaiting_payment');
    const failedOut = orders.transition(failed.order.id, 'failed');
    ids.events.push(failedOut.event.id);
    assert.strictEqual(failedOut.order.status, 'failed');

    const trail = orders.eventsOf(machine.order.id);
    const types = trail.map((e) => e.type);
    assert.ok(types.includes('order.created'));
    assert.ok(types.includes('order.transitioned'));
    assert.ok(trail.some((e) => e.toStatus === 'completed'));
    trail.forEach((e) => {
      assert.ok(e.id && e.at && e.orderId === machine.order.id);
    });

    const savedAddr = orders.saveUserAddress(joao.id, ADDRESS);
    ids.addresses.push(savedAddr.id);
    assert.strictEqual(savedAddr.cep, '39200000');
    assert.strictEqual(savedAddr.userId, joao.id);

    const app = express();
    app.use(express.json());
    app.use(authOptional);
    app.use('/api/orders', require('./routes/orders'));
    app.use('/api/checkout', require('./routes/orders').checkout);
    app.use('/api/admin', require('./routes/admin'));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));

    try {
      const publicCreate = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders',
        token: signToken(joao),
        body: { offerId: closedCatira.offer.id, quantity: 1, address: ADDRESS },
      });
      assert.strictEqual(publicCreate.status, 403, 'consumidor não cria pedido');
      assert.match(String(publicCreate.body && publicCreate.body.error), /ainda não está disponível/i);
      assert.ok(!/pronto para comprar|compre agora|checkout liberado/i.test(JSON.stringify(publicCreate.body)));

      const publicCheckout = await jsonRequest(server, {
        method: 'POST',
        path: '/api/checkout/sessions',
        token: signToken(joao),
        body: { offerId: closedCatira.offer.id },
      });
      assert.strictEqual(publicCheckout.status, 403, 'consumidor não abre checkout');

      official.upsertOffer(
        created.product.id,
        { provider: 'catira', price: 135.5, status: 'manual', buyEnabled: true },
        { id: seller.id }
      );
      const buyer = extraBuyer(ids, 'HTTP Buyer', 'http-buy@test.local');
      const openCreate = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders',
        token: signToken(buyer),
        body: { offerId: catira.offer.id, quantity: 1, address: ADDRESS },
      });
      assert.strictEqual(openCreate.status, 200, 'logado compra oferta buyEnabled');
      assert.strictEqual(openCreate.body.totalCents, 13550);
      assert.strictEqual(openCreate.body.quantity, 1);
      assert.strictEqual(openCreate.body.commercialReady, false);
      assert.ok(openCreate.body.id);
      assert.ok(openCreate.body.productSnapshot);
      assert.strictEqual(openCreate.body.address.street, 'Rua das Flores');
      assert.ok(openCreate.body.createdAt, 'HTTP serialize inclui createdAt');
      assert.strictEqual(openCreate.body.freightCents, 0);
      assert.strictEqual(openCreate.body.unitPriceCents, 13550);
      assert.ok(!('userId' in openCreate.body), 'comprador não vê userId cru se omitido no serialize');
      assert.ok(!('appmaxOrderId' in openCreate.body), 'HTTP serialize omite appmaxOrderId');
      ids.orders.push(openCreate.body.id);

      const reuseHttp = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders',
        token: signToken(buyer),
        body: { offerId: catira.offer.id, quantity: 1, address: { ...ADDRESS, street: 'Rua HTTP Nova' } },
      });
      assert.strictEqual(reuseHttp.status, 200, 'reuso HTTP do draft');
      assert.strictEqual(reuseHttp.body.id, openCreate.body.id);
      assert.strictEqual(reuseHttp.body.address.street, 'Rua HTTP Nova', 'POST reusa draft e grava endereço novo');

      const other = extraBuyer(ids, 'Outro', 'outro-buy@test.local');
      const stolen = await jsonRequest(server, {
        path: '/api/orders/' + openCreate.body.id,
        token: signToken(other),
      });
      assert.strictEqual(stolen.status, 404, 'outro usuário não lê o pedido');

      const mine = await jsonRequest(server, {
        path: '/api/orders/' + openCreate.body.id,
        token: signToken(buyer),
      });
      assert.strictEqual(mine.status, 200);
      assert.strictEqual(mine.body.id, openCreate.body.id);

      const pixDeniedOther = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/pix',
        token: signToken(other),
        body: { documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(pixDeniedOther.status, 404);

      const pixNoDoc = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/pix',
        token: signToken(buyer),
        body: { ip: '127.0.0.1' },
      });
      assert.strictEqual(pixNoDoc.status, 400);
      assert.match(String(pixNoDoc.body && pixNoDoc.body.error), /CPF|CNPJ/i);

      const cardDeniedOther = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/card',
        token: signToken(other),
        body: { token: 'tok_x', documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(cardDeniedOther.status, 404, 'outro usuário não cobra cartão');

      const cardNoToken = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/card',
        token: signToken(buyer),
        body: { documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(cardNoToken.status, 400, 'cartão exige token');
      assert.match(String(cardNoToken.body && cardNoToken.body.error), /token/i);

      const instDeniedOther = await jsonRequest(server, {
        path: '/api/orders/' + openCreate.body.id + '/installments',
        token: signToken(other),
      });
      assert.strictEqual(instDeniedOther.status, 404, 'outro usuário não lê parcelas');

      db.update('orders', openCreate.body.id, { pixEmv: '00020126...', appmaxOrderId: 77 }, { allowOrderWrite: true });
      const cardAfterPix = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/card',
        token: signToken(buyer),
        body: { token: 'tok_x', documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(cardAfterPix.status, 409, 'pedido com Pix não aceita cartão');

      const listStill = await jsonRequest(server, {
        path: '/api/orders',
        token: signToken(buyer),
      });
      assert.strictEqual(listStill.status, 403, 'lista pública segue fechada');

      const checkoutStill = await jsonRequest(server, {
        method: 'POST',
        path: '/api/checkout/sessions',
        token: signToken(buyer),
        body: { offerId: catira.offer.id, quantity: 1, address: ADDRESS },
      });
      assert.strictEqual(checkoutStill.status, 403, 'checkout session segue fechada');

      const anonAdmin = await jsonRequest(server, { path: '/api/admin/orders' });
      assert.ok(anonAdmin.status === 401 || anonAdmin.status === 403, 'admin orders exige auth');

      const userAdmin = await jsonRequest(server, {
        path: '/api/admin/orders',
        token: signToken(joao),
      });
      assert.strictEqual(userAdmin.status, 403, 'usuário comum não lista pedidos');

      const adminList = await jsonRequest(server, {
        path: '/api/admin/orders',
        token: signToken(admin),
      });
      assert.strictEqual(adminList.status, 200);
      assert.ok(Array.isArray(adminList.body.items));
      const listed = adminList.body.items.find((o) => o.id === first.order.id);
      assert.ok(listed, 'pedido aparece na lista admin');
      assert.strictEqual(listed.status, 'draft');
      assert.ok(listed.productTitle);
      assert.strictEqual(listed.paymentMethod, null);
      assert.strictEqual(listed.appmaxOrderId, null);
      assert.strictEqual(listed.appmaxPaymentStatus, null);
      assert.strictEqual(listed.userId, undefined, 'lista admin não expõe userId');
      assert.strictEqual(listed.address, undefined, 'lista não expõe endereço');
      assert.strictEqual(listed.phone, undefined, 'lista não expõe telefone');
      assert.strictEqual(listed.cep, undefined, 'lista não expõe CEP');
      assert.ok(!JSON.stringify(listed).includes('Rua das Flores'), 'lista sem logradouro');
      assert.ok(!JSON.stringify(listed).includes(joao.id), 'lista sem id do comprador');

      const adminDetail = await jsonRequest(server, {
        path: '/api/admin/orders/' + first.order.id,
        token: signToken(admin),
      });
      assert.strictEqual(adminDetail.status, 200);
      assert.strictEqual(adminDetail.body.order.address.street, 'Rua das Flores');
      assert.ok(Array.isArray(adminDetail.body.items));
      assert.ok(Array.isArray(adminDetail.body.events));
      assert.strictEqual(adminDetail.body.order.commercialReady, false);
      assert.ok(adminDetail.body.order.payment);
      assert.strictEqual(adminDetail.body.order.payment.catiraStatus, 'draft');
      assert.strictEqual(adminDetail.body.order.pixEmv, undefined);
      assert.strictEqual(adminDetail.body.order.pixQrcode, undefined);
      const adminPatch = await jsonRequest(server, {
        method: 'POST',
        path: '/api/admin/orders/' + first.order.id,
        token: signToken(admin),
        body: { status: 'paid' },
      });
      assert.ok(adminPatch.status === 404 || adminPatch.status === 405, 'admin não altera status de pagamento');
      assert.strictEqual(orders.getOrder(first.order.id).order.status, 'draft');
    } finally {
      await new Promise((r) => server.close(r));
    }

    assert.strictEqual(
      db.findById('officialProductOffers', catira.offer.id).commercialReady,
      false,
      'oferta Catira segue em preparação'
    );
  } finally {
    cleanup(ids);
  }

  console.log('OK orders tests');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
