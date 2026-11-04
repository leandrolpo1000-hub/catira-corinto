const assert = require('assert');
const path = require('path');

const db = require('./db');
const official = require('./official');
const orders = require('./orders');

const PROTECTED = [
  'orders',
  'orderItems',
  'orderEvents',
  'checkoutSessions',
  'userAddresses',
];
const WRITE = { allowOrderWrite: true };

function seed() {
  const at = new Date().toISOString();
  const order = db.insert('orders', {
    id: 'clone-o1',
    userId: 'clone-u1',
    offerId: 'clone-offer',
    status: 'draft',
    currency: 'BRL',
    quantity: 2,
    unitPriceCents: 13550,
    freightCents: 0,
    discountCents: 0,
    totalCents: 27100,
    productSnapshot: { title: 'Furadeira' },
    offerSnapshot: { provider: 'catira', priceCents: 13550 },
    address: { street: 'Rua das Flores', number: '100' },
    createdAt: at,
    updatedAt: at,
  }, WRITE);
  const item = db.insert('orderItems', {
    id: 'clone-oi1',
    orderId: order.id,
    title: 'Furadeira',
    quantity: 2,
    unitPriceCents: 13550,
    lineTotalCents: 27100,
    productSnapshot: { title: 'Furadeira' },
    offerSnapshot: { provider: 'catira' },
  }, WRITE);
  const event = db.insert('orderEvents', {
    id: 'clone-oe1',
    orderId: order.id,
    type: 'order.created',
    fromStatus: null,
    toStatus: 'draft',
    source: 'test',
    at,
  }, WRITE);
  const session = db.insert('checkoutSessions', {
    id: 'clone-s1',
    userId: 'clone-u1',
    offerId: 'clone-offer',
    productId: 'clone-p1',
    quantity: 2,
    address: { street: 'Rua das Flores' },
    unitPriceCents: 13550,
    status: 'open',
    createdAt: at,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }, WRITE);
  const address = db.insert('userAddresses', {
    id: 'clone-a1',
    userId: 'clone-u1',
    recipientName: 'João',
    street: 'Rua das Flores',
    number: '100',
    createdAt: at,
  }, WRITE);
  return { order, item, event, session, address };
}

function mutate(row) {
  row.unitPriceCents = 1;
  row.totalCents = 1;
  row.lineTotalCents = 1;
  row.status = 'paid';
  row.type = 'tampered';
  row.recipientName = 'Hacker';
  if (row.productSnapshot) row.productSnapshot.title = 'Hacked';
  if (row.offerSnapshot) row.offerSnapshot.priceCents = 1;
  if (row.address) row.address.street = 'Rua Hackeada';
}

function assertUntouched(ids) {
  const order = db.findById('orders', ids.order);
  assert.strictEqual(order.unitPriceCents, 13550, 'orders snapshot intacto');
  assert.strictEqual(order.totalCents, 27100);
  assert.strictEqual(order.status, 'draft');
  assert.strictEqual(order.productSnapshot.title, 'Furadeira');
  assert.strictEqual(order.address.street, 'Rua das Flores');

  const item = db.findById('orderItems', ids.item);
  assert.strictEqual(item.unitPriceCents, 13550, 'orderItems snapshot intacto');
  assert.strictEqual(item.lineTotalCents, 27100);
  assert.strictEqual(item.productSnapshot.title, 'Furadeira');

  const event = db.findById('orderEvents', ids.event);
  assert.strictEqual(event.type, 'order.created', 'orderEvents intacto');
  assert.strictEqual(event.toStatus, 'draft');

  const session = db.findById('checkoutSessions', ids.session);
  assert.strictEqual(session.unitPriceCents, 13550, 'checkoutSessions snapshot intacto');
  assert.strictEqual(session.status, 'open');
  assert.strictEqual(session.address.street, 'Rua das Flores');

  const address = db.findById('userAddresses', ids.address);
  assert.strictEqual(address.recipientName, 'João', 'userAddresses intacto');
  assert.strictEqual(address.street, 'Rua das Flores');
}

