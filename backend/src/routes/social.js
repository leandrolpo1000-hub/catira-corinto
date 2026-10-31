const express = require('express');
const db = require('../db');
const { authRequired, authOptional, safeUser, isAdminRole } = require('../middleware');
const { serializeListing, conversationKey, recalcRating, rankedSellers, rankOf, sellerScore } = require('../helpers');
const { activeCategories } = require('../categories');
const trades = require('../trades');

const router = express.Router();

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
  if (conv.buyerId !== req.user.id && conv.sellerId !== req.user.id && !(conv.isSupport && isAdminRole(req.user.role))) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  const messages = db
    .findWhere('messages', (m) => m.conversationId === conv.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  messages.forEach((m) => {
    if (m.receiverId === req.user.id && !m.read) db.update('messages', m.id, { read: true });
  });
  const otherId = conv.buyerId === req.user.id ? conv.sellerId : conv.buyerId;
  const listing = db.findById('listings', conv.listingId);
  res.json({
    conversation: {
      ...conv,
      other: safeUser(db.findById('users', otherId)),
      listing: listing ? serializeListing(listing, { user: req.user, userId: req.user.id }) : null,
    },
    messages,
  });
});

router.post('/conversations/:id/messages', authRequired, (req, res) => {
  const conv = db.findById('conversations', req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (conv.buyerId !== req.user.id && conv.sellerId !== req.user.id && !(conv.isSupport && isAdminRole(req.user.role))) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  if (conv.isSupport && conv.status === 'closed') {
    return res.status(400).json({ error: 'Atendimento encerrado. Abra um novo no suporte.' });
  }
  const listing = db.findById('listings', conv.listingId);
  const text = (req.body && req.body.text) || '';
  if (!text.trim()) return res.status(400).json({ error: 'Escreva uma mensagem.' });
  const receiverId = conv.buyerId === req.user.id ? conv.sellerId : conv.buyerId;
  const now = new Date().toISOString();
  const msg = db.insert('messages', {
    conversationId: conv.id,
    senderId: req.user.id,
    receiverId,
    listingId: conv.listingId,
    text: String(text).trim(),
    createdAt: now,
    read: false,
  });
  db.update('conversations', conv.id, { lastMessage: msg.text, lastAt: now });
  res.status(201).json(msg);
});

router.get('/whatsapp/:listingId', authRequired, (req, res) => {
  const listing = db.findById('listings', req.params.listingId);
  if (!listing || listing.status !== 'published') {
    return res.status(404).json({ error: 'Anúncio não encontrado.' });
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
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
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
