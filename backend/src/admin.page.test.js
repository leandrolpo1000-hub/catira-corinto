const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const { authOptional, signToken } = require('./middleware');
const { pageSlice } = require('./pagination');

const rows = Array.from({ length: 45 }, (_, i) => ({ id: i }));
const p1 = pageSlice(rows, { page: '1' });
assert.strictEqual(p1.items.length, 20);
assert.strictEqual(p1.total, 45);
assert.strictEqual(p1.page, 1);
const p3 = pageSlice(rows, { page: '3' });
assert.strictEqual(p3.items.length, 5);
console.log('OK pagination');

function get(server, path, token) {
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

async function run() {
  const master = db.findOne('users', (u) => u.role === 'master');
  assert.ok(master, 'seed master');
  const token = signToken(master);

  const app = express();
  app.use(express.json());
  app.use(authOptional);
  app.use('/api/admin', require('./routes/admin'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  try {
    const res = await get(server, '/api/admin/listings', token);
    assert.strictEqual(res.status, 200, 'admin listings as master');
    assert.ok(Array.isArray(res.body.items), 'items array');
    assert.ok(res.body.items.length <= 20, 'default page size');
    assert.strictEqual(typeof res.body.total, 'number', 'numeric total');
    assert.strictEqual(res.body.page, 1);
    assert.strictEqual(res.body.limit, 20);

    const now = Date.now();
    const cat = db.findOne('categories', () => true);
    assert.ok(cat, 'category');
    const owner = db.findOne('users', (u) => u.role === 'user' && u.email === 'joao@email.com') || master;
    function listingRow(title, extra) {
      return db.insert('listings', {
        userId: owner.id,
        title,
        description: 'p4 filter',
        categoryId: cat.id,
        subcategory: '',
        price: 10,
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
        quickOfferEnabled: false,
        views: 0,
        createdAt: new Date(now).toISOString(),
        publishedAt: new Date(now).toISOString(),
        ...(extra || {}),
      });
    }
    for (let i = 0; i < 25; i++) {
      listingRow('[P4] filler ' + i, { city: 'P4-City-A', createdAt: new Date(now - i * 1000).toISOString() });
    }
    const hiddenCity = listingRow('[P4] hidden city', {
      city: 'P4-City-B',
      createdAt: new Date(now - 86400000).toISOString(),
    });
    const quickAd = listingRow('[P4] quick offer', {
      city: 'P4-City-A',
      quickOfferEnabled: true,
      createdAt: new Date(now - 90000000).toISOString(),
    });
    const trocaAd = listingRow('[P4] troca tipo', {
      city: 'P4-City-A',
      listingType: 'troca',
      acceptsTrade: true,
      createdAt: new Date(now - 91000000).toISOString(),
    });
    const premiumAd = listingRow('[P4] premium plan', {
      city: 'P4-City-A',
      premium: true,
      createdAt: new Date(now - 92000000).toISOString(),
    });
    const sellerUser = db.insert('users', {
      name: 'P4 Seller Unique',
      email: 'p4.seller.unique@catira.local',
      phone: '38970000001',
      city: 'P4-User-A',
      cityId: 'p4-user-a',
      passwordHash: owner.passwordHash || '',
      role: 'user',
      status: 'active',
      createdAt: new Date(now - 93000000).toISOString(),
    });
    const sellerAd = listingRow('[P4] seller named', {
      userId: sellerUser.id,
      city: 'P4-City-A',
      createdAt: new Date(now - 93000000).toISOString(),
    });

    const byCity = await get(server, '/api/admin/listings?city=' + encodeURIComponent('P4-City-B'), token);
    assert.strictEqual(byCity.status, 200);
    assert.ok(byCity.body.items.some((l) => l.id === hiddenCity.id), 'city filter before page');
    assert.strictEqual(byCity.body.total, 1, 'city total is filtered set');
    assert.ok(Array.isArray(byCity.body.facets && byCity.body.facets.cities), 'listing city facets');
    assert.ok(byCity.body.facets.cities.includes('P4-City-B'));

    const byQuick = await get(server, '/api/admin/listings?quick=1', token);
    assert.ok(byQuick.body.items.some((l) => l.id === quickAd.id), 'quick filter before page');
    assert.ok(byQuick.body.items.every((l) => l.quickOfferEnabled), 'quick only');
    assert.ok(byQuick.body.total >= 1);

    const byType = await get(server, '/api/admin/listings?type=troca', token);
    assert.ok(byType.body.items.some((l) => l.id === trocaAd.id), 'type filter before page');
    assert.ok(byType.body.items.every((l) => l.listingType === 'troca'));

    const byPlan = await get(server, '/api/admin/listings?plan=premium', token);
    assert.ok(byPlan.body.items.some((l) => l.id === premiumAd.id), 'plan filter before page');
    assert.ok(byPlan.body.items.every((l) => l.plan === 'premium' || l.premium));

    const bySeller = await get(server, '/api/admin/listings?seller=' + encodeURIComponent('P4 Seller Unique'), token);
    assert.ok(bySeller.body.items.some((l) => l.id === sellerAd.id), 'seller filter before page');
    assert.strictEqual(bySeller.body.total, 1);
    assert.ok(Array.isArray(bySeller.body.facets && bySeller.body.facets.sellers));
    assert.ok(bySeller.body.facets.sellers.includes('P4 Seller Unique'));

    for (let i = 0; i < 25; i++) {
      db.insert('users', {
        name: 'P4 User A ' + i,
        email: 'p4.user.a.' + i + '@catira.local',
        phone: '38971000' + String(i).padStart(3, '0'),
        city: 'P4-User-A',
        cityId: 'p4-user-a',
        passwordHash: '',
        role: 'user',
        status: 'active',
        createdAt: new Date(now - i * 1000).toISOString(),
      });
    }
    const cityUser = db.insert('users', {
      name: 'P4 User B',
      email: 'p4.user.b@catira.local',
      phone: '38971999999',
      city: 'P4-User-B',
      cityId: 'p4-user-b',
      passwordHash: '',
      role: 'user',
      status: 'active',
      createdAt: new Date(now - 86400000).toISOString(),
    });
    const dealerUser = db.insert('users', {
      name: 'P4 Dealer',
      email: 'p4.dealer@catira.local',
      phone: '38971888888',
      city: 'P4-User-A',
      cityId: 'p4-user-a',
      passwordHash: '',
      role: 'user',
      status: 'active',
      createdAt: new Date(now - 87000000).toISOString(),
    });
    db.insert('dealerProfiles', {
      userId: dealerUser.id,
      status: 'active',
      founder: false,
      city: dealerUser.city,
      cityId: dealerUser.cityId,
      phone: dealerUser.phone,
    });

    const usersCity = await get(server, '/api/admin/users?city=' + encodeURIComponent('P4-User-B'), token);
    assert.strictEqual(usersCity.status, 200);
    assert.ok(usersCity.body.items.some((u) => u.id === cityUser.id), 'user city filter before page');
    assert.strictEqual(usersCity.body.total, 1, 'user city total is filtered set');
    assert.ok(Array.isArray(usersCity.body.facets && usersCity.body.facets.cities));
    assert.ok(usersCity.body.facets.cities.includes('P4-User-B'));

    const usersRole = await get(server, '/api/admin/users?role=master', token);
    assert.ok(usersRole.body.items.length >= 1);
    assert.ok(usersRole.body.items.every((u) => u.role === 'master'), 'role filter before page');
    assert.strictEqual(usersRole.body.total, usersRole.body.items.length > 20 ? usersRole.body.total : usersRole.body.items.length);

    const usersDealer = await get(server, '/api/admin/users?role=dealer', token);
    assert.ok(usersDealer.body.items.some((u) => u.id === dealerUser.id), 'dealer role before page');
    assert.ok(usersDealer.body.items.every((u) => u.role === 'user' && u.dealerStatus === 'approved'));
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log('OK admin page tests');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
