const assert = require('assert');
const db = require('./db');
const helpers = require('./helpers');
const social = require('./listingSocial');

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

function run() {
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
  } finally {
    cleanup(ids);
  }
  console.log('OK listing social tests');
}

run();
