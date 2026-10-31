const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const db = require('../db');
const { adminRequired, masterRequired, isAdminRole } = require('../middleware');
const { adminAuctionConfig, saveAuctionConfig, getAuctionConfig } = require('../auctions/config');
const {
  serializeAuction,
  reputationProfile,
  round2,
  ensureReputation,
  updateCompletion,
  addPoints,
  notify,
  applyPenalty,
  statusOf,
} = require('../auctions/engine');
const {
  ensureEditions,
  allEditions,
  lotsOf,
  serializeEdition,
  createEdition,
  applyLotSequence,
  reorderEditionLots,
  editionProgram,
} = require('../auctions/editions');

const AUDIO_DIR = path.join(__dirname, '..', '..', 'data', 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const AUDIO_TRACKS = {
  durante: 'Durante',
  arrematado: 'Arrematado',
  contagem: 'Contagem regressiva',
  tensao: 'Clima de tensão',
  ultimo: 'Ultimo lote',
  importante: 'Lote Importante',
  novo: 'Novo lote',
  antes: 'Antes de começar',
};
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a'];

function audioExtOf(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (AUDIO_EXTS.includes(ext)) return ext;
  const mime = String(file.mimetype || '');
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return '.m4a';
  return '';
}

function findAudioFile(id) {
  const name = AUDIO_TRACKS[id];
  if (!name) return null;
  const found = AUDIO_EXTS.map((ext) => name + ext).find((f) => fs.existsSync(path.join(AUDIO_DIR, f)));
  return found ? path.join(AUDIO_DIR, found) : null;
}

function listAudioFiles() {
  const out = {};
  Object.keys(AUDIO_TRACKS).forEach((id) => {
    out[id] = findAudioFile(id) ? '/audio/' + id : '';
  });
  return out;
}

function mimeOf(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.m4a') return 'audio/mp4';
  return 'application/octet-stream';
}

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8) || '.jpg';
      cb(null, randomUUID() + ext);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Envie apenas imagens.'));
    cb(null, true);
  },
});

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
    filename: (req, file, cb) => {
      const id = String(req.params.id || '');
      const name = AUDIO_TRACKS[id];
      const ext = audioExtOf(file);
      if (!name || !ext) return cb(new Error('Faixa ou formato inválido.'));
      AUDIO_EXTS.forEach((e) => {
        const p = path.join(AUDIO_DIR, name + e);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      });
      cb(null, name + ext);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^audio\//.test(file.mimetype) && !/\.(mp3|wav|ogg|m4a)$/i.test(file.originalname || '')) {
      return cb(new Error('Envie um arquivo de áudio (mp3, wav, ogg ou m4a).'));
    }
    cb(null, true);
  },
});

const router = express.Router();
router.use(adminRequired);

router.get('/config', (req, res) => {
  res.json({ ...adminAuctionConfig(), audioFiles: listAudioFiles() });
});

router.get('/audio', (req, res) => {
  res.json({ files: listAudioFiles() });
});

router.post('/audio/:id', masterRequired, audioUpload.single('file'), (req, res) => {
  const id = String(req.params.id || '');
  if (!AUDIO_TRACKS[id]) return res.status(400).json({ error: 'Faixa inválida.' });
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo de áudio.' });
  res.json({ ok: true, files: listAudioFiles() });
});

router.put('/config', masterRequired, (req, res) => {
  const body = req.body || {};
  const next = saveAuctionConfig(
    { flags: body.flags, notifications: body.notifications, settings: body.settings },
    req.user
  );
  res.json(next);
});

const SCHEDULE_KEYS = [
  'sundayEventWeekday',
  'sundayTimezone',
  'sundayOpenTime',
  'sundayFirstRoundStart',
  'sundayFirstRoundEnd',
  'sundayWarmupStart',
  'sundayWarmupEnd',
  'sundayMainStart',
  'sundayMainEnd',
  'sundayFinalLotTime',
  'sundayDefaultDurationMinutes',
  'sundayLotIntervalMinutes',
];

router.put('/schedule', (req, res) => {
  const body = req.body || {};
  const settings = {};
  SCHEDULE_KEYS.forEach((k) => {
    if (body[k] !== undefined) settings[k] = body[k];
  });
  res.json(saveAuctionConfig({ settings }, req.user));
});

