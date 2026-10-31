const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const db = require('../db');
const { authRequired, authOptional, emailVerifiedRequired, isAdminRole } = require('../middleware');
const { getAuctionConfig, publicAuctionConfig, flagOn } = require('../auctions/config');
const { resolveCategory } = require('../categories');
const {
  serializeAuction,
  placeBid,
  statusOf,
  bumpViews,
  reputationProfile,
  ranking,
  nextBidFor,
  round2,
  watcherCount,
  isWatching,
} = require('../auctions/engine');
const { publicLotVisible, ensureEditions, editionProgram } = require('../auctions/editions');

const router = express.Router();

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 8) || '.jpg';
    cb(null, randomUUID() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Envie apenas imagens.'));
    cb(null, true);
  },
});

const DELIVERY = ['retirada', 'entrega', 'ambos'];

function guardEnabled(_req, res, next) {
  if (!getAuctionConfig().flags.auction_enabled) {
    return res.status(403).json({ error: 'A área de leilões está desativada.' });
  }
  next();
}

function imagesOf(auctionId) {
  return db
    .findWhere('auctionImages', (i) => i.auctionId === auctionId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function applyFilters(list, q) {
  let out = list.slice();
  const search = String(q.q || q.search || '').trim().toLowerCase();
  if (search) {
    out = out.filter((a) => {
      const cat = db.findById('categories', a.categoryId);
      const hay = [a.title, a.description, cat && cat.name, a.city].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search);
    });
  }
  if (q.category) {
    const cat = resolveCategory(q.category);
    if (cat) out = out.filter((a) => a.categoryId === cat.id);
  }
  if (q.city) {
    const city = String(q.city).toLowerCase();
    out = out.filter((a) => (a.cityId && a.cityId === q.city) || (a.city && a.city.toLowerCase().includes(city)));
  }
  const min = Number(q.minPrice);
  const max = Number(q.maxPrice);
  const priceOf = (a) => Number(a.currentBid != null && a.bidCount ? a.currentBid : a.startingBid) || 0;
  if (Number.isFinite(min) && min > 0) out = out.filter((a) => priceOf(a) >= min);
  if (Number.isFinite(max) && max > 0) out = out.filter((a) => priceOf(a) <= max);
  return out;
}

router.get('/config', (_req, res) => {
  res.json(publicAuctionConfig());
});

router.get('/', authOptional, (req, res) => {
  const cfg = getAuctionConfig();
  if (!cfg.flags.auction_enabled) return res.json({ total: 0, items: [], enabled: false, flags: cfg.flags });
  const uid = req.user && req.user.id;
  ensureEditions();
  let list = db.findWhere('auctions', (a) => a.status !== 'cancelled' && statusOf(a) !== 'cancelled' && publicLotVisible(a, req.user));
  if (req.query.mine === 'true' && uid) list = list.filter((a) => a.userId === uid);
  const section = req.query.section;
  if (section === 'live') list = list.filter((a) => statusOf(a) === 'live');
  else if (section === 'ending') list = list.filter((a) => statusOf(a) === 'live');
  else if (section === 'scheduled') list = list.filter((a) => statusOf(a) === 'scheduled');
  else list = list.filter((a) => statusOf(a) !== 'ended' || req.query.ended === 'true');
  list = applyFilters(list, req.query);
  const sort = req.query.sort || (section === 'ending' ? 'ending' : 'recent');
  if (sort === 'ending') out_sort_end(list);
  else if (sort === 'bids') list.sort((a, b) => (b.bidCount || 0) - (a.bidCount || 0));
  else if (sort === 'price_asc') list.sort((a, b) => (a.currentBid || a.startingBid) - (b.currentBid || b.startingBid));
  else if (sort === 'price_desc') list.sort((a, b) => (b.currentBid || b.startingBid) - (a.currentBid || a.startingBid));
  else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit || '24', 10)));
  const items = list.slice((page - 1) * limit, (page - 1) * limit + limit).map((a) => serializeAuction(a, { user: req.user, light: true, cfg }));
  res.json({ total: list.length, page, limit, enabled: true, flags: cfg.flags, items });
});

function out_sort_end(list) {
  list.sort((a, b) => new Date(a.endAt) - new Date(b.endAt));
}