function run() {
  assert.ok(
    db.SQLITE_FILE.includes('catira-test-'),
    'clone test não usa o sqlite de produção'
  );
  assert.ok(
    !db.SQLITE_FILE.endsWith(path.join('data', 'catira.sqlite')),
    'sqlite de teste fica fora de backend/data/catira.sqlite'
  );

  const seeded = seed();
  const ids = {
    order: seeded.order.id,
    item: seeded.item.id,
    event: seeded.event.id,
    session: seeded.session.id,
    address: seeded.address.id,
  };

  const fromAll = {};
  PROTECTED.forEach((table) => {
    const list = db.all(table);
    const row = list.find((r) => r.id === ids[table === 'orders' ? 'order'
      : table === 'orderItems' ? 'item'
        : table === 'orderEvents' ? 'event'
          : table === 'checkoutSessions' ? 'session'
            : 'address']);
    assert.ok(row, table + ' presente em all()');
    mutate(row);
    fromAll[table] = row;
  });
  assertUntouched(ids);

  PROTECTED.forEach((table) => {
    const id = ids[table === 'orders' ? 'order'
      : table === 'orderItems' ? 'item'
        : table === 'orderEvents' ? 'event'
          : table === 'checkoutSessions' ? 'session'
            : 'address'];
    mutate(db.findById(table, id));
  });
  assertUntouched(ids);

  mutate(db.findWhere('orders', (o) => o.id === ids.order)[0]);
  mutate(db.findWhere('orderItems', (i) => i.id === ids.item)[0]);
  mutate(db.findWhere('orderEvents', (e) => e.id === ids.event)[0]);
  mutate(db.findWhere('checkoutSessions', (s) => s.id === ids.session)[0]);
  mutate(db.findWhere('userAddresses', (a) => a.id === ids.address)[0]);
  assertUntouched(ids);

  mutate(db.findOne('orders', (o) => o.id === ids.order));
  mutate(db.findOne('orderItems', (i) => i.id === ids.item));
  mutate(db.findOne('orderEvents', (e) => e.id === ids.event));
  mutate(db.findOne('checkoutSessions', (s) => s.id === ids.session));
  mutate(db.findOne('userAddresses', (a) => a.id === ids.address));
  assertUntouched(ids);

  db.close();
  db.reload();
  assertUntouched(ids);

  const user = db.findOne('users', (u) => u.email === 'joao@email.com');
  assert.ok(user, 'coleções não protegidas continuam legíveis');
  const liveUser = db.findById('users', user.id);
  liveUser.__cloneProbe = true;
  assert.strictEqual(
    db.findById('users', user.id).__cloneProbe,
    true,
    'users continua com referência viva'
  );
  delete db.findById('users', user.id).__cloneProbe;

  const joao = db.findOne('users', (u) => u.email === 'joao@email.com');
  const cat = db.findOne('categories', () => true);
  assert.ok(joao && cat, 'importa usuários e categorias do json só para leitura');
  const seller = official.ensureOfficialSeller();
  const createdProduct = official.createProduct(
    {
      title: '[TESTE] Clone Furadeira',
      description: 'Produto de teste da proteção de consultas.',
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
  const catira = official.upsertOffer(
    createdProduct.product.id,
    { provider: 'catira', price: 135.5, stock: 3, status: 'manual', buyEnabled: true },
    { id: seller.id }
  );
  const created = orders.createOrder({
    userId: joao.id,
    offerId: catira.offer.id,
    quantity: 1,
    address: {
      recipientName: 'João Ferreira',
      phone: '38988881111',
      cep: '39200000',
      street: 'Rua das Flores',
      number: '100',
      complement: 'Casa',
      district: 'Centro',
      city: 'Corinto',
      state: 'MG',
      cityId: 'corinto',
    },
  });
  const dirty = db.findById('orders', created.order.id);
  dirty.unitPriceCents = 1;
  dirty.status = 'paid';
  dirty.productSnapshot.title = 'Hacked';
  const moved = orders.transition(created.order.id, 'awaiting_payment', {
    type: 'order.payment_requested',
    source: 'test',
  });
  assert.strictEqual(moved.order.status, 'awaiting_payment');
  assert.strictEqual(moved.event.fromStatus, 'draft');
  assert.strictEqual(moved.event.toStatus, 'awaiting_payment');
  assert.strictEqual(db.findById('orders', created.order.id).unitPriceCents, created.order.unitPriceCents);
  assert.strictEqual(db.findById('orders', created.order.id).productSnapshot.title, created.order.productSnapshot.title);
  assert.ok(
    orders.eventsOf(created.order.id).some((e) => e.type === 'order.payment_requested'),
    'transição registra evento'
  );

  db.close();
  db.reload();
  const reopened = db.findById('orders', created.order.id);
  assert.strictEqual(reopened.status, 'awaiting_payment', 'transição sobrevive ao sqlite');
  assert.strictEqual(reopened.unitPriceCents, created.order.unitPriceCents, 'snapshot sujo não persistiu');
  assert.strictEqual(reopened.productSnapshot.title, created.order.productSnapshot.title);

  db.close();
  console.log('db.clone.test.js ok');
}

run();