router.get('/logs', masterRequired, (req, res) => {
  const items = db
    .all('auctionAdminLogs')
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 300);
  res.json({ items });
});

router.get('/overview', (req, res) => {
  const auctions = db.all('auctions');
  const winners = db.all('auctionWinners');
  const bids = db.all('auctionBids');
  const penalties = db.all('auctionPenalties');
  res.json({
    total: auctions.length,
    live: auctions.filter((a) => statusOf(a) === 'live').length,
    scheduled: auctions.filter((a) => statusOf(a) === 'scheduled').length,
    ended: auctions.filter((a) => statusOf(a) === 'ended').length,
    cancelled: auctions.filter((a) => a.status === 'cancelled').length,
    bids: bids.length,
    winners: winners.length,
    pendingPayment: winners.filter((w) => w.status === 'PENDING_PAYMENT').length,
    paid: winners.filter((w) => w.status === 'PAID' || w.status === 'COMPLETED').length,
    notPaid: winners.filter((w) => w.status === 'EXPIRED').length,
    penalties: penalties.length,
    suspicious: db.all('auctionReputation').filter((r) => r.antifraudStatus && r.antifraudStatus !== 'NORMAL').length,
  });
});

router.get('/sunday', (req, res) => {
  res.json(editionProgram({ user: req.user }));
});

router.get('/editions', (req, res) => {
  ensureEditions();
  res.json({ items: allEditions().map((e) => serializeEdition(e, { user: req.user, withLots: true, light: true })) });
});

router.post('/editions', (req, res) => {
  try {
    const ed = createEdition(req.body || {}, req.user);
    res.status(201).json(serializeEdition(ed, { user: req.user, withLots: true, light: true }));
  } catch (ex) {
    res.status(ex.status || 400).json({ error: ex.message });
  }
});

router.put('/editions/:id', (req, res) => {
  const ed = db.findById('auctionEditions', req.params.id);
  if (!ed) return res.status(404).json({ error: 'Edição não encontrada.' });
  const b = req.body || {};
  const patch = {};
  if (b.title != null) patch.title = String(b.title).trim().slice(0, 80);
  if (b.date && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) patch.date = String(b.date);
  if (b.notes != null) patch.notes = String(b.notes).slice(0, 400);
  if (b.number != null && Number.isFinite(Number(b.number))) patch.number = Number(b.number);
  const updated = db.update('auctionEditions', ed.id, patch);
  res.json(serializeEdition(updated, { user: req.user, withLots: true, light: true }));
});

router.post('/editions/:id/cancel', (req, res) => {
  const ed = db.findById('auctionEditions', req.params.id);
  if (!ed) return res.status(404).json({ error: 'Edição não encontrada.' });
  db.batch(() => {
    db.update('auctionEditions', ed.id, { status: 'cancelled' });
    db.findWhere('auctions', (a) => a.editionId === ed.id && a.status === 'scheduled').forEach((a) => {
      db.update('auctions', a.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledReason: 'Edição cancelada.', cancelledBy: req.user.id });
    });
  });
  res.json({ ok: true });
});

