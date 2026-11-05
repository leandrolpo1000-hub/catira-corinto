const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CATIRA_DEMO_PHOTOS = 'stub';
process.env.CATIRA_SQLITE_PATH = path.join(os.tmpdir(), 'catira-heavy-' + process.pid + '.sqlite');
process.env.CATIRA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'catira-heavy-data-'));

const db = require('./db');
const { CATEGORIES } = require('./categories');
const seed = require('./seed');

assert.strictEqual(seed.CITY_NAMES.length, 34, '34 cidades');
['Dores do Indaiá', 'Luz', 'Bom Despacho', 'Quartel Geral', 'Cedro do Abaeté'].forEach((name) => {
  assert.ok(seed.CITY_NAMES.includes(name), name);
});
assert.strictEqual(seed.CITIES.length, 34);
assert.ok(seed.CITIES.every((c) => c.state === 'MG'));
assert.strictEqual(seed.CITIES.find((c) => c.name === 'Dores do Indaiá').id, 'dores-do-indaia');
assert.strictEqual(seed.CITIES.find((c) => c.name === 'Cedro do Abaeté').id, 'cedro-do-abaete');

assert.strictEqual(seed.demoUserEmail(1), 'demo.user.001@catira.local');
assert.strictEqual(seed.demoUserEmail(100), 'demo.user.100@catira.local');
assert.strictEqual(seed.demoDealerEmail(1), 'demo.dealer.01@catira.local');
assert.strictEqual(seed.demoDealerEmail(10), 'demo.dealer.10@catira.local');

assert.ok(Array.isArray(seed.HEAVY_CATALOG));
assert.strictEqual(seed.HEAVY_CATALOG.length, 100);
CATEGORIES.forEach((c) => {
  const rows = seed.HEAVY_CATALOG.filter((r) => r.slug === c.slug);
  assert.strictEqual(rows.length, 10, c.slug + ' tem 10 produtos');
});
seed.HEAVY_CATALOG.forEach((row, i) => {
  assert.ok(row.title && row.description && row.subcategory);
  assert.ok(Number.isFinite(row.price) && row.price > 0);
  assert.ok(Array.isArray(row.photoQueries) && row.photoQueries.length === 4, '4 queries foto #' + i);
});

const photo = seed.ensureDemoPhoto('demo-test-stub.jpg', 'motorcycle');
assert.ok(photo.url);
assert.strictEqual(photo.local, false, 'stub não baixa arquivo');
assert.ok(photo.url.startsWith('/api/placeholder/'));

console.log('seed.heavy constants ok');

const { ensureCategories } = require('./categories');
ensureCategories();
seed.ensureCities();

const master = db.insert('users', {
  name: 'Admin Catira',
  email: 'admin@catira.com',
  phone: '38999990000',
  city: 'Corinto',
  cityId: 'corinto',
  passwordHash: 'x',
  role: 'master',
  status: 'active',
});

const first = seed.ensureHeavyDemo();
assert.ok(first);

const users = db.findWhere('users', (u) => /^demo\.user\.\d{3}@catira\.local$/.test(u.email));
const dealers = db.findWhere('users', (u) => /^demo\.dealer\.\d{2}@catira\.local$/.test(u.email));
assert.strictEqual(users.length, 100);
assert.strictEqual(dealers.length, 10);
users.forEach((u) => {
  assert.strictEqual(u.role, 'user');
  assert.strictEqual(u.status, 'active');
  assert.ok(u.passwordHash && u.passwordHash !== 'x');
  assert.ok(u.cityId);
  assert.ok(seed.CITIES.some((c) => c.id === u.cityId));
});
dealers.forEach((u) => {
  assert.strictEqual(u.role, 'user');
  const app = db.findOne('dealerApplications', (a) => a.userId === u.id);
  const profile = db.findOne('dealerProfiles', (p) => p.userId === u.id);
  assert.ok(app && app.status === 'approved');
  assert.ok(profile && profile.status === 'active');
  assert.strictEqual(profile.founder, false);
});
assert.strictEqual(db.findOne('users', (u) => u.email === 'admin@catira.com').role, 'master');

