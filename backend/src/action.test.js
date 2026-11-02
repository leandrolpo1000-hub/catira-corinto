const assert = require('assert');
const db = require('./db');
const action = require('./action');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function cleanup(ids) {
  (ids.posts || []).forEach((id) => {
    db.findWhere('actionPostImages', (i) => i.postId === id).forEach((i) => db.remove('actionPostImages', i.id));
    db.findWhere('actionPostLikes', (i) => i.postId === id).forEach((i) => db.remove('actionPostLikes', i.id));
    db.findWhere('actionPostComments', (i) => i.postId === id).forEach((i) => {
      db.findWhere('actionCommentLikes', (l) => l.commentId === i.id).forEach((l) => db.remove('actionCommentLikes', l.id));
      db.remove('actionPostComments', i.id);
    });
    db.findWhere('actionNotifications', (i) => i.postId === id).forEach((i) => db.remove('actionNotifications', i.id));
    db.remove('actionPosts', id);
  });
  (ids.listings || []).forEach((id) => db.remove('listings', id));
  (ids.reports || []).forEach((id) => db.remove('reports', id));
}

async function run() {
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  assert.ok(joao && maria, 'usuários demo');

  const cat = db.findOne('categories', () => true);
  const now = new Date().toISOString();
  const listing = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Catira em Ação geladeira',
    description: 'Item de teste do feed. Não é venda real.',
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

  const ids = { posts: [], listings: [listing.id], reports: [] };
  const ratingBefore = { avg: joao.ratingAvg, count: joao.ratingCount };

  try {
    assert.strictEqual(action.canInvite(listing), false, 'publicado não convida');
    assert.ok(action.looksLikePrice('Vendi por R$ 800'));
    assert.ok(action.looksLikeContact('Me chama no 31999998888'));
    assert.ok(!action.looksLikePrice('Negociação feita em Corinto, item igual ao combinado.'));

    const open = db.findById('listings', listing.id);
    try {
      await action.createPost(joao, { listingId: open.id, text: 'Negociação feita em Corinto.' }, [{ filename: 'x.jpg' }]);
      throw new Error('publicado não deveria aceitar post');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    db.update('listings', listing.id, { status: 'sold' });
    const sold = db.findById('listings', listing.id);
    assert.strictEqual(action.canInvite(sold), true);

    try {
      await action.createPost(joao, { listingId: sold.id, text: 'Foi R$ 500,00 o valor' }, [{ filename: 'x.jpg' }]);
      throw new Error('preço deveria ser recusado');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    try {
      await action.createPost(joao, { listingId: sold.id, text: 'Chama no whatsapp 31988887777' }, [{ filename: 'x.jpg' }]);
      throw new Error('contato deveria ser recusado');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    try {
      await action.createPost(joao, { listingId: sold.id, text: 'Negociação feita em Corinto.' }, []);
      throw new Error('sem foto deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    const unverified = { ...maria, emailVerified: false, role: 'user' };
    try {
      await action.createPost(unverified, { listingId: sold.id, text: 'Negociação feita em Corinto.' }, [{ filename: 'x.jpg' }]);
      throw new Error('e-mail não verificado deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 403);
    }

    try {
      await action.createPost(maria, { listingId: sold.id, text: 'Negociação feita em Corinto.' }, [{ filename: 'x.jpg' }]);
      throw new Error('terceiro não publica o anúncio alheio');
    } catch (e) {
      assert.strictEqual(e.status, 403);
    }

    try {
      action.validateTranscript('Foi R$ 500,00 o valor');
      throw new Error('transcrição com preço deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    try {
      await action.createPost(
        joao,
        { listingId: sold.id, text: 'Negociação feita em Corinto, item igual ao combinado.' },
        [{ filename: 'acao-teste.jpg' }],
        [{ filename: 'a.webm' }, { filename: 'b.webm' }]
      );
      throw new Error('dois áudios deveriam falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    assert.ok(action.isAudioFile({ mimetype: 'audio/webm', originalname: 'x.webm' }));
    assert.ok(!action.isAudioFile({ mimetype: 'image/jpeg', originalname: 'x.jpg' }));

    const post = await action.createPost(
      joao,
      { listingId: sold.id, text: 'Negociação feita em Corinto, item igual ao combinado.' },
      [{ filename: 'acao-teste.jpg' }],
      { filename: 'acao-audio-teste.webm' }
    );
    ids.posts.push(post.id);
    assert.ok(post.id);
    assert.strictEqual(post.status, 'published');
    assert.ok(!('price' in post));
    assert.ok(!post.listingId);
    assert.ok(post.images.length === 1);
    assert.strictEqual(post.audioUrl, '/uploads/acao-audio-teste.webm');
    assert.strictEqual(post.audioTranscript, '');
    assert.strictEqual(action.canInvite(sold), false);

    const feed = action.listPublished({ limit: 30 });
    assert.ok(feed.items.find((p) => p.id === post.id));
    assert.ok(feed.items.every((p) => p.price === undefined));

    try {
      await action.createPost(joao, { listingId: sold.id, text: 'Outra publicação do mesmo item vendido.' }, [{ filename: 'y.jpg' }]);
      throw new Error('duplicata deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 409);
    }

    const report = action.reportPost(maria, post.id, 'falso', 'Foto de terceiro');
    ids.reports.push(report.id);
    assert.strictEqual(report.kind, 'action');

    const liked = action.toggleLike(maria, post.id);
    assert.strictEqual(liked.liked, true);
    assert.strictEqual(liked.likeCount, 1);
    const notices = action.listNotifications(joao);
    assert.ok(notices.items.find((n) => n.type === 'like' && n.postId === post.id));
    const unliked = action.toggleLike(maria, post.id);
    assert.strictEqual(unliked.liked, false);
    assert.strictEqual(unliked.likeCount, 0);
    action.toggleLike(maria, post.id);

    const comment = action.addComment(maria, post.id, 'Parabéns pela negociação, item top.');
    assert.ok(comment.id);
    assert.strictEqual(comment.text.includes('Parabéns'), true);
    const comments = action.listComments(post.id, maria.id);
    assert.strictEqual(comments.length, 1);
    const afterComment = action.listNotifications(joao);
    assert.ok(afterComment.items.find((n) => n.type === 'comment' && n.postId === post.id));

    const likedComment = action.toggleCommentLike(joao, post.id, comment.id);
    assert.strictEqual(likedComment.liked, true);
    assert.strictEqual(likedComment.likeCount, 1);
    const reply = action.addComment(joao, post.id, 'Valeu, deu certo.', comment.id);
    assert.strictEqual(reply.parentId, comment.id);
    assert.strictEqual(action.listComments(post.id).length, 2);

    try {
      action.deleteComment(maria, post.id, comment.id);
    } catch (e) {
      assert.fail('autor do comentário pode excluir o próprio');
    }
    const againComment = action.addComment(maria, post.id, 'Ficou para trás, mas deu certo.');
    const removedByOwner = action.deleteComment(joao, post.id, againComment.id);
    assert.strictEqual(removedByOwner.ok, true);
    assert.strictEqual(action.listComments(post.id).length, 0);

    try {
      action.addComment(maria, post.id, 'Me chama no 31988887777');
      throw new Error('contato no comentário deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    const hidden = action.moderatePost(post.id, 'hide');
    assert.strictEqual(hidden.status, 'hidden');
    const feedHidden = action.listPublished({ limit: 50 });
    assert.ok(!feedHidden.items.find((p) => p.id === post.id));
    assert.strictEqual(action.canInvite(sold), true);

    const again = await action.createPost(joao, { listingId: sold.id, text: 'Republicado depois de ocultar, sem preço.' }, [{ filename: 'z.jpg' }]);
    assert.strictEqual(again.id, post.id);
    assert.strictEqual(again.status, 'published');
    assert.strictEqual(again.audioUrl, '');

    action.moderatePost(post.id, 'remove');
    assert.strictEqual(action.canInvite(sold), false);
    try {
      await action.createPost(joao, { listingId: sold.id, text: 'Tentativa após remoção do admin.' }, [{ filename: 'w.jpg' }]);
      throw new Error('removido não republica');
    } catch (e) {
      assert.strictEqual(e.status, 409);
    }

    const fresh = db.findById('users', joao.id);
    assert.strictEqual(fresh.ratingAvg, ratingBefore.avg);
    assert.strictEqual(fresh.ratingCount, ratingBefore.count);
  } finally {
    cleanup(ids);
  }

  console.log('OK action tests');
}

run();
