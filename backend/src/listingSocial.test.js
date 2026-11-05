const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const helpers = require('./helpers');
const social = require('./listingSocial');
const { authOptional, signToken } = require('./middleware');
const { conversationKey } = require('./helpers');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function cleanup(ids) {
  (ids.listings || []).forEach((id) => {
    db.findWhere('listingLikes', (i) => i.listingId === id).forEach((i) => db.remove('listingLikes', i.id));
    db.findWhere('listingComments', (i) => i.listingId === id).forEach((c) => {
      db.findWhere('listingCommentLikes', (l) => l.commentId === c.id).forEach((l) => db.remove('listingCommentLikes', l.id));
      db.remove('listingComments', c.id);
    });
    db.findWhere('listingNotifications', (i) => i.listingId === id).forEach((i) => db.remove('listingNotifications', i.id));
    db.remove('listings', id);
  });
}

async function run() {
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  assert.ok(joao && maria, 'usuários demo');
  const cat = db.findOne('categories', () => true);
  const now = new Date().toISOString();
  const listing = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Feed busca geladeira',
    description: 'Item de teste do feed de busca.',
    categoryId: cat.id,
    subcategory: '',
    price: 800,
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
    views: 0,
    createdAt: now,
    publishedAt: now,
  });
  const ids = { listings: [listing.id] };
  try {
    const row = helpers.serializeListing(listing, { userId: maria.id, user: maria });
    assert.strictEqual(row.likeCount, 0);
    assert.strictEqual(row.commentCount, 0);
    assert.strictEqual(row.liked, false);

    const liked = social.toggleLike(maria, listing.id);
    assert.strictEqual(liked.liked, true);
    assert.strictEqual(liked.likeCount, 1);
    const notices = social.listNotifications(joao);
    assert.ok(notices.items.find((n) => n.type === 'like' && n.listingId === listing.id));
    const selfLike = social.toggleLike(joao, listing.id);
    assert.strictEqual(selfLike.liked, true);
    assert.ok(!social.listNotifications(joao).items.find((n) => n.type === 'like' && n.actor && n.actor.id === joao.id));
    social.toggleLike(joao, listing.id);

    const comment = social.addComment(maria, listing.id, 'Parabéns, item top da busca.');
    assert.ok(comment.id);
    assert.strictEqual(social.listComments(listing.id, maria.id).length, 1);
    assert.ok(social.listNotifications(joao).items.find((n) => n.type === 'comment'));

    const likedComment = social.toggleCommentLike(joao, listing.id, comment.id);
    assert.strictEqual(likedComment.liked, true);
    assert.strictEqual(likedComment.likeCount, 1);

    const reply = social.addComment(joao, listing.id, 'Valeu, deu certo.', comment.id);
    assert.strictEqual(reply.parentId, comment.id);

    social.deleteComment(maria, listing.id, comment.id);
    assert.strictEqual(social.listComments(listing.id).length, 0);

    const again = social.addComment(maria, listing.id, 'Ficou bom demais o anúncio.');
    social.deleteComment(joao, listing.id, again.id);
    assert.strictEqual(social.listComments(listing.id).length, 0);

    try {
      social.addComment(maria, listing.id, 'Me chama no 31988887777');
      throw new Error('contato deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }
    try {
      social.addComment(maria, listing.id, 'Foi R$ 500,00');
      throw new Error('preço deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    db.insert('listingImages', { listingId: listing.id, url: '/uploads/c.jpg', order: 2 });
    db.insert('listingImages', { listingId: listing.id, url: '/uploads/a.jpg', order: 0 });
    db.insert('listingImages', { listingId: listing.id, url: '/uploads/b.jpg', order: 1 });
    db.insert('payments', {
      userId: joao.id,
      listingId: listing.id,
      amount: 10,
      status: 'pending',
      method: 'pix',
      kind: 'listing',
      createdAt: now,
      userDeclaredAt: now,
    });
    const asOwner = helpers.serializeListing(listing, { userId: joao.id, user: joao });
    const asStranger = helpers.serializeListing(listing, { userId: maria.id, user: maria });
    assert.strictEqual(asStranger.paymentStatus, '');
    assert.strictEqual(asStranger.paymentDeclaredAt, null);
    assert.strictEqual(asOwner.paymentStatus, 'pending');
    assert.strictEqual(asOwner.paymentDeclaredAt, now);
    assert.deepStrictEqual(asOwner.images.map((i) => i.order), [0, 1, 2]);
    assert.deepStrictEqual(asStranger.images.map((i) => i.url), ['/uploads/a.jpg', '/uploads/b.jpg', '/uploads/c.jpg']);
  } finally {
    cleanup(ids);
  }

  await testUserListPagination();
  console.log('OK listing social tests');
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

function pageShape(body, extra) {
  assert.ok(Array.isArray(body.items), 'items array');
  assert.strictEqual(typeof body.total, 'number', 'numeric total');
  assert.strictEqual(typeof body.page, 'number', 'numeric page');
  assert.strictEqual(typeof body.limit, 'number', 'numeric limit');
  if (extra) Object.assign(extra, body);
}

async function testUserListPagination() {
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  const cat = db.findOne('categories', () => true);
  const now = Date.now();
  const listingIds = [];
  const favIds = [];
  const convIds = [];
  const msgIds = [];

  function makeListing(ownerId, i, status) {
    const row = db.insert('listings', {
      userId: ownerId,
      title: '[P9] paginate ' + i,
      description: 'Task 9 pagination fixture.',
      categoryId: cat.id,
      subcategory: '',
      price: 10 + i,
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
      createdAt: new Date(now - i * 1000).toISOString(),
      publishedAt: new Date(now - i * 1000).toISOString(),
    });
    listingIds.push(row.id);
    return row;
  }

  for (let i = 0; i < 21; i++) makeListing(joao.id, i);
  for (let i = 0; i < 21; i++) {
    const l = makeListing(maria.id, 100 + i);
    const fav = db.insert('favorites', {
      userId: joao.id,
      listingId: l.id,
      createdAt: new Date(now - i * 1000).toISOString(),
    });
    favIds.push(fav.id);
  }
  const chatListing = listingIds[0];
  for (let i = 0; i < 21; i++) {
    const conv = db.insert('conversations', {
      key: conversationKey(joao.id, maria.id, 'p9-' + i),
      listingId: chatListing,
      buyerId: joao.id,
      sellerId: maria.id,
      lastMessage: 'p9 ' + i,
      lastAt: new Date(now - i * 1000).toISOString(),
      createdAt: new Date(now - i * 1000).toISOString(),
    });
    convIds.push(conv.id);
  }
  const longConv = convIds[0];
  for (let i = 0; i < 101; i++) {
    const msg = db.insert('messages', {
      conversationId: longConv,
      senderId: i % 2 ? maria.id : joao.id,
      receiverId: i % 2 ? joao.id : maria.id,
      listingId: chatListing,
      text: '[P9] msg ' + i,
      replyToId: null,
      createdAt: new Date(now + i * 1000).toISOString(),
      read: true,
      deleted: false,
      deletedFor: [],
    });
    msgIds.push(msg.id);
  }

  const app = express();
  app.use(express.json());
  app.use(authOptional);
  app.use('/api/listings', require('./routes/listings'));
  app.use('/api', require('./routes/social'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const token = signToken(joao);

  try {
    const mine = await jsonGet(server, '/api/listings/mine', token);
    assert.strictEqual(mine.status, 200);
    pageShape(mine.body);
    assert.ok(mine.body.items.length <= 20, 'mine default page size');
    assert.ok(mine.body.total >= 21, 'mine total includes all owned');
    assert.strictEqual(mine.body.page, 1);
    assert.strictEqual(mine.body.limit, 20);
    const minePage2 = await jsonGet(server, '/api/listings/mine?page=2', token);
    pageShape(minePage2.body);
    assert.strictEqual(minePage2.body.page, 2);
    assert.ok(minePage2.body.items.length >= 1, 'mine page 2 has remainder');
    assert.notStrictEqual(minePage2.body.items[0].id, mine.body.items[0].id);

    const favs = await jsonGet(server, '/api/favorites', token);
    assert.strictEqual(favs.status, 200);
    pageShape(favs.body);
    assert.ok(favs.body.items.length <= 20, 'favorites default page size');
    assert.ok(favs.body.total >= 21, 'favorites total is full set');
    assert.strictEqual(favs.body.limit, 20);

    const convs = await jsonGet(server, '/api/conversations', token);
    assert.strictEqual(convs.status, 200);
    pageShape(convs.body);
    assert.ok(convs.body.items.length <= 20, 'conversations default page size');
    assert.ok(convs.body.total >= 21, 'conversations total is full set');
    assert.strictEqual(convs.body.limit, 20);

    const detail = await jsonGet(server, '/api/conversations/' + longConv, token);
    assert.strictEqual(detail.status, 200);
    assert.ok(Array.isArray(detail.body.messages));
    assert.ok(detail.body.messages.length <= 100, 'conversation messages slice last 100');
    assert.strictEqual(detail.body.messages[detail.body.messages.length - 1].text, '[P9] msg 100');
    assert.ok(!detail.body.messages.some((m) => m.text === '[P9] msg 0'), 'oldest message dropped');

    const profile = await jsonGet(server, '/api/users/' + joao.id);
    assert.strictEqual(profile.status, 200);
    const listingsPage = profile.body.listings && profile.body.listings.items
      ? profile.body.listings
      : profile.body;
    pageShape({
      items: listingsPage.items || profile.body.listings,
      total: listingsPage.total,
      page: listingsPage.page,
      limit: listingsPage.limit,
    });
    const listingItems = listingsPage.items || profile.body.listings;
    assert.ok(listingItems.length <= 20, 'user listings default page size');
    assert.ok((listingsPage.total || profile.body.total) >= 21, 'user listings total is full set');
  } finally {
    await new Promise((r) => server.close(r));
    msgIds.forEach((id) => db.remove('messages', id));
    convIds.forEach((id) => db.remove('conversations', id));
    favIds.forEach((id) => db.remove('favorites', id));
    cleanup({ listings: listingIds });
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