const userCount = db.count('users');
const appCount = db.count('dealerApplications');
const profileCount = db.count('dealerProfiles');
seed.ensureHeavyDemo();
assert.strictEqual(db.count('users'), userCount, 'segunda chamada não duplica users');
assert.strictEqual(db.count('dealerApplications'), appCount);
assert.strictEqual(db.count('dealerProfiles'), profileCount);

const cities = db.all('cities');
assert.ok(cities.length >= 34);
assert.ok(cities.find((c) => c.name === 'Luz' && c.state === 'MG'));

console.log('seed.heavy users ok');

const listings = db.findWhere('listings', (l) => l.source === 'demo-heavy');
assert.strictEqual(listings.length, 100, '100 anúncios demo-heavy');

const { resolveCategory } = require('./categories');
CATEGORIES.forEach((c) => {
  const cat = resolveCategory(c.slug);
  const n = listings.filter((l) => l.categoryId === cat.id).length;
  assert.strictEqual(n, 10, c.slug + ' tem 10 anúncios');
});

listings.forEach((l) => {
  const imgs = db.findWhere('listingImages', (img) => img.listingId === l.id);
  assert.strictEqual(imgs.length, 4, l.title + ' tem 4 fotos');
  assert.deepStrictEqual(imgs.sort((a, b) => a.order - b.order).map((img) => img.order), [0, 1, 2, 3]);
  assert.strictEqual(l.status, 'published');
  assert.ok(['venda', 'venda_troca', 'troca', 'procuro'].includes(l.listingType));
  const pay = db.findOne('payments', (p) => p.listingId === l.id);
  assert.ok(pay);
  assert.strictEqual(pay.method, 'pix');
  assert.strictEqual(pay.status, 'paid');
  assert.ok(String(pay.transactionId).startsWith('PIX-DEMO-HEAVY-'));
  assert.ok(!l.appmaxOrderId);
  assert.ok(!pay.appmaxOrderId);
});

const typeCount = { venda: 0, venda_troca: 0, troca: 0, procuro: 0 };
listings.forEach((l) => { typeCount[l.listingType] += 1; });
assert.strictEqual(typeCount.venda, 70);
assert.strictEqual(typeCount.venda_troca, 15);
assert.strictEqual(typeCount.troca, 10);
assert.strictEqual(typeCount.procuro, 5);

const dealerOwners = new Set();
for (let n = 1; n <= 10; n++) {
  const u = db.findOne('users', (x) => x.email === seed.demoDealerEmail(n));
  const mine = listings.filter((l) => l.userId === u.id);
  assert.strictEqual(mine.length, 4, seed.demoDealerEmail(n) + ' publica 4');
  dealerOwners.add(u.id);
}
let commonCount = 0;
for (let n = 1; n <= 60; n++) {
  const u = db.findOne('users', (x) => x.email === seed.demoUserEmail(n));
  const mine = listings.filter((l) => l.userId === u.id);
  assert.strictEqual(mine.length, 1, seed.demoUserEmail(n) + ' publica 1');
  commonCount += mine.length;
}
assert.strictEqual(commonCount, 60);
for (let n = 61; n <= 100; n++) {
  const u = db.findOne('users', (x) => x.email === seed.demoUserEmail(n));
  const mine = listings.filter((l) => l.userId === u.id);
  assert.strictEqual(mine.length, 0);
}

const listingCount = db.count('listings');
const imageCount = db.count('listingImages');
const payCount = db.count('payments');
seed.ensureHeavyDemo();
assert.strictEqual(db.count('listings'), listingCount);
assert.strictEqual(db.count('listingImages'), imageCount);
assert.strictEqual(db.count('payments'), payCount);

const cardPay = db.findOne('payments', (p) => p.method === 'card' && String(p.transactionId || '').includes('HEAVY'));
assert.ok(!cardPay);

console.log('seed.heavy listings ok');

const orders = db.all('orders') || [];
assert.ok(orders.every((o) => o.source !== 'demo-heavy'));
assert.strictEqual(
  db.count('payments', (p) => p.method === 'card' && String(p.transactionId || '').startsWith('PIX-DEMO-HEAVY')),
  0
);
console.log('seed.heavy no-appmax ok');