router.get('/mine', authRequired, (req, res) => {
  const items = db
    .findWhere('auctions', (a) => a.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((a) => serializeAuction(a, { user: req.user }));
  res.json({ items });
});

router.get('/watching', authRequired, (req, res) => {
  const ids = db.findWhere('auctionWatchers', (w) => w.userId === req.user.id).map((w) => w.auctionId);
  const items = ids
    .map((id) => db.findById('auctions', id))
    .filter(Boolean)
    .map((a) => serializeAuction(a, { user: req.user }));
  res.json({ items });
});

router.get('/won', authRequired, (req, res) => {
  const rows = db.findWhere('auctionWinners', (w) => w.userId === req.user.id);
  const items = rows
    .map((w) => ({ win: w, auction: db.findById('auctions', w.auctionId) }))
    .filter((x) => x.auction)
    .sort((a, b) => new Date(b.win.wonAt) - new Date(a.win.wonAt))
    .map((x) => {
      const s = serializeAuction(x.auction, { user: req.user });
      return { ...s, win: {
        id: x.win.id,
        status: x.win.status,
        amount: round2(x.win.amount),
        paymentDeadline: x.win.paymentDeadline,
        paidAt: x.win.paidAt,
        completedAt: x.win.completedAt,
        cancelledReason: x.win.cancelledReason || '',
      } };
    });
  res.json({ items });
});

router.get('/notifications', authRequired, (req, res) => {
  const items = db
    .findWhere('auctionNotifications', (n) => n.userId === req.user.id && n.userId !== '')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);
  res.json({ items, unread: items.filter((n) => !n.read).length });
});

router.post('/notifications/read', authRequired, (req, res) => {
  db.batch(() => {
    db.findWhere('auctionNotifications', (n) => n.userId === req.user.id && !n.read).forEach((n) => {
      db.update('auctionNotifications', n.id, { read: true });
    });
  });
  res.json({ ok: true });
});

