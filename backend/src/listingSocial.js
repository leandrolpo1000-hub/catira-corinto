const db = require('./db');
const { safeUser, isAdminRole } = require('./middleware');
const { looksLikePrice, looksLikeContact } = require('./action');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function commentTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return min + 'min';
  const h = Math.floor(min / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd';
  const w = Math.floor(d / 7);
  if (w < 5) return w + 'sem';
  const months = Math.floor(d / 30);
  if (months < 12) return months + 'mês';
  return Math.floor(d / 365) + 'a';
}

function publishedListing(id) {
  const listing = db.findById('listings', id);
  if (!listing || listing.status !== 'published') throw httpError(404, 'Anúncio não encontrado.');
  return listing;
}

// Produto oficial não tem curtidas, comentários nem notificações sociais.
function socialListing(id) {
  const listing = publishedListing(id);
  if (require('./official').isOfficialListing(listing)) {
    throw httpError(403, 'Produto oficial não tem interações sociais.');
  }
  return listing;
}

function serializeComment(c, viewerId) {
  if (!c) return null;
  const likes = db.findWhere('listingCommentLikes', (l) => l.commentId === c.id);
  return {
    id: c.id,
    listingId: c.listingId,
    parentId: c.parentId || null,
    text: c.text,
    createdAt: c.createdAt,
    timeAgo: commentTimeAgo(c.createdAt),
    userId: c.userId,
    author: safeUser(db.findById('users', c.userId)),
    likeCount: likes.length,
    liked: viewerId ? likes.some((l) => l.userId === viewerId) : false,
  };
}

function socialOf(listingId, viewerId) {
  const likes = db.findWhere('listingLikes', (l) => l.listingId === listingId);
  const comments = db.findWhere('listingComments', (c) => c.listingId === listingId);
  return {
    likeCount: likes.length,
    commentCount: comments.length,
    liked: viewerId ? likes.some((l) => l.userId === viewerId) : false,
  };
}

function notifyOwner(listing, type, actor, text) {
  if (!listing || !actor || listing.userId === actor.id) return null;
  if (require('./official').isOfficialListing(listing)) return null;
  return db.insert('listingNotifications', {
    userId: listing.userId,
    type,
    listingId: listing.id,
    actorId: actor.id,
    text: String(text || '').slice(0, 240),
    read: false,
    createdAt: new Date().toISOString(),
  });
}

function toggleLike(user, listingId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const listing = socialListing(listingId);
  const existing = db.findOne('listingLikes', (l) => l.listingId === listing.id && l.userId === user.id);
  const { serializeListing } = require('./helpers');
  if (existing) {
    db.remove('listingLikes', existing.id);
    return serializeListing(listing, { userId: user.id, user });
  }
  db.insert('listingLikes', {
    listingId: listing.id,
    userId: user.id,
    createdAt: new Date().toISOString(),
  });
  notifyOwner(listing, 'like', user, (user.name || 'Alguém') + ' curtiu seu anúncio.');
  return serializeListing(listing, { userId: user.id, user });
}

function listComments(listingId, viewerId) {
  socialListing(listingId);
  return db
    .findWhere('listingComments', (c) => c.listingId === listingId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((c) => serializeComment(c, viewerId));
}

function addComment(user, listingId, raw, parentId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const listing = socialListing(listingId);
  const text = String(raw || '').trim().slice(0, 240);
  if (text.length < 1) throw httpError(400, 'Escreva um comentário.');
  if (looksLikePrice(text)) throw httpError(400, 'Não informe preço no comentário.');
  if (looksLikeContact(text)) throw httpError(400, 'Não informe telefone, e-mail ou WhatsApp no comentário.');
  let replyOf = null;
  if (parentId) {
    replyOf = db.findById('listingComments', parentId);
    if (!replyOf || replyOf.listingId !== listing.id) throw httpError(400, 'Comentário original não encontrado.');
    if (replyOf.parentId) {
      const root = db.findById('listingComments', replyOf.parentId);
      if (root) replyOf = root;
    }
  }
  const comment = db.insert('listingComments', {
    listingId: listing.id,
    userId: user.id,
    parentId: replyOf ? replyOf.id : null,
    text,
    createdAt: new Date().toISOString(),
  });
  notifyOwner(listing, 'comment', user, (user.name || 'Alguém') + ' comentou: ' + text);
  if (replyOf && replyOf.userId !== user.id && replyOf.userId !== listing.userId) {
    db.insert('listingNotifications', {
      userId: replyOf.userId,
      type: 'reply',
      listingId: listing.id,
      actorId: user.id,
      text: (user.name || 'Alguém') + ' respondeu: ' + text,
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  return serializeComment(comment, user.id);
}

function toggleCommentLike(user, listingId, commentId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const listing = socialListing(listingId);
  const comment = db.findById('listingComments', commentId);
  if (!comment || comment.listingId !== listing.id) throw httpError(404, 'Comentário não encontrado.');
  const existing = db.findOne('listingCommentLikes', (l) => l.commentId === comment.id && l.userId === user.id);
  if (existing) {
    db.remove('listingCommentLikes', existing.id);
    return serializeComment(comment, user.id);
  }
  db.insert('listingCommentLikes', {
    commentId: comment.id,
    userId: user.id,
    createdAt: new Date().toISOString(),
  });
  if (comment.userId !== user.id) {
    db.insert('listingNotifications', {
      userId: comment.userId,
      type: 'comment_like',
      listingId: listing.id,
      actorId: user.id,
      text: (user.name || 'Alguém') + ' curtiu seu comentário.',
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  return serializeComment(comment, user.id);
}

function deleteComment(user, listingId, commentId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const listing = socialListing(listingId);
  const comment = db.findById('listingComments', commentId);
  if (!comment || comment.listingId !== listing.id) throw httpError(404, 'Comentário não encontrado.');
  const owner = listing.userId === user.id;
  const mine = comment.userId === user.id;
  if (!owner && !mine && !isAdminRole(user.role)) {
    throw httpError(403, 'Só o autor do anúncio pode excluir este comentário.');
  }
  const rows = [comment].concat(db.findWhere('listingComments', (c) => c.parentId === comment.id));
  rows.forEach((row) => {
    db.findWhere('listingCommentLikes', (l) => l.commentId === row.id).forEach((l) => db.remove('listingCommentLikes', l.id));
    db.remove('listingComments', row.id);
  });
  return { ok: true, id: comment.id };
}

function listNotifications(user) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const { timeAgo } = require('./helpers');
  const rows = db
    .findWhere('listingNotifications', (n) => n.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 80);
  return {
    items: rows.map((n) => ({
      id: n.id,
      type: n.type,
      listingId: n.listingId,
      text: n.text,
      read: !!n.read,
      createdAt: n.createdAt,
      timeAgo: timeAgo(n.createdAt),
      actor: safeUser(db.findById('users', n.actorId)),
    })),
    unread: rows.filter((n) => !n.read).length,
  };
}

function markNotificationsRead(user) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  db.findWhere('listingNotifications', (n) => n.userId === user.id && !n.read).forEach((n) => {
    db.update('listingNotifications', n.id, { read: true });
  });
  return { ok: true };
}

module.exports = {
  socialOf,
  toggleLike,
  listComments,
  addComment,
  toggleCommentLike,
  deleteComment,
  listNotifications,
  markNotificationsRead,
};