router.post('/sunday-lot', photoUpload.array('photos', 6), (req, res) => {
  const cfg = getAuctionConfig();
  ensureEditions();
  const b = req.body || {};
  const files = req.files || [];
  const title = String(b.title || '').trim();
  const description = String(b.description || title).trim();
  const categoryId = String(b.categoryId || '');
  const startingBid = Number(String(b.startingBid || '').replace(',', '.'));
  const minIncrement = Number(String(b.minIncrement || cfg.settings.minIncrement).replace(',', '.'));
  if (!title) return res.status(400).json({ error: 'Informe o produto.' });
  const cat = categoryId ? db.findById('categories', categoryId) : db.findOne('categories', () => true);
  if (!cat) return res.status(400).json({ error: 'Categoria inválida.' });
  if (!Number.isFinite(startingBid) || startingBid < 1) return res.status(400).json({ error: 'Informe o lance inicial.' });
  if (!Number.isFinite(minIncrement) || minIncrement < 1) return res.status(400).json({ error: 'O incremento deve ser de pelo menos R$ 1,00.' });
  let edition = b.editionId ? db.findById('auctionEditions', b.editionId) : null;
  if (!edition) edition = allEditions().filter((e) => e.status !== 'closed').slice(-1)[0] || allEditions()[allEditions().length - 1];
  if (!edition) return res.status(400).json({ error: 'Crie uma edição antes de incluir lote.' });
  const durationMinutes = Math.max(1, Number(b.durationMinutes) || Number(cfg.settings.sundayDefaultDurationMinutes) || 8);
  const order = Number(b.programOrder);
  const auction = db.batch(() => {
    const rec = db.insert('auctions', {
      userId: req.user.id,
      title: title.slice(0, 120),
      description: description.slice(0, 4000),
      categoryId: cat.id,
      city: String(b.city || 'Corinto').slice(0, 80),
      cityId: String(b.cityId || 'corinto'),
      startingBid: round2(startingBid),
      minIncrement: round2(Number.isFinite(minIncrement) ? minIncrement : 1),
      startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + durationMinutes * 60000).toISOString(),
      originalEndAt: new Date(Date.now() + durationMinutes * 60000).toISOString(),
      durationHours: durationMinutes / 60,
      durationMinutes,
      deliveryMethod: 'retirada',
      pickupInfo: String(b.pickupInfo || 'Retirada em Corinto, combinamos o horário.').slice(0, 400),
      extraInfo: '',
      sellerRules: '',
      status: 'scheduled',
      startedAt: null,
      currentBid: null,
      currentBidderId: null,
      bidCount: 0,
      extensionCount: 0,
      winnerId: null,
      winnerAmount: null,
      views: 0,
      sundayEvent: true,
      editionId: edition.id,
      featured: b.featured === true || b.featured === 'true',
      finalLot: b.finalLot === true || b.finalLot === 'true',
      programOrder: Number.isFinite(order) ? order : lotsOf(edition.id).length + 1,
      round: ['first', 'main', 'final'].includes(b.round) ? b.round : ((b.finalLot === true || b.finalLot === 'true') ? 'final' : 'main'),
      createdAt: new Date().toISOString(),
    });
    if (files.length) {
      files.slice(0, 6).forEach((f, i) => {
        db.insert('auctionImages', { auctionId: rec.id, url: '/uploads/' + f.filename, order: i });
      });
    } else {
      db.insert('auctionImages', {
        auctionId: rec.id,
        url: '/api/placeholder/' + rec.id + '/0?t=' + encodeURIComponent(title),
        order: 0,
      });
    }
    return rec;
  });
  applyLotSequence(edition.id);
  const sequenced = db.findById('auctions', auction.id);
  res.status(201).json({ auction: serializeAuction(sequenced, { user: req.user, light: true }), edition: serializeEdition(edition, { user: req.user, withLots: true, light: true }) });
});

router.post('/editions/:id/reorder', (req, res) => {
  const ed = db.findById('auctionEditions', req.params.id);
  if (!ed) return res.status(404).json({ error: 'Edição não encontrada.' });
  const ids = (req.body && req.body.ids) || [];
  reorderEditionLots(ed.id, ids);
  res.json(serializeEdition(ed, { user: req.user, withLots: true, light: true }));
});

router.post('/:id/program', (req, res) => {
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  const b = req.body || {};
  const patch = {};
  if (b.sundayEvent !== undefined) patch.sundayEvent = !!b.sundayEvent;
  if (b.featured !== undefined) patch.featured = !!b.featured;
  if (b.finalLot !== undefined) patch.finalLot = !!b.finalLot;
  if (b.round && ['first', 'main', 'final', ''].includes(b.round)) patch.round = b.round;
  if (b.programOrder !== undefined && Number.isFinite(Number(b.programOrder))) patch.programOrder = Number(b.programOrder);
  const startAt = b.startAt ? new Date(b.startAt) : (a.startAt ? new Date(a.startAt) : null);
  const durationMinutes = b.durationMinutes !== undefined
    ? Math.max(1, Number(b.durationMinutes) || 1)
    : (Number(a.durationMinutes) || Math.round(Number(a.durationHours || 0) * 60) || 8);
  if (b.startAt && Number.isNaN(startAt.getTime())) return res.status(400).json({ error: 'Horário inválido.' });
  if (startAt && (b.startAt || b.durationMinutes !== undefined) && (a.status === 'scheduled' || a.bidCount === 0)) {
    const endAt = new Date(startAt.getTime() + durationMinutes * 60000);
    patch.startAt = startAt.toISOString();
    patch.endAt = endAt.toISOString();
    patch.originalEndAt = endAt.toISOString();
    patch.durationMinutes = durationMinutes;
    patch.durationHours = durationMinutes / 60;
    patch.status = startAt.getTime() <= Date.now() ? 'live' : 'scheduled';
  } else if (b.durationMinutes !== undefined) {
    patch.durationMinutes = durationMinutes;
  }
  const updated = db.update('auctions', a.id, patch);
  if (a.editionId && (b.durationMinutes !== undefined || b.programOrder !== undefined)) {
    applyLotSequence(a.editionId);
  }
  res.json(serializeAuction(db.findById('auctions', a.id) || updated, { user: req.user, light: true }));
});