router.get('/reputation/:userId', authOptional, (req, res) => {
  const user = db.findById('users', req.params.userId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({
    user: { id: user.id, name: user.name },
    reputation: reputationProfile(user.id),
  });
});

router.get('/ranking', authOptional, (req, res) => {
  const cfg = getAuctionConfig();
  if (!cfg.flags.auction_ranking_enabled) return res.json({ items: [], metric: null });
  res.json(ranking(req.query.metric, Number(req.query.limit) || 50));
});

router.get('/sunday', authOptional, (req, res) => {
  res.json(editionProgram({ user: req.user, compact: req.query.compact === '1' }));
});

router.post('/early-unlock', authRequired, (req, res) => {
  const cfg = getAuctionConfig();
  if (!cfg.flags.auction_early_unlock_enabled) {
    return res.status(403).json({ error: 'O desbloqueio antecipado está desativado.' });
  }
  const rep = reputationProfile(req.user.id);
  const blocked = rep.permanentPenalty || (rep.currentPenaltyUntil && new Date(rep.currentPenaltyUntil).getTime() > Date.now());
  if (!blocked) return res.status(400).json({ error: 'Você não está bloqueado no momento.' });
  const maxUses = Number(cfg.settings.earlyUnlockMaxUses) || 0;
  if (maxUses && rep.earlyUnlockUses >= maxUses) {
    return res.status(400).json({ error: 'Você já usou o desbloqueio antecipado o número máximo de vezes.' });
  }
  const fee = Number(cfg.settings.earlyUnlockFee) || 0;
  const payment = db.insert('auctionPayments', {
    auctionId: '',
    winnerId: req.user.id,
    sellerId: '',
    amount: fee,
    kind: 'early_unlock',
    method: 'pix',
    status: 'PENDING_PAYMENT',
    dueAt: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
    paidAt: null,
    confirmedAt: null,
    declaredAt: null,
  });
  res.status(201).json({ payment, message: fee > 0 ? 'Gere o PIX da taxa de reativação.' : 'Reativação gratuita aguardando confirmação.' });
});

router.get('/:id', authOptional, (req, res) => {
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  const isOwner = req.user && req.user.id === a.userId;
  const isAdmin = req.user && isAdminRole(req.user.role);
  if (!isOwner && !isAdmin && !publicLotVisible(a, req.user)) return res.status(404).json({ error: 'Leilão não encontrado.' });
  if (a.status === 'cancelled' && !isOwner && !isAdmin) return res.status(404).json({ error: 'Leilão não encontrado.' });
  if (a.status !== 'ended' && a.status !== 'cancelled') bumpViews(a.id);
  res.json(serializeAuction(a, { user: req.user }));
});

router.get('/:id/bids', authOptional, (req, res) => {
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  const cfg = getAuctionConfig();
  const mode = cfg.settings.displayNames;
  const bids = db
    .findWhere('auctionBids', (b) => b.auctionId === a.id)
    .sort((x, y) => Number(y.amount) - Number(x.amount))
    .slice(0, 50)
    .map((b) => {
      const user = db.findById('users', b.userId);
      return {
        id: b.id,
        amount: round2(b.amount),
        at: b.createdAt,
        mine: req.user && req.user.id === b.userId,
        bidder: require('../auctions/engine').publicName(user, mode),
      };
    });
  res.json({ items: bids, bidCount: a.bidCount || 0 });
});

router.post('/:id/watch', authRequired, (req, res) => {
  const cfg = getAuctionConfig();
  if (!cfg.flags.auction_watchers_enabled) return res.status(403).json({ error: 'Acompanhar leilões está desativado.' });
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  const existing = db.findOne('auctionWatchers', (w) => w.auctionId === a.id && w.userId === req.user.id);
  if (existing) {
    db.remove('auctionWatchers', existing.id);
    return res.json({ watching: false, watcherCount: watcherCount(a.id) });
  }
  db.insert('auctionWatchers', { auctionId: a.id, userId: req.user.id, createdAt: new Date().toISOString() });
  res.json({ watching: true, watcherCount: watcherCount(a.id) });
});

router.post('/:id/bids', authRequired, (req, res) => {
  try {
    const a = db.findById('auctions', req.params.id);
    if (a && !publicLotVisible(a, req.user) && !isAdminRole(req.user.role)) {
      return res.status(404).json({ error: 'Leilão não encontrado.' });
    }
    const result = placeBid(req.params.id, req.user, req.body && req.body.amount);
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Não foi possível dar o lance.', penalized: !!e.penalized });
  }
});

router.post('/:id/cancel', authRequired, (req, res) => {
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  if (a.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  if (a.bidCount > 0 && a.userId === req.user.id && !isAdminRole(req.user.role)) {
    return res.status(400).json({ error: 'Já existem lances. Fale com o suporte para cancelar.' });
  }
  db.update('auctions', a.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledReason: String((req.body && req.body.reason) || '').slice(0, 300) });
  res.json({ ok: true });
});

router.get('/:id/payment', authRequired, async (req, res) => {
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  const winner = db.findOne('auctionWinners', (w) => w.auctionId === a.id);
  if (!winner) return res.status(404).json({ error: 'Este leilão não tem arremate.' });
  if (winner.userId !== req.user.id && a.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  let payment = db.findOne('auctionPayments', (p) => p.auctionId === a.id && p.kind === 'auction_winner');
  const cfg = require('../pix').getSettings();
  if (payment && !payment.pixCode && cfg.configured) {
    const { pixPayload } = require('../helpers');
    const built = pixPayload(a.id, payment.amount);
    if (built && built.pixCode) {
      payment = db.update('auctionPayments', payment.id, { pixCode: built.pixCode, transactionId: built.transactionId });
    }
  }
  let qrDataUrl = '';
  if (payment && payment.pixCode) {
    try {
      const QRCode = require('qrcode');
      qrDataUrl = await QRCode.toDataURL(payment.pixCode, { margin: 1, width: 280 });
    } catch {}
  }
  res.json({
    winner: {
      id: winner.id,
      status: winner.status,
      amount: round2(winner.amount),
      paymentDeadline: winner.paymentDeadline,
      paidAt: winner.paidAt,
    },
    payment: payment ? {
      id: payment.id,
      amount: payment.amount,
      status: payment.status,
      method: payment.method,
      pixCode: payment.pixCode || '',
      qrDataUrl,
      dueAt: payment.dueAt,
      declaredAt: payment.declaredAt || null,
      configured: cfg.configured,
      pixKey: cfg.pixKey || '',
      merchantName: cfg.merchantName || '',
    } : null,
  });
});

router.post('/:id/pay', authRequired, (req, res) => {
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  const winner = db.findOne('auctionWinners', (w) => w.auctionId === a.id && w.userId === req.user.id);
  if (!winner) return res.status(403).json({ error: 'Você não é o arrematador deste leilão.' });
  if (winner.status === 'EXPIRED' || winner.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Este arremate não está mais disponível para pagamento.' });
  }
  if (winner.status === 'PAID' || winner.status === 'COMPLETED') {
    return res.json({ ok: true, message: 'Pagamento já confirmado.' });
  }
  const payment = db.findOne('auctionPayments', (p) => p.auctionId === a.id && p.kind === 'auction_winner');
  if (payment) db.update('auctionPayments', payment.id, { declaredAt: new Date().toISOString() });
  res.json({ ok: true, message: 'Pagamento informado. A confirmação pode levar até 1 hora.' });
});

router.post('/', authRequired, emailVerifiedRequired, upload.array('photos', 8), (req, res) => {
  const cfg = getAuctionConfig();
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
  if (!isAdminRole(req.user && req.user.role)) {
    cleanup();
    return res.status(403).json({ error: 'Somente o administrador cria leilão.' });
  }
  if (!cfg.flags.auction_enabled) {
    cleanup();
    return res.status(403).json({ error: 'A área de leilões está desativada.' });
  }
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const description = String(b.description || title).trim();
  const categoryId = String(b.categoryId || '');
  const cat = categoryId ? db.findById('categories', categoryId) : db.findOne('categories', () => true);
  const startingBid = Number(String(b.startingBid || '').replace(',', '.'));
  const minIncrement = Number(String(b.minIncrement || cfg.settings.minIncrement).replace(',', '.'));
  if (!title) {
    cleanup();
    return res.status(400).json({ error: 'Informe o título do lote.' });
  }
  if (!cat) {
    cleanup();
    return res.status(400).json({ error: 'Categoria inválida.' });
  }
  if (!files.length) {
    cleanup();
    return res.status(400).json({ error: 'Adicione pelo menos uma foto do produto.' });
  }
  if (!Number.isFinite(startingBid) || startingBid < Number(cfg.settings.startingBidMin)) {
    cleanup();
    return res.status(400).json({ error: 'O lance inicial mínimo é R$ ' + Number(cfg.settings.startingBidMin).toFixed(2) + '.' });
  }
  if (!Number.isFinite(minIncrement) || minIncrement < 1) {
    cleanup();
    return res.status(400).json({ error: 'O incremento mínimo deve ser de pelo menos R$ 1,00.' });
  }
  const minH = Number(cfg.settings.minDurationHours);
  const maxH = Number(cfg.settings.maxDurationHours);
  const durationHours = Number(b.durationHours || minH);
  if (!Number.isFinite(durationHours) || durationHours < minH || durationHours > maxH) {
    cleanup();
    return res.status(400).json({ error: 'A duração deve ficar entre ' + minH + ' e ' + maxH + ' horas.' });
  }
  const startAt = b.startAt ? new Date(b.startAt) : new Date();
  if (Number.isNaN(startAt.getTime())) {
    cleanup();
    return res.status(400).json({ error: 'Data de início inválida.' });
  }
  const endAt = new Date(startAt.getTime() + durationHours * 3600000);
  if (endAt.getTime() <= Date.now()) {
    cleanup();
    return res.status(400).json({ error: 'O encerramento precisa ser no futuro.' });
  }
  const deliveryMethod = DELIVERY.includes(b.deliveryMethod) ? b.deliveryMethod : 'retirada';
  const pickupInfo = String(b.pickupInfo || 'Retirada em Corinto, combinamos o horário.').trim().slice(0, 400);
  if ((deliveryMethod === 'retirada' || deliveryMethod === 'ambos') && !pickupInfo) {
    cleanup();
    return res.status(400).json({ error: 'Informe como a retirada será feita.' });
  }
  const auction = db.insert('auctions', {
    userId: req.user.id,
    title: title.slice(0, 120),
    description: description.slice(0, 4000),
    categoryId: cat.id,
    subcategory: String(b.subcategory || '').slice(0, 80),
    city: String(b.city || req.user.city || '').slice(0, 80),
    cityId: String(b.cityId || req.user.cityId || ''),
    startingBid: round2(startingBid),
    minIncrement: round2(minIncrement),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    originalEndAt: endAt.toISOString(),
    durationHours,
    deliveryMethod,
    pickupInfo,
    extraInfo: String(b.extraInfo || '').slice(0, 1000),
    sellerRules: String(b.sellerRules || '').slice(0, 1000),
    status: startAt.getTime() <= Date.now() ? 'live' : 'scheduled',
    startedAt: startAt.getTime() <= Date.now() ? new Date().toISOString() : null,
    currentBid: null,
    currentBidderId: null,
    bidCount: 0,
    extensionCount: 0,
    winnerId: null,
    winnerAmount: null,
    views: 0,
    createdAt: new Date().toISOString(),
  });
  db.batch(() => {
    files.forEach((f, i) => {
      db.insert('auctionImages', { auctionId: auction.id, url: '/uploads/' + f.filename, order: i });
    });
  });
  if (req.user.id) {
    const { ensureReputation } = require('../auctions/engine');
    ensureReputation(req.user.id);
  }
  res.status(201).json(serializeAuction(auction, { user: req.user }));
});

module.exports = router;
