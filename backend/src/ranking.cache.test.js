const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const helpers = require('./helpers');
const { authOptional, signToken } = require('./middleware');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function jsonRequest(server, { method, path, token, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: method || 'GET',
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeListing(userId, title, cat, status) {
  const now = new Date().toISOString();
  return db.insert('listings', {
    userId,
    title,
    description: 'Item de teste do cache de ranking.',
    categoryId: cat.id,
    subcategory: '',
    price: 120,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    acceptsTrade: false,
    acceptsCash: true,
    tradeWishes: '',
    status: status || 'published',
    featured: false,
    vip: false,
    premium: false,
    views: 0,
    createdAt: now,
    publishedAt: now,
  });
}

async function run() {
  assert.strictEqual(typeof helpers.invalidateRanking, 'function', 'invalidateRanking exportado');

  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  const master = db.findOne('users', (u) => u.role === 'master');
  assert.ok(joao && maria && master, 'usuários demo');
  const cat = db.findOne('categories', () => true);
  const listing = makeListing(joao.id, '[TESTE] ranking cache sold', cat);
  const reviewListing = makeListing(joao.id, '[TESTE] ranking cache review', cat);
  const favListing = makeListing(joao.id, '[TESTE] ranking cache fav', cat);
  const viewListing = makeListing(joao.id, '[TESTE] ranking cache view', cat);
  const created = [listing.id, reviewListing.id, favListing.id, viewListing.id];

  helpers.invalidateRanking();
  const first = helpers.rankedSellers();
  const second = helpers.rankedSellers();
  assert.strictEqual(second, first, 'duas chamadas em 30s devolvem a mesma referência');
  assert.ok(Array.isArray(first) && first.length > 0, 'ranking tem vendedores');

  helpers.invalidateRanking();
  const third = helpers.rankedSellers();
  assert.notStrictEqual(third, first, 'após invalidateRanking recomputa');
  assert.deepStrictEqual(
    third.map((u) => u.id),
    first.map((u) => u.id),
    'snapshot de ids permanece estável sem mutação'
  );
  const favIds = [];
  const reviewIds = [];

  const app = express();
  app.use(express.json());
  app.use(authOptional);
  app.use('/api/listings', require('./routes/listings'));
  app.use('/api', require('./routes/social'));
  app.use('/api/admin', require('./routes/admin'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const joaoToken = signToken(joao);
  const mariaToken = signToken(maria);
  const masterToken = signToken(master);

  try {
    helpers.invalidateRanking();
    const ranked = await jsonRequest(server, { path: '/api/ranking?limit=5' });
    assert.strictEqual(ranked.status, 200);
    assert.ok(Array.isArray(ranked.body.items), 'ranking devolve items');
    assert.ok(ranked.body.items.length <= 5, 'limit=5 fatia depois do compute');
    assert.ok(ranked.body.total >= ranked.body.items.length, 'total é o ranking completo');
    const cached = helpers.rankedSellers();
    assert.strictEqual(ranked.body.items.length, Math.min(5, cached.length));
    assert.deepStrictEqual(
      ranked.body.items.map((u) => u.id),
      cached.slice(0, 5).map((u) => u.id),
      'slice usa o array computado'
    );

    helpers.invalidateRanking();
    const beforeFav = helpers.rankedSellers();
    const favAdd = await jsonRequest(server, {
      method: 'POST',
      path: '/api/favorites/' + favListing.id,
      token: mariaToken,
    });
    assert.strictEqual(favAdd.status, 200);
    assert.strictEqual(favAdd.body.favorited, true);
    db.findWhere('favorites', (f) => f.listingId === favListing.id).forEach((f) => favIds.push(f.id));
    const afterFav = helpers.rankedSellers();
    assert.notStrictEqual(afterFav, beforeFav, 'favoritar invalida o cache');

    const beforeUnfav = helpers.rankedSellers();
    const favRemove = await jsonRequest(server, {
      method: 'POST',
      path: '/api/favorites/' + favListing.id,
      token: mariaToken,
    });
    assert.strictEqual(favRemove.status, 200);
    assert.strictEqual(favRemove.body.favorited, false);
    const afterUnfav = helpers.rankedSellers();
    assert.notStrictEqual(afterUnfav, beforeUnfav, 'desfavoritar invalida o cache');

    helpers.invalidateRanking();
    const beforeSold = helpers.rankedSellers();
    const sold = await jsonRequest(server, {
      method: 'POST',
      path: '/api/listings/' + listing.id + '/status',
      token: joaoToken,
      body: { action: 'sold' },
    });
    assert.strictEqual(sold.status, 200);
    assert.strictEqual(sold.body.status, 'sold');
    const afterSold = helpers.rankedSellers();
    assert.notStrictEqual(afterSold, beforeSold, 'status sold invalida o cache');

    helpers.invalidateRanking();
    const beforeReview = helpers.rankedSellers();
    const review = await jsonRequest(server, {
      method: 'POST',
      path: '/api/listings/' + reviewListing.id + '/reviews',
      token: mariaToken,
      body: { rating: 5, comment: 'ótimo' },
    });
    assert.strictEqual(review.status, 200);
    if (review.body && review.body.review && review.body.review.id) reviewIds.push(review.body.review.id);
    const afterReview = helpers.rankedSellers();
    assert.notStrictEqual(afterReview, beforeReview, 'review de anúncio invalida o cache');

    helpers.invalidateRanking();
    const beforeView = helpers.rankedSellers();
    const viewed = await jsonRequest(server, { path: '/api/listings/' + viewListing.id });
    assert.strictEqual(viewed.status, 200);
    const afterView = helpers.rankedSellers();
    assert.strictEqual(afterView, beforeView, 'view não invalida o cache');

    const target = db.insert('users', {
      name: 'Ranking Block Target',
      email: 'ranking.block.' + Date.now() + '@test.local',
      phone: '38980000000',
      city: 'Corinto',
      cityId: 'corinto',
      passwordHash: 'x',
      role: 'user',
      status: 'active',
      phoneVerified: true,
      emailVerified: true,
      createdAt: new Date().toISOString(),
      ratingAvg: 0,
      ratingCount: 0,
      avatarColor: '#E85D04',
    });
    const blockListing = makeListing(target.id, '[TESTE] ranking cache block', cat);
    created.push(blockListing.id);

    helpers.invalidateRanking();
    const beforeBlock = helpers.rankedSellers();
    const blocked = await jsonRequest(server, {
      method: 'POST',
      path: '/api/admin/users/' + target.id + '/status',
      token: masterToken,
      body: { status: 'blocked' },
    });
    assert.strictEqual(blocked.status, 200);
    assert.strictEqual(blocked.body.status, 'blocked');
    const afterBlock = helpers.rankedSellers();
    assert.notStrictEqual(afterBlock, beforeBlock, 'bloquear usuário invalida o cache');
    assert.ok(!afterBlock.some((u) => u.id === target.id), 'usuário bloqueado sai do ranking');

    db.remove('users', target.id);
  } finally {
    await new Promise((r) => server.close(r));
    reviewIds.forEach((id) => db.remove('listingReviews', id));
    favIds.forEach((id) => {
      if (db.findById('favorites', id)) db.remove('favorites', id);
    });
    created.forEach((id) => {
      db.findWhere('favorites', (f) => f.listingId === id).forEach((f) => db.remove('favorites', f.id));
      db.findWhere('listingReviews', (r) => r.listingId === id).forEach((r) => db.remove('listingReviews', r.id));
      db.remove('listings', id);
    });
    helpers.invalidateRanking();
  }

  console.log('OK ranking cache tests');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
