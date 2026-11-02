const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const db = require('../db');
const { authRequired, authOptional, safeUser, isAdminRole } = require('../middleware');
const { serializeListing, conversationKey, recalcRating, rankedSellers, rankOf, sellerScore } = require('../helpers');
const { activeCategories } = require('../categories');
const trades = require('../trades');

const router = express.Router();

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const CHAT_AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.webm', '.aac', '.3gp', '.mp4'];

function isChatAudio(file) {
  const mime = String((file && file.mimetype) || '');
  if (/^audio\//i.test(mime)) return true;
  if (/^video\/webm$/i.test(mime)) return true;
  const name = String((file && file.originalname) || '');
  return CHAT_AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext));
}

const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const audio = isChatAudio(file);
      const fallback = audio ? '.webm' : '.jpg';
      const ext = (path.extname(file.originalname || '') || fallback).slice(0, 8).toLowerCase();
      cb(null, (audio ? 'chat-audio-' : 'chat-img-') + randomUUID() + ext);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//i.test(file.mimetype) || isChatAudio(file)) return cb(null, true);
    cb(new Error('Envie apenas foto ou áudio.'));
  },
});

// Upload opcional: mensagens de texto continuam aceitando JSON puro.
function receiveChatFile(req, res, next) {
  if (!/^multipart\/form-data/i.test(String(req.headers['content-type'] || ''))) return next();
  chatUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    let message = err.message || 'Falha no envio do arquivo.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'O arquivo pode ter no máximo 8 MB.';
    return res.status(400).json({ error: message });
  });
}

router.get('/categories', (_req, res) => {
  res.json(activeCategories());
});

router.post('/favorites/:listingId', authRequired, (req, res) => {
  const listing = db.findById('listings', req.params.listingId);
  if (!listing || listing.status !== 'published') {
    return res.status(404).json({ error: 'Anúncio não encontrado.' });
  }
  const existing = db.findOne(
    'favorites',
    (f) => f.userId === req.user.id && f.listingId === listing.id
  );
  if (existing) {
    db.remove('favorites', existing.id);
    return res.json({ favorited: false });
  }
  db.insert('favorites', {
    userId: req.user.id,
    listingId: listing.id,
    createdAt: new Date().toISOString(),
  });
  res.json({ favorited: true });
});

router.get('/favorites', authRequired, (req, res) => {
  const favs = db.findWhere('favorites', (f) => f.userId === req.user.id);
  const items = favs
    .map((f) => db.findById('listings', f.listingId))
    .filter(Boolean)
    .map((l) => serializeListing(l, { favorited: true, user: req.user, userId: req.user.id }));
  res.json({ items });
});

router.post('/interest', authRequired, (req, res) => {
  const { listingId, message } = req.body || {};
  const listing = db.findById('listings', listingId);
  if (!listing || listing.status !== 'published') {
    return res.status(404).json({ error: 'Anúncio não encontrado.' });
  }
  if (require('../official').isOfficialListing(listing)) {
    return res.status(403).json({ error: 'Produto oficial não abre conversa com vendedor.' });
  }
  if (listing.userId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode demonstrar interesse no próprio anúncio.' });
  }
  const blocked = db.findOne(
    'blocks',
    (b) =>
      (b.blockerId === listing.userId && b.blockedId === req.user.id) ||
      (b.blockerId === req.user.id && b.blockedId === listing.userId)
  );
  if (blocked) return res.status(403).json({ error: 'Não é possível iniciar contato.' });

  const now = new Date().toISOString();
  const key = conversationKey(req.user.id, listing.userId, listing.id);
  let conv = db.findOne('conversations', (c) => c.key === key);
  if (!conv) {
    conv = db.insert('conversations', {
      key,
      listingId: listing.id,
      buyerId: req.user.id,
      sellerId: listing.userId,
      lastMessage: message || 'Tenho interesse neste anúncio.',
      lastAt: now,
      createdAt: now,
    });
  }
  const msg = db.insert('messages', {
    conversationId: conv.id,
    senderId: req.user.id,
    receiverId: listing.userId,
    listingId: listing.id,
    text: message || 'Olá! Tenho interesse neste anúncio.',
    createdAt: now,
    read: false,
  });
  db.update('conversations', conv.id, { lastMessage: msg.text, lastAt: now });
  res.status(201).json({ conversationId: conv.id, message: msg });
});

