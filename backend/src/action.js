const db = require('./db');
const { safeUser, isAdminRole } = require('./middleware');
const { timeAgo, imagesOf } = require('./helpers');

const DONE_STATUSES = ['sold', 'traded', 'negotiated'];
const TEXT_MAX = 500;
const TRANSCRIPT_MAX = 2000;
const MIN_PHOTOS = 1;
const MAX_PHOTOS = 8;
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.webm', '.aac', '.3gp'];

function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
}

function imagesOfPost(postId) {
  return db
    .findWhere('actionPostImages', (i) => i.postId === postId)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((i) => ({ id: i.id, url: i.url, order: i.order || 0 }));
}

function looksLikePrice(text) {
  const s = String(text || '');
  if (/R\$\s*\d/i.test(s)) return true;
  if (/\b\d{1,3}(?:\.\d{3})+,\d{2}\b/.test(s)) return true;
  if (/\b\d+,\d{2}\b/.test(s) && /(real|reais|preco|preço|valor|por)/i.test(s)) return true;
  return false;
}

function looksLikeContact(text) {
  const s = String(text || '');
  if (/wa\.me\/|whatsapp|api\.whatsapp/i.test(s)) return true;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 10 && /\d[\d\s().-]{8,}\d/.test(s)) return true;
  if (/@/.test(s) && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)) return true;
  return false;
}

function validateCaption(raw) {
  const text = String(raw || '').trim().slice(0, TEXT_MAX);
  if (text.length < 8) throw httpError(400, 'Escreva um texto com pelo menos 8 caracteres.');
  if (looksLikePrice(text)) throw httpError(400, 'Não informe preço nem valor da negociação.');
  if (looksLikeContact(text)) throw httpError(400, 'Não informe telefone, e-mail ou WhatsApp na publicação.');
  return text;
}

function validateTranscript(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, TRANSCRIPT_MAX);
  if (!text) return '';
  if (looksLikePrice(text)) throw httpError(400, 'O áudio não pode informar preço nem valor da negociação.');
  if (looksLikeContact(text)) throw httpError(400, 'O áudio não pode informar telefone, e-mail ou WhatsApp.');
  return text;
}