router.get('/list', (req, res) => {
  const items = db
    .all('auctions')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((a) => {
      const s = serializeAuction(a, { user: req.user, light: true });
      const seller = db.findById('users', a.userId);
      const winner = a.winnerId ? db.findById('users', a.winnerId) : null;
      return {
        ...s,
        status: a.status,
        derived: statusOf(a),
        sellerName: seller ? seller.name : '',
        winnerName: winner ? winner.name : '',
      };
    });
  res.json({ items });
});

router.post('/:id/cancel', (req, res) => {
  const a = db.findById('auctions', req.params.id);
  if (!a) return res.status(404).json({ error: 'Leilão não encontrado.' });
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'Informe o motivo.' });
  db.update('auctions', a.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledReason: reason, cancelledBy: req.user.id });
  notify(a.userId, 'ended', 'Leilão cancelado', 'Seu leilão "' + a.title + '" foi cancelado. Motivo: ' + reason, a.id, { section: 'meus-leiloes' });
  res.json({ ok: true });
});

router.get('/payments', (req, res) => {
  const items = db
    .all('auctionPayments')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 300)
    .map((p) => {
      const winner = db.findById('users', p.winnerId);
      const seller = p.sellerId ? db.findById('users', p.sellerId) : null;
      const auction = p.auctionId ? db.findById('auctions', p.auctionId) : null;
      return {
        id: p.id,
        kind: p.kind,
        amount: round2(p.amount),
        status: p.status,
        dueAt: p.dueAt,
        declaredAt: p.declaredAt || null,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        winnerName: winner ? winner.name : '',
        winnerId: p.winnerId,
        sellerName: seller ? seller.name : '',
        auctionTitle: auction ? auction.title : '',
        auctionId: p.auctionId,
      };
    });
  res.json({ items });
});

router.post('/payments/:id/confirm', (req, res) => {
  const pay = db.findById('auctionPayments', req.params.id);
  if (!pay) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  const now = new Date().toISOString();
  if (pay.kind === 'early_unlock') {
    const rep = ensureReputation(pay.winnerId);
    rep.currentPenalty = 0;
    rep.currentPenaltyUntil = null;
    rep.permanentPenalty = false;
    rep.earlyUnlockUses = (rep.earlyUnlockUses || 0) + 1;
    db.update('auctionReputation', rep.id || rep.userId, {
      currentPenalty: 0,
      currentPenaltyUntil: null,
      permanentPenalty: false,
      earlyUnlockUses: rep.earlyUnlockUses,
      updatedAt: now,
    });
    db.update('auctionPayments', pay.id, { status: 'PAID', paidAt: now, confirmedAt: now });
    notify(pay.winnerId, 'lost', 'Participação reativada', 'Sua participação em leilões foi reativada.', '', { section: 'reputacao' });
    return res.json({ ok: true });
  }
  const winner = db.findOne('auctionWinners', (w) => w.auctionId === pay.auctionId && w.userId === pay.winnerId);
  if (!winner) return res.status(404).json({ error: 'Arremate não encontrado.' });
  if (winner.status === 'COMPLETED' || winner.status === 'PAID') return res.json({ ok: true });
  const onTime = winner.paymentDeadline && new Date(now).getTime() <= new Date(winner.paymentDeadline).getTime();
  db.update('auctionPayments', pay.id, { status: 'PAID', paidAt: now, confirmedAt: now });
  db.update('auctionWinners', winner.id, { status: 'COMPLETED', paidAt: now, completedAt: now, onTime: !!onTime });
  const rep = ensureReputation(winner.userId);
  rep.totalPaid = (rep.totalPaid || 0) + 1;
  updateCompletion(rep);
  db.update('auctionReputation', rep.id || rep.userId, { totalPaid: rep.totalPaid, completionRate: rep.completionRate, updatedAt: now });
  const cfg = getAuctionConfig();
  addPoints(winner.userId, Number(cfg.settings.pointsPaid) || 10, 'paid', winner.auctionId, { force: true });
  db.insert('auctionPoints', { userId: winner.userId, delta: 0, reason: 'paid_confirmed', auctionId: winner.auctionId, createdAt: now });
  if (onTime && (Number(cfg.settings.pointsOnTimeBonus) || 0) > 0) {
    addPoints(winner.userId, Number(cfg.settings.pointsOnTimeBonus), 'on_time', winner.auctionId);
  }
  const auction = db.findById('auctions', winner.auctionId);
  notify(winner.userId, 'won', 'Arremate concluído', 'Pagamento confirmado. Seu arremate de "' + (auction ? auction.title : '') + '" está concluído.', winner.auctionId, { section: 'arremates' });
  if (auction) notify(auction.userId, 'ended', 'Arremate pago', 'O pagamento do arremate de "' + auction.title + '" foi confirmado.', auction.id, { section: 'meus-leiloes' });
  res.json({ ok: true, onTime: !!onTime });
});