router.get('/support', authRequired, (req, res) => {
  if (isAdminRole(req.user.role)) {
    return res.status(400).json({ error: 'Você é do suporte. Veja as conversas em Mensagens.' });
  }
  const admin =
    db.findOne('users', (u) => u.role === 'master' && u.status !== 'blocked') ||
    db.findOne('users', (u) => u.role === 'admin' && u.status !== 'blocked');
  if (!admin) return res.status(404).json({ error: 'Suporte indisponível no momento.' });
  const key = 'support:' + req.user.id;
  const now = new Date().toISOString();
  let conv = db.findOne('conversations', (c) => c.key === key);
  if (conv && conv.status === 'closed') conv = null;
  if (!conv) {
    const welcome = 'Olá! Você está falando com o suporte do CATIRA. Descreva sua dúvida ou problema que vamos responder por aqui.';
    conv = db.insert('conversations', {
      key,
      listingId: null,
      buyerId: req.user.id,
      sellerId: admin.id,
      isSupport: true,
      lastMessage: welcome,
      lastAt: now,
      createdAt: now,
    });
    db.insert('messages', {
      conversationId: conv.id,
      senderId: admin.id,
      receiverId: req.user.id,
      listingId: null,
      text: welcome,
      createdAt: now,
      read: false,
    });
  }
  res.json({ conversationId: conv.id });
});

// Mensagens de uma conversa já filtradas para quem está olhando:
// apagadas para todos somem, apagadas só para mim ficam fora da minha lista.
const DELETED_TEXT = 'Esta mensagem foi apagada';

function messagePreview(m) {
  if (!m) return DELETED_TEXT;
  if (m.deleted) return DELETED_TEXT;
  if (m.kind === 'image') return '[Foto]' + (m.text ? ' ' + m.text : '');
  if (m.kind === 'audio') return '[Áudio]' + (m.text ? ' ' + m.text : '');
  return m.text || '';
}

function visibleMessages(conversationId, viewerId) {
  return db
    .findWhere('messages', (m) => m.conversationId === conversationId)
    .filter((m) => !(m.deletedFor || []).includes(viewerId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((m) => {
      const reactions = db
        .findWhere('messageReactions', (r) => r.messageId === m.id)
        .map((r) => r.emoji);
      const starred = !!db.findOne('messageStars', (s) => s.messageId === m.id && s.userId === viewerId);
      const reply = m.replyToId ? db.findById('messages', m.replyToId) : null;
      const kind = m.deleted ? 'deleted' : m.kind || 'text';
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        text: m.deleted ? DELETED_TEXT : m.text,
        kind,
        fileUrl: m.deleted ? '' : m.fileUrl || '',
        duration: m.deleted ? 0 : m.duration || 0,
        deleted: !!m.deleted,
        createdAt: m.createdAt,
        read: !!m.read,
        reactions,
        starred,
        replyTo: reply && !reply.deleted
          ? { id: reply.id, senderId: reply.senderId, text: reply.text, kind: reply.kind || 'text' }
          : null,
        mine: m.senderId === viewerId,
      };
    });
}

function canUseConversation(conv, user) {
  if (!conv) return false;
  if (conv.buyerId === user.id || conv.sellerId === user.id) return true;
  return !!(conv.isSupport && isAdminRole(user.role));
}

function unreadCount(conversationId, userId) {
  return db.count(
    'messages',
    (m) =>
      m.conversationId === conversationId &&
      m.receiverId === userId &&
      !m.read &&
      !(m.deletedFor || []).includes(userId)
  );
}

router.get('/conversations', authRequired, (req, res) => {
  const isAdmin = isAdminRole(req.user.role);
  const closedOnly = isAdmin && req.query.status === 'closed';
  let list = db.findWhere(
    'conversations',
    (c) =>
      c.buyerId === req.user.id ||
      c.sellerId === req.user.id ||
      (isAdmin && c.isSupport)
  );
  list = list.filter((c) => {
    const closed = !!(c.isSupport && c.status === 'closed');
    return closedOnly ? closed : !closed;
  });
  const items = list
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
    .map((c) => {
      const otherId = c.buyerId === req.user.id ? c.sellerId : c.buyerId;
      const listing = db.findById('listings', c.listingId);
      return {
        ...c,
        other: safeUser(db.findById('users', otherId)),
        listing: listing ? serializeListing(listing, { user: req.user, userId: req.user.id }) : null,
        unread: unreadCount(c.id, req.user.id),
      };
    });
  res.json({ items });
});

router.post('/conversations/:id/close', authRequired, (req, res) => {
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'Sem permissão.' });
  const conv = db.findById('conversations', req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (!conv.isSupport) return res.status(400).json({ error: 'Só o atendimento do suporte pode ser encerrado.' });
  const now = new Date().toISOString();
  const updated = db.update('conversations', conv.id, {
    status: 'closed',
    closedAt: now,
    closedBy: req.user.id,
    lastAt: now,
    lastMessage: 'Atendimento encerrado pelo suporte.',
  });
  res.json({ ok: true, conversation: updated });
});