function isAudioFile(file) {
  const mime = String((file && file.mimetype) || '');
  const name = String((file && file.originalname) || (file && file.filename) || '');
  if (/^audio\//i.test(mime)) return true;
  return AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

async function buildAudioFields(audioFile) {
  if (!audioFile) return { audioUrl: '', audioTranscript: '' };
  const name = audioFile.filename || '';
  if (!name) return { audioUrl: '', audioTranscript: '' };
  let raw = '';
  if (audioFile.path) {
    try {
      const { transcribeAudio } = require('./assistant');
      raw = await transcribeAudio(audioFile.path, audioFile.originalname, audioFile.mimetype);
    } catch {
      raw = '';
    }
  }
  return {
    audioUrl: '/uploads/' + name,
    audioTranscript: validateTranscript(raw),
  };
}

function postOfListing(listingId) {
  if (!listingId) return null;
  return db.findOne('actionPosts', (p) => p.listingId === listingId);
}

function canInvite(listing) {
  if (!listing || !DONE_STATUSES.includes(listing.status)) return false;
  const existing = postOfListing(listing.id);
  return !existing || existing.status === 'hidden';
}

function publishedPost(id) {
  const post = db.findById('actionPosts', id);
  if (!post || post.status !== 'published') throw httpError(404, 'Publicação não encontrada.');
  return post;
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

function serializeComment(c, viewerId) {
  if (!c) return null;
  const likes = db.findWhere('actionCommentLikes', (l) => l.commentId === c.id);
  return {
    id: c.id,
    postId: c.postId,
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

function socialOf(postId, viewerId) {
  const likes = db.findWhere('actionPostLikes', (l) => l.postId === postId);
  const comments = db.findWhere('actionPostComments', (c) => c.postId === postId);
  return {
    likeCount: likes.length,
    commentCount: comments.length,
    liked: viewerId ? likes.some((l) => l.userId === viewerId) : false,
  };
}

function serializePost(p, opts = {}) {
  if (!p) return null;
  const author = safeUser(db.findById('users', p.userId));
  const social = socialOf(p.id, opts.viewerId);
  const row = {
    id: p.id,
    text: p.text,
    status: p.status,
    createdAt: p.createdAt,
    timeAgo: timeAgo(p.createdAt),
    images: imagesOfPost(p.id),
    audioUrl: p.audioUrl || '',
    audioTranscript: p.audioTranscript || '',
    author,
    likeCount: social.likeCount,
    commentCount: social.commentCount,
    liked: social.liked,
  };
  if (opts.admin) {
    const listing = db.findById('listings', p.listingId);
    row.listingId = p.listingId || '';
    row.listingTitle = listing ? listing.title : '';
    row.listingStatus = listing ? listing.status : '';
    row.userId = p.userId;
  }
  return row;
}

function listPublished(query) {
  const userId = query && query.userId;
  let rows = db.findWhere('actionPosts', (p) => p.status === 'published');
  if (userId) rows = rows.filter((p) => p.userId === userId);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = Math.max(1, parseInt((query && query.page) || '1', 10));
  const limit = Math.min(30, Math.max(1, parseInt((query && query.limit) || '12', 10)));
  const start = (page - 1) * limit;
  const viewerId = query && query.viewerId;
  return {
    items: rows.slice(start, start + limit).map((p) => serializePost(p, { viewerId })),
    total: rows.length,
    page,
    limit,
  };
}

function eligibleListings(user) {
  if (!user) return [];
  const listings = db.findWhere(
    'listings',
    (l) => l.userId === user.id && DONE_STATUSES.includes(l.status)
  );
  return listings
    .filter((l) => !postOfListing(l.id) || postOfListing(l.id).status === 'hidden')
    .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt))
    .map((l) => ({
      id: l.id,
      title: l.title,
      status: l.status,
      city: l.city,
      images: imagesOf(l.id).slice(0, 1).map((i) => ({ id: i.id, url: i.url })),
    }));
}

function assertCanPublish(user, listing) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  if (!isAdminRole(user.role) && !user.emailVerified) {
    throw httpError(403, 'Confirme seu e-mail para publicar.', { emailVerifyRequired: true });
  }
  if (!listing) throw httpError(404, 'Anúncio não encontrado.');
  if (listing.userId !== user.id && !isAdminRole(user.role)) {
    throw httpError(403, 'Só o dono do anúncio pode publicar.');
  }
  if (require('./official').isOfficialListing(listing)) {
    throw httpError(403, 'Produto oficial não participa do Catira em Ação.');
  }
  if (!DONE_STATUSES.includes(listing.status)) {
    throw httpError(400, 'Publique só depois de marcar o anúncio como vendido, trocado ou negociado.');
  }
  const existing = postOfListing(listing.id);
  if (existing && existing.status !== 'hidden') {
    throw httpError(409, 'Este anúncio já tem uma publicação no Catira em Ação.');
  }
  return existing;
}

async function createPost(user, body, files, audioFile) {
  const listing = db.findById('listings', body && body.listingId);
  const existing = assertCanPublish(user, listing);
  const text = validateCaption(body && body.text);
  const photos = Array.isArray(files) ? files.slice(0, MAX_PHOTOS) : [];
  if (photos.length < MIN_PHOTOS) throw httpError(400, 'Envie pelo menos uma foto.');
  const audio = Array.isArray(audioFile) ? audioFile[0] : audioFile;
  if (Array.isArray(audioFile) && audioFile.length > 1) {
    throw httpError(400, 'Envie no máximo um áudio.');
  }
  const audioFields = await buildAudioFields(audio);
  const now = new Date().toISOString();
  let post;
  if (existing && existing.status === 'hidden') {
    post = db.update('actionPosts', existing.id, {
      text,
      status: 'published',
      updatedAt: now,
      audioUrl: audioFields.audioUrl,
      audioTranscript: audioFields.audioTranscript,
    });
    db.findWhere('actionPostImages', (i) => i.postId === post.id).forEach((i) => db.remove('actionPostImages', i.id));
  } else {
    post = db.insert('actionPosts', {
      userId: user.id,
      listingId: listing.id,
      text,
      status: 'published',
      createdAt: now,
      updatedAt: now,
      audioUrl: audioFields.audioUrl,
      audioTranscript: audioFields.audioTranscript,
    });
  }
  photos.forEach((f, idx) => {
    db.insert('actionPostImages', {
      postId: post.id,
      url: `/uploads/${f.filename}`,
      order: idx,
    });
  });
  return serializePost(post);
}

function listAdmin(query) {
  const status = query && query.status;
  let rows = db.all('actionPosts');
  if (status) rows = rows.filter((p) => p.status === status);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { items: rows.map((p) => serializePost(p, { admin: true })), total: rows.length };
}

function moderatePost(id, action) {
  const post = db.findById('actionPosts', id);
  if (!post) throw httpError(404, 'Publicação não encontrada.');
  let status = post.status;
  if (action === 'hide') status = 'hidden';
  else if (action === 'restore') status = 'published';
  else if (action === 'remove') status = 'removed';
  else throw httpError(400, 'Ação inválida.');
  const updated = db.update('actionPosts', post.id, { status, updatedAt: new Date().toISOString() });
  return serializePost(updated, { admin: true });
}

function reportPost(user, postId, reason, description) {
  const post = publishedPost(postId);
  const allowed = ['golpe', 'falso', 'inadequado', 'enganoso', 'outro'];
  if (!allowed.includes(reason)) throw httpError(400, 'Motivo inválido.');
  return db.insert('reports', {
    listingId: post.listingId || '',
    postId: post.id,
    kind: 'action',
    reporterId: user.id,
    reason,
    description: description ? String(description).trim().slice(0, 400) : '',
    status: 'open',
    createdAt: new Date().toISOString(),
  });
}

function notifyOwner(post, type, actor, text) {
  if (!post || !actor || post.userId === actor.id) return null;
  return db.insert('actionNotifications', {
    userId: post.userId,
    type,
    postId: post.id,
    actorId: actor.id,
    text: String(text || '').slice(0, 240),
    read: false,
    createdAt: new Date().toISOString(),
  });
}

function toggleLike(user, postId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const post = publishedPost(postId);
  const existing = db.findOne('actionPostLikes', (l) => l.postId === post.id && l.userId === user.id);
  if (existing) {
    db.remove('actionPostLikes', existing.id);
    return serializePost(post, { viewerId: user.id });
  }
  db.insert('actionPostLikes', {
    postId: post.id,
    userId: user.id,
    createdAt: new Date().toISOString(),
  });
  notifyOwner(post, 'like', user, (user.name || 'Alguém') + ' curtiu sua publicação.');
  return serializePost(post, { viewerId: user.id });
}

function listComments(postId, viewerId) {
  publishedPost(postId);
  return db
    .findWhere('actionPostComments', (c) => c.postId === postId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((c) => serializeComment(c, viewerId));
}

function addComment(user, postId, raw, parentId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const post = publishedPost(postId);
  const text = String(raw || '').trim().slice(0, 240);
  if (text.length < 1) throw httpError(400, 'Escreva um comentário.');
  if (looksLikePrice(text)) throw httpError(400, 'Não informe preço no comentário.');
  if (looksLikeContact(text)) throw httpError(400, 'Não informe telefone, e-mail ou WhatsApp no comentário.');
  let replyOf = null;
  if (parentId) {
    replyOf = db.findById('actionPostComments', parentId);
    if (!replyOf || replyOf.postId !== post.id) throw httpError(400, 'Comentário original não encontrado.');
    if (replyOf.parentId) {
      const root = db.findById('actionPostComments', replyOf.parentId);
      if (root) replyOf = root;
    }
  }
  const comment = db.insert('actionPostComments', {
    postId: post.id,
    userId: user.id,
    parentId: replyOf ? replyOf.id : null,
    text,
    createdAt: new Date().toISOString(),
  });
  notifyOwner(post, 'comment', user, (user.name || 'Alguém') + ' comentou: ' + text);
  if (replyOf && replyOf.userId !== user.id && replyOf.userId !== post.userId) {
    db.insert('actionNotifications', {
      userId: replyOf.userId,
      type: 'reply',
      postId: post.id,
      actorId: user.id,
      text: (user.name || 'Alguém') + ' respondeu: ' + text,
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  return serializeComment(comment, user.id);
}

function toggleCommentLike(user, postId, commentId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const post = publishedPost(postId);
  const comment = db.findById('actionPostComments', commentId);
  if (!comment || comment.postId !== post.id) throw httpError(404, 'Comentário não encontrado.');
  const existing = db.findOne('actionCommentLikes', (l) => l.commentId === comment.id && l.userId === user.id);
  if (existing) {
    db.remove('actionCommentLikes', existing.id);
    return serializeComment(comment, user.id);
  }
  db.insert('actionCommentLikes', {
    commentId: comment.id,
    userId: user.id,
    createdAt: new Date().toISOString(),
  });
  if (comment.userId !== user.id) {
    db.insert('actionNotifications', {
      userId: comment.userId,
      type: 'comment_like',
      postId: post.id,
      actorId: user.id,
      text: (user.name || 'Alguém') + ' curtiu seu comentário.',
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  return serializeComment(comment, user.id);
}

function deleteComment(user, postId, commentId) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const post = publishedPost(postId);
  const comment = db.findById('actionPostComments', commentId);
  if (!comment || comment.postId !== post.id) throw httpError(404, 'Comentário não encontrado.');
  const owner = post.userId === user.id;
  const mine = comment.userId === user.id;
  if (!owner && !mine && !isAdminRole(user.role)) {
    throw httpError(403, 'Só o autor da publicação pode excluir este comentário.');
  }
  const rows = [comment].concat(db.findWhere('actionPostComments', (c) => c.parentId === comment.id));
  rows.forEach((row) => {
    db.findWhere('actionCommentLikes', (l) => l.commentId === row.id).forEach((l) => db.remove('actionCommentLikes', l.id));
    db.remove('actionPostComments', row.id);
  });
  return { ok: true, id: comment.id };
}

function listNotifications(user) {
  if (!user) throw httpError(401, 'Faça login para continuar.');
  const rows = db
    .findWhere('actionNotifications', (n) => n.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 80);
  return {
    items: rows.map((n) => ({
      id: n.id,
      type: n.type,
      postId: n.postId,
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
  db.findWhere('actionNotifications', (n) => n.userId === user.id && !n.read).forEach((n) => {
    db.update('actionNotifications', n.id, { read: true });
  });
  return { ok: true };
}

module.exports = {
  DONE_STATUSES,
  MIN_PHOTOS,
  MAX_PHOTOS,
  canInvite,
  serializePost,
  listPublished,
  eligibleListings,
  createPost,
  listAdmin,
  moderatePost,
  reportPost,
  toggleLike,
  listComments,
  addComment,
  toggleCommentLike,
  deleteComment,
  listNotifications,
  markNotificationsRead,
  looksLikePrice,
  looksLikeContact,
  isAudioFile,
  validateTranscript,
};