router.post('/winners/:id/cancel', (req, res) => {
  const winner = db.findById('auctionWinners', req.params.id);
  if (!winner) return res.status(404).json({ error: 'Arremate não encontrado.' });
  const reason = String((req.body && req.body.reason) || '').trim() || 'Cancelado pelo administrador';
  const penalty = req.body && req.body.penalty === true;
  db.update('auctionWinners', winner.id, { status: 'CANCELLED', cancelledAt: new Date().toISOString(), cancelledReason: reason });
  const pay = db.findOne('auctionPayments', (p) => p.auctionId === winner.auctionId && p.winnerId === winner.userId && p.kind === 'auction_winner');
  if (pay) db.update('auctionPayments', pay.id, { status: 'CANCELLED' });
  if (penalty) applyPenalty(winner.userId, winner.auctionId, reason);
  notify(winner.userId, 'lost', 'Arremate cancelado', 'Seu arremate foi cancelado. Motivo: ' + reason, winner.auctionId, { section: 'arremates' });
  res.json({ ok: true });
});

router.get('/penalties', (req, res) => {
  const items = db
    .all('auctionPenalties')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 300)
    .map((p) => {
      const user = db.findById('users', p.userId);
      return { ...p, userName: user ? user.name : '', userEmail: user ? user.email : '' };
    });
  res.json({ items });
});

router.post('/penalties/:id/lift', masterRequired, (req, res) => {
  const pen = db.findById('auctionPenalties', req.params.id);
  if (!pen) return res.status(404).json({ error: 'Penalidade não encontrada.' });
  const rep = ensureReputation(pen.userId);
  db.update('auctionReputation', rep.id || rep.userId, {
    currentPenalty: 0,
    currentPenaltyUntil: null,
    permanentPenalty: false,
    updatedAt: new Date().toISOString(),
  });
  db.insert('auctionPoints', { userId: pen.userId, delta: 0, reason: 'penalty_lifted', auctionId: pen.auctionId || '', createdAt: new Date().toISOString() });
  res.json({ ok: true });
});

router.get('/reputations', (req, res) => {
  const items = db
    .all('auctionReputation')
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .map((r) => {
      const user = db.findById('users', r.userId);
      return {
        userId: r.userId,
        name: user ? user.name : '',
        email: user ? user.email : '',
        ...reputationProfile(r.userId),
      };
    });
  res.json({ items });
});

router.post('/reputations/:userId/antifraud', (req, res) => {
  const user = db.findById('users', req.params.userId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const status = String((req.body && req.body.status) || '').toUpperCase();
  if (!['NORMAL', 'REVIEW', 'SUSPICIOUS', 'BLOCKED'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }
  const rep = ensureReputation(user.id);
  db.update('auctionReputation', rep.id || rep.userId, { antifraudStatus: status, updatedAt: new Date().toISOString() });
  res.json({ ok: true, status });
});

module.exports = router;