router.get('/conversations/:id', authRequired, (req, res) => {
  const conv = db.findById('conversations', req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (!canUseConversation(conv, req.user)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  db.findWhere(
    'messages',
    (m) => m.conversationId === conv.id && m.receiverId === req.user.id && !m.read
  ).forEach((m) => db.update('messages', m.id, { read: true }));
  const otherId = conv.buyerId === req.user.id ? conv.sellerId : conv.buyerId;
  const listing = db.findById('listings', conv.listingId);
  res.json({
    conversation: {
      ...conv,
      other: safeUser(db.findById('users', otherId)),
      listing: listing ? serializeListing(listing, { user: req.user, userId: req.user.id }) : null,
    },
    messages: visibleMessages(conv.id, req.user.id),
  });
});

router.post('/conversations/:id/messages', authRequired, receiveChatFile, (req, res) => {
  const conv = db.findById('conversations', req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (!canUseConversation(conv, req.user)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  if (conv.isSupport && conv.status === 'closed') {
    return res.status(400).json({ error: 'Atendimento encerrado. Abra um novo no suporte.' });
  }
  const body = req.body || {};
  const text = String(body.text || '').trim().slice(0, 2000);
  const file = req.file;
  if (!text && !file) return res.status(400).json({ error: 'Escreva uma mensagem.' });
  const audio = file && isChatAudio(file);
  const kind = file ? (audio ? 'audio' : 'image') : 'text';
  const duration = Math.max(0, Math.min(3600, Math.round(Number(body.duration) || 0)));
  const replyToId = body.replyToId ? String(body.replyToId) : null;
  const replyTo = replyToId ? db.findById('messages', replyToId) : null;
  const receiverId = conv.buyerId === req.user.id ? conv.sellerId : conv.buyerId;
  const now = new Date().toISOString();
  const msg = db.insert('messages', {
    conversationId: conv.id,
    senderId: req.user.id,
    receiverId,
    listingId: conv.listingId,
    text,
    kind,
    fileUrl: file ? '/uploads/' + file.filename : '',
    duration: audio ? duration : 0,
    replyToId: replyTo && replyTo.conversationId === conv.id ? replyTo.id : null,
    createdAt: now,
    read: false,
    deleted: false,
    deletedFor: [],
  });
  db.update('conversations', conv.id, { lastMessage: messagePreview(msg), lastAt: now });
  res.status(201).json(msg);
});

// Reação por emoji (uma por pessoa por mensagem, como no WhatsApp).
router.post('/conversations/:id/messages/:messageId/reaction', authRequired, (req, res) => {
  const conv = db.findById('conversations', req.params.id);
  if (!conv || !canUseConversation(conv, req.user)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  const msg = db.findById('messages', req.params.messageId);
  if (!msg || msg.conversationId !== conv.id) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }
  const emoji = String((req.body && req.body.emoji) || '').trim();
  if (!emoji) return res.status(400).json({ error: 'Escolha um emoji.' });
  const existing = db.findOne(
    'messageReactions',
    (r) => r.messageId === msg.id && r.userId === req.user.id
  );
  if (existing && existing.emoji === emoji) {
    db.remove('messageReactions', existing.id);
  } else if (existing) {
    db.update('messageReactions', existing.id, { emoji });
  } else {
    db.insert('messageReactions', {
      messageId: msg.id,
      conversationId: conv.id,
      userId: req.user.id,
      emoji,
      createdAt: new Date().toISOString(),
    });
  }
  res.json({ ok: true, message: visibleMessages(conv.id, req.user.id).find((m) => m.id === msg.id) });
});

// Favoritar (estrela) mensagem, só para mim.
router.post('/conversations/:id/messages/:messageId/star', authRequired, (req, res) => {
  const conv = db.findById('conversations', req.params.id);
  if (!conv || !canUseConversation(conv, req.user)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  const msg = db.findById('messages', req.params.messageId);
  if (!msg || msg.conversationId !== conv.id) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }
  const existing = db.findOne(
    'messageStars',
    (s) => s.messageId === msg.id && s.userId === req.user.id
  );
  if (existing) db.remove('messageStars', existing.id);
  else {
    db.insert('messageStars', {
      messageId: msg.id,
      conversationId: conv.id,
      userId: req.user.id,
      createdAt: new Date().toISOString(),
    });
  }
  res.json({ ok: true, starred: !existing });
});

// Apagar: para todos, ou apenas da minha lista (como no WhatsApp).
router.delete('/conversations/:id/messages/:messageId', authRequired, (req, res) => {
  const conv = db.findById('conversations', req.params.id);
  if (!conv || !canUseConversation(conv, req.user)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  const msg = db.findById('messages', req.params.messageId);
  if (!msg || msg.conversationId !== conv.id) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }
  const forAll = String((req.query && req.query.forAll) || '') === '1';
  if (forAll) {
    if (msg.senderId !== req.user.id && !isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Só quem enviou pode apagar para todos.' });
    }
    db.update('messages', msg.id, { deleted: true, text: DELETED_TEXT });
    db.findWhere('messageReactions', (r) => r.messageId === msg.id).forEach((r) => db.remove('messageReactions', r.id));
    const last = db
      .findWhere('messages', (m) => m.conversationId === conv.id && !m.deleted)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    db.update('conversations', conv.id, { lastMessage: messagePreview(last) });
  } else {
    const hidden = Array.from(new Set([...(msg.deletedFor || []), req.user.id]));
    db.update('messages', msg.id, { deletedFor: hidden });
  }
  res.json({ ok: true, forAll, message: visibleMessages(conv.id, req.user.id).find((m) => m.id === msg.id) || null });
});

router.get('/whatsapp/:listingId', authRequired, (req, res) => {
  const listing = db.findById('listings', req.params.listingId);
  if (!listing || listing.status !== 'published') {
    return res.status(404).json({ error: 'Anúncio não encontrado.' });
  }
  if (require('../official').isOfficialListing(listing)) {
    return res.status(403).json({ error: 'Produto oficial não gera contato pessoal.' });
  }
  if (listing.userId === req.user.id) {
    return res.status(400).json({ error: 'Este é o seu anúncio.' });
  }
  const seller = db.findById('users', listing.userId);
  const phone = seller && seller.phone ? seller.phone.replace(/\D/g, '') : '';
  const text = encodeURIComponent(
    `Olá! Vi seu anúncio "${listing.title}" no CATIRA e tenho interesse.`
  );
  res.json({
    url: `https://wa.me/55${phone}?text=${text}`,
    phoneMasked: phone ? phone.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) *****-$3') : '',
  });
});

router.post('/trades', authRequired, (req, res) => {
  try {
    const proposal = trades.createTrade(req.user, req.body || {});
    res.status(201).json(proposal);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
  }
});

router.get('/trades', authRequired, (req, res) => {
  res.json({ items: trades.listTrades(req.user) });
});

router.post('/trades/:id/status', authRequired, (req, res) => {
  try {
    const updated = trades.setTradeStatus(req.user, req.params.id, req.body && req.body.action);
    res.json(updated);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
  }
});

router.post('/reports', authRequired, (req, res) => {
  const { listingId, reason, description } = req.body || {};
  const listing = db.findById('listings', listingId);
  if (!listing) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const allowed = ['golpe', 'proibido', 'falso', 'inadequado', 'preco', 'enganoso', 'outro'];
  if (!allowed.includes(reason)) return res.status(400).json({ error: 'Motivo inválido.' });
  const report = db.insert('reports', {
    listingId,
    reporterId: req.user.id,
    reason,
    description: description ? String(description).trim() : '',
    status: 'open',
    createdAt: new Date().toISOString(),
  });
  res.status(201).json(report);
});

router.post('/block/:userId', authRequired, (req, res) => {
  if (req.params.userId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode bloquear a si mesmo.' });
  }
  const target = db.findById('users', req.params.userId);
  if (!target || require('../official').isPlatformUser(target)) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  const existing = db.findOne(
    'blocks',
    (b) => b.blockerId === req.user.id && b.blockedId === target.id
  );
  if (existing) {
    db.remove('blocks', existing.id);
    return res.json({ blocked: false });
  }
  db.insert('blocks', {
    blockerId: req.user.id,
    blockedId: target.id,
    createdAt: new Date().toISOString(),
  });
  res.json({ blocked: true });
});

router.post('/reviews', authRequired, (req, res) => {
  const { listingId, reviewedUserId, rating, comment } = req.body || {};
  const listing = db.findById('listings', listingId);
  if (!listing) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (require('../official').isOfficialListing(listing)) {
    return res.status(403).json({ error: 'Produtos oficiais não recebem avaliações.' });
  }
  const r = Number(rating);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Nota de 1 a 5.' });
  const finished = db.findOne(
    'tradeProposals',
    (t) =>
      t.listingId === listingId &&
      t.status === 'finished' &&
      (t.proposerId === req.user.id || t.ownerId === req.user.id)
  );
  const soldOk = listing.status === 'sold' && (listing.userId === req.user.id || reviewedUserId === listing.userId);
  if (!finished && !soldOk) {
    return res.status(400).json({ error: 'Só é possível avaliar após a negociação ser concluída.' });
  }
  const exists = db.findOne(
    'reviews',
    (x) => x.reviewerId === req.user.id && x.listingId === listingId && x.reviewedUserId === reviewedUserId
  );
  if (exists) return res.status(409).json({ error: 'Você já avaliou esta negociação.' });
  const review = db.insert('reviews', {
    reviewerId: req.user.id,
    reviewedUserId,
    listingId,
    rating: r,
    comment: comment ? String(comment).trim() : '',
    createdAt: new Date().toISOString(),
  });
  recalcRating(reviewedUserId);
  res.status(201).json(review);
});

router.get('/alerts', authRequired, (req, res) => {
  const items = db
    .findWhere('alerts', (a) => a.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map((a) => ({
      ...a,
      hits: (a.hits || []).map((h) => ({
        ...h,
        listing: db.findById('listings', h.listingId)
          ? serializeListing(db.findById('listings', h.listingId), { user: req.user, userId: req.user.id })
          : null,
      })),
    }));
  res.json({ items });
});

router.post('/alerts', authRequired, (req, res) => {
  const query = String((req.body && req.body.query) || '').trim().slice(0, 80);
  const categoryId = (req.body && req.body.categoryId) || '';
  if (!query && !categoryId) return res.status(400).json({ error: 'Informe o que você quer acompanhar.' });
  const exists = db.findOne(
    'alerts',
    (a) => a.userId === req.user.id && String(a.query || '').toLowerCase() === query.toLowerCase() && (a.categoryId || '') === categoryId
  );
  if (exists) return res.json(exists);
  const row = db.insert('alerts', {
    userId: req.user.id,
    query,
    categoryId,
    hits: [],
    createdAt: new Date().toISOString(),
  });
  res.status(201).json(row);
});

router.delete('/alerts/:id', authRequired, (req, res) => {
  const a = db.findById('alerts', req.params.id);
  if (!a || a.userId !== req.user.id) return res.status(404).json({ error: 'Alerta não encontrado.' });
  db.remove('alerts', a.id);
  res.json({ ok: true });
});

router.get('/ranking', (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const items = rankedSellers();
  res.json({ items: items.slice(0, limit), total: items.length });
});

router.get('/users/:id', authOptional, (req, res) => {
  const user = db.findById('users', req.params.id);
  if (!user || user.status === 'blocked') return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (require('../official').isPlatformUser(user)) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  const listings = db
    .findWhere('listings', (l) => l.userId === user.id && l.status === 'published')
    .map((l) => serializeListing(l));
  const reviews = db.findWhere('reviews', (r) => r.reviewedUserId === user.id);
  const stats = sellerScore(user);
  res.json({
    user: { ...safeUser(user), rank: rankOf(user.id), ...stats },
    listings,
    reviews: reviews.map((r) => ({
      ...r,
      reviewer: safeUser(db.findById('users', r.reviewerId)),
    })),
  });
});

module.exports = router;
