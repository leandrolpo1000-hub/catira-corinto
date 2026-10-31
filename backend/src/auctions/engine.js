const db = require('../db');
const { safeUser, isAdminRole } = require('../middleware');
const { getAuctionConfig, flagOn, logChange } = require('./config');

const AUCTION_STATUSES = ['scheduled', 'live', 'ended', 'cancelled'];
const WINNER_STATUSES = ['PENDING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED', 'COMPLETED'];
const ANTIFRAUD_STATUSES = ['NORMAL', 'REVIEW', 'SUSPICIOUS', 'BLOCKED'];

function nowIso() {
  return new Date().toISOString();
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

function imagesOf(auctionId) {
  return db
    .findWhere('auctionImages', (i) => i.auctionId === auctionId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function participantCount(auctionId) {
  const ids = new Set(db.findWhere('auctionBids', (b) => b.auctionId === auctionId).map((b) => b.userId));
  return ids.size;
}

function watcherCount(auctionId) {
  return db.count('auctionWatchers', (w) => w.auctionId === auctionId);
}

function isWatching(auctionId, userId) {
  if (!userId) return false;
  return !!db.findOne('auctionWatchers', (w) => w.auctionId === auctionId && w.userId === userId);
}

function publicName(user, mode) {
  if (!user) return 'Participante';
  const m = mode || getAuctionConfig().settings.displayNames;
  const name = String(user.name || 'Participante').trim();
  if (m === 'full') return name;
  if (m === 'id') return 'Participante ' + String(user.id).slice(0, 4).toUpperCase();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || 'Participante';
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
}

function nextBidFor(a) {
  const inc = Math.max(0, num(a.minIncrement, getAuctionConfig().settings.minIncrement));
  if (!a.bidCount || a.currentBid == null) return round2(num(a.startingBid, 0));
  return round2(num(a.currentBid, 0) + inc);
}

function derivedEnded(a) {
  return !!a.endAt && Date.now() >= new Date(a.endAt).getTime();
}

function canParticipate(user) {
  if (!user) return { ok: false, reason: 'Faça login para participar.' };
  if (user.status === 'blocked') return { ok: false, reason: 'Sua conta está bloqueada.' };
  if (isAdminRole(user.role)) return { ok: true };
  const cfg = getAuctionConfig();
  if (!cfg.flags.auction_penalties_enabled) return { ok: true };
  const rep = reputationOf(user.id);
  if (rep.permanentPenalty) {
    return { ok: false, reason: 'Participação em leilões suspensa permanentemente.', penalized: true, permanent: true };
  }
  if (rep.currentPenaltyUntil && new Date(rep.currentPenaltyUntil).getTime() > Date.now()) {
    return { ok: false, reason: 'Você está temporariamente impedido de participar de leilões.', penalized: true, until: rep.currentPenaltyUntil };
  }
  return { ok: true };
}

function reputationOf(userId) {
  const row = db.findOne('auctionReputation', (r) => r.userId === userId);
  return row || {
    userId,
    totalWon: 0,
    totalPaid: 0,
    totalNotPaid: 0,
    totalPenalties: 0,
    points: 0,
    currentPenalty: 0,
    currentPenaltyUntil: null,
    permanentPenalty: false,
    completionRate: 0,
    antifraudStatus: 'NORMAL',
    bidCount: 0,
    bidTimestamps: [],
    cancelledCount: 0,
    earlyUnlockUses: 0,
    updatedAt: null,
  };
}

function ensureReputation(userId) {
  const existing = db.findOne('auctionReputation', (r) => r.userId === userId);
  if (existing) return existing;
  return db.insert('auctionReputation', {
    id: userId,
    userId,
    totalWon: 0,
    totalPaid: 0,
    totalNotPaid: 0,
    totalPenalties: 0,
    points: 0,
    currentPenalty: 0,
    currentPenaltyUntil: null,
    permanentPenalty: false,
    completionRate: 0,
    antifraudStatus: 'NORMAL',
    bidCount: 0,
    bidTimestamps: [],
    cancelledCount: 0,
    earlyUnlockUses: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

function updateCompletion(rep) {
  const done = rep.totalPaid + rep.totalNotPaid;
  rep.completionRate = done ? Math.round((rep.totalPaid / done) * 100) : 0;
  return rep;
}

function addPoints(userId, delta, reason, auctionId) {
  const cfg = getAuctionConfig();
  if (!cfg.flags.auction_reputation_enabled && !cfg.flags.auction_points_enabled) {
    // Mesmo com as flags desligadas, guardamos o histórico de confiança.
  }
  db.insert('auctionPoints', {
    userId,
    delta: delta,
    balanceAfter: 0,
    reason,
    auctionId: auctionId || '',
    createdAt: nowIso(),
  });
  const rep = ensureReputation(userId);
  rep.points = num(rep.points, 0) + delta;
  updateCompletion(rep);
  db.update('auctionReputation', rep.id || rep.userId, { points: rep.points, completionRate: rep.completionRate, updatedAt: nowIso() });
}

function notify(userId, type, title, text, auctionId, meta) {
  if (!userId) return;
  const cfg = getAuctionConfig();
  const notifyKey = {
    starting: 'notify_starting',
    lot_starting: 'notify_lot_starting',
    outbid: 'notify_outbid',
    five_min: 'notify_five_min',
    one_min: 'notify_one_min',
    thirty_sec: 'notify_thirty_sec',
    ended: 'notify_ended',
    won: 'notify_won',
    lost: 'notify_lost',
  }[type];
  if (!cfg.flags.auction_notifications_enabled) return;
  if (notifyKey && !cfg.flags[notifyKey]) return;
  db.insert('auctionNotifications', {
    userId,
    type,
    title: title || '',
    text: text || '',
    auctionId: auctionId || '',
    meta: meta || {},
    read: false,
    createdAt: nowIso(),
  });
}

function antifraudRecord(userId, auctionId, event) {
  if (!flagOn('auction_antifraud_enabled')) return;
  if (!userId) return;
  const rep = ensureReputation(userId);
  if (event === 'bid') {
    const stamps = Array.isArray(rep.bidTimestamps) ? rep.bidTimestamps.slice(-9) : [];
    stamps.push(Date.now());
    const withinMinute = stamps.filter((t) => Date.now() - t < 60000).length;
    let status = rep.antifraudStatus || 'NORMAL';
    let note = rep.antifraudNote || '';
    if (status !== 'BLOCKED') {
      if (withinMinute >= 15 || num(rep.cancelledCount, 0) >= 3) {
        status = 'SUSPICIOUS';
        note = 'Muitos lances em pouco tempo ou cancelamentos repetidos.';
      } else if (withinMinute >= 8) {
        status = 'REVIEW';
        note = 'Frequência de lances acima do normal.';
      }
    }
    db.update('auctionReputation', rep.id || rep.userId, {
      bidCount: num(rep.bidCount, 0) + 1,
      bidTimestamps: stamps,
      antifraudStatus: status,
      antifraudNote: note,
      updatedAt: nowIso(),
    });
  }
}

function recomputeAntifraud() {
  if (!flagOn('auction_antifraud_enabled')) return;
  db.all('auctionReputation').forEach((rep) => {
    const recent = (rep.bidTimestamps || []).filter((t) => Date.now() - t < 3600000);
    if (rep.antifraudStatus === 'BLOCKED') return;
    let status = 'NORMAL';
    let note = '';
    if (num(rep.cancelledCount, 0) >= 5) {
      status = 'SUSPICIOUS';
      note = 'Cancelamentos repetidos.';
    } else if (recent.length >= 40) {
      status = 'SUSPICIOUS';
      note = 'Alta frequência de lances na última hora.';
    } else if (recent.length >= 20) {
      status = 'REVIEW';
      note = 'Frequência de lances elevada.';
    }
    if (status !== rep.antifraudStatus || note !== (rep.antifraudNote || '')) {
      db.update('auctionReputation', rep.id || rep.userId, { antifraudStatus: status, antifraudNote: note, updatedAt: nowIso() });
    }
  });
}

function createWinner(a) {
  const deadlineHours = Math.max(1, num(getAuctionConfig().settings.paymentDeadlineHours, 48));
  const dueAt = new Date(Date.now() + deadlineHours * 3600000).toISOString();
  const winner = db.insert('auctionWinners', {
    auctionId: a.id,
    userId: a.currentBidderId,
    amount: round2(a.currentBid),
    status: 'PENDING_PAYMENT',
    wonAt: nowIso(),
    paymentDeadline: dueAt,
    paidAt: null,
    completedAt: null,
    cancelledReason: '',
    cancelledAt: null,
  });
  db.insert('auctionPayments', {
    auctionId: a.id,
    winnerId: a.currentBidderId,
    sellerId: a.userId,
    amount: round2(a.currentBid),
    kind: 'auction_winner',
    method: 'pix',
    status: 'PENDING_PAYMENT',
    dueAt,
    createdAt: nowIso(),
    paidAt: null,
    confirmedAt: null,
    declaredAt: null,
  });
  return winner;
}

function settleAuction(a, opts = {}) {
  if (a.status === 'ended' || a.status === 'cancelled') return a;
  const endedAt = a.endAt || nowIso();
  const hasBid = num(a.bidCount, 0) > 0 && !!a.currentBidderId;
  const patch = {
    status: 'ended',
    endedAt,
    winnerId: hasBid ? a.currentBidderId : null,
    winnerAmount: hasBid ? round2(a.currentBid) : null,
    settledAt: nowIso(),
  };
  const updated = db.update('auctions', a.id, patch);
  if (!hasBid) {
    notify(a.userId, 'ended', 'Leilão encerrado sem lances', 'Seu leilão "' + a.title + '" terminou sem lances.', a.id, { section: 'meus-leiloes' });
    return updated;
  }
  const winner = createWinner(updated);
  const rep = ensureReputation(winner.userId);
  rep.totalWon = num(rep.totalWon, 0) + 1;
  updateCompletion(rep);
  db.update('auctionReputation', rep.id || rep.userId, { totalWon: rep.totalWon, completionRate: rep.completionRate, updatedAt: nowIso() });

  notify(winner.userId, 'won', 'Você arrematou!', 'Você venceu "' + a.title + '" por R$ ' + round2(a.currentBid).toFixed(2) + '.', a.id, { section: 'arremates' });
  notify(a.userId, 'ended', 'Leilão encerrado', 'Seu leilão "' + a.title + '" foi arrematado.', a.id, { section: 'meus-leiloes' });

  const bidders = new Set(db.findWhere('auctionBids', (b) => b.auctionId === a.id).map((b) => b.userId));
  bidders.forEach((uid) => {
    if (uid === winner.userId) return;
    notify(uid, 'lost', 'Leilão encerrado', 'O arremate de "' + a.title + '" terminou em R$ ' + round2(a.currentBid).toFixed(2) + '.', a.id, { section: 'leiloes' });
  });
  return updated;
}

function applyPenalty(userId, auctionId, reason) {
  const cfg = getAuctionConfig();
  const rep = ensureReputation(userId);
  const occurrence = num(rep.totalPenalties, 0) + 1;
  const periodDays = occurrence <= 1
    ? cfg.settings.penalty1Days
    : occurrence === 2
      ? cfg.settings.penalty2Days
      : occurrence === 3
        ? cfg.settings.penalty3Days
        : cfg.settings.penalty4Days;
  const beyondTable = occurrence > 4;
  const permanent = beyondTable && cfg.settings.permanentPenaltyEnabled;
  const applied = cfg.flags.auction_penalties_enabled;
  const until = permanent
    ? 'permanent'
    : (applied ? new Date(Date.now() + Math.max(0, num(periodDays, 30)) * 86400000).toISOString() : null);
  db.insert('auctionPenalties', {
    userId,
    auctionId: auctionId || '',
    occurrence,
    periodDays: num(periodDays, 30),
    permanent: !!permanent,
    applied,
    reason: reason || 'Arremate não pago',
    until,
    createdAt: nowIso(),
  });
  rep.totalPenalties = occurrence;
  if (applied) {
    rep.currentPenalty = occurrence;
    rep.currentPenaltyUntil = permanent ? null : until;
    rep.permanentPenalty = !!permanent;
  }
  updateCompletion(rep);
  db.update('auctionReputation', rep.id || rep.userId, {
    totalPenalties: rep.totalPenalties,
    currentPenalty: rep.currentPenalty,
    currentPenaltyUntil: rep.currentPenaltyUntil,
    permanentPenalty: rep.permanentPenalty,
    completionRate: rep.completionRate,
    updatedAt: nowIso(),
  });
  addPoints(userId, num(cfg.settings.pointsNotPaid, -30), 'not_paid', auctionId);
  db.insert('auctionPoints', { userId, delta: 0, reason: 'penalty_applied', auctionId: auctionId || '', createdAt: nowIso() });
  notify(
    userId,
    'lost',
    applied ? 'Penalidade aplicada' : 'Registro de não pagamento',
    applied
      ? (permanent ? 'Você perdeu permanentemente a participação em leilões.' : 'Você ficará ' + num(periodDays, 30) + ' dias sem participar de leilões.')
      : 'Registramos o não pagamento para acompanhamento. O sistema de penalidades está desativado.',
    auctionId,
    { section: 'reputacao' }
  );
}

function processPaymentDeadlines() {
  const winners = db.findWhere('auctionWinners', (w) => w.status === 'PENDING_PAYMENT');
  winners.forEach((w) => {
    if (!w.paymentDeadline || Date.now() < new Date(w.paymentDeadline).getTime()) return;
    db.update('auctionWinners', w.id, { status: 'EXPIRED', cancelledAt: nowIso(), cancelledReason: 'Prazo de pagamento vencido' });
    const pay = db.findOne('auctionPayments', (p) => p.auctionId === w.auctionId && p.winnerId === w.userId && p.status === 'PENDING_PAYMENT');
    if (pay) db.update('auctionPayments', pay.id, { status: 'EXPIRED' });
    const rep = ensureReputation(w.userId);
    rep.totalNotPaid = num(rep.totalNotPaid, 0) + 1;
    updateCompletion(rep);
    db.update('auctionReputation', rep.id || rep.userId, { totalNotPaid: rep.totalNotPaid, completionRate: rep.completionRate, updatedAt: nowIso() });
    applyPenalty(w.userId, w.auctionId, 'Arremate não pago no prazo');
  });
}

function timersTick() {
  db.batch(() => {
  db.all('auctions').forEach((a) => {
    if (a.status === 'ended' || a.status === 'cancelled') return;
    const start = a.startAt ? new Date(a.startAt).getTime() : 0;
    const end = a.endAt ? new Date(a.endAt).getTime() : 0;
    const t = Date.now();
    if (a.status === 'scheduled' && t >= start && t < end) {
      db.update('auctions', a.id, { status: 'live', startedAt: nowIso() });
      notify(a.userId, 'starting', 'Leilão começou', 'Seu leilão "' + a.title + '" está no ar.', a.id, { section: 'meus-leiloes' });
      db.findWhere('auctionWatchers', (w) => w.auctionId === a.id).forEach((w) => {
        notify(w.userId, 'starting', 'Leilão começando', 'O leilão "' + a.title + '" começou.', a.id, { section: 'olho' });
        if (a.sundayEvent) {
          notify(w.userId, 'lot_starting', 'O lote começou', 'A disputa de "' + a.title + '" está no ar.', a.id, { section: 'olho' });
        }
      });
      return;
    }
    if (t >= end) {
      settleAuction(a);
    }
  });
  processPaymentDeadlines();
  });
}

function milestonesTick() {
  // Avisos de tempo (5 min, 1 min, 30 s) para quem está de olho ou já deu lance.
  db.all('auctions').forEach((a) => {
    if (a.status !== 'live' || !a.endAt) return;
    const left = new Date(a.endAt).getTime() - Date.now();
    if (left <= 0) return;
    const marks = [
      { key: 'five_min', ms: 5 * 60000, type: 'five_min', text: 'Faltam 5 minutos para o fim de "' + a.title + '".' },
      { key: 'one_min', ms: 60000, type: 'one_min', text: 'Falta 1 minuto para o fim de "' + a.title + '".' },
      { key: 'thirty_sec', ms: 30000, type: 'thirty_sec', text: 'Faltam 30 segundos para o fim de "' + a.title + '".' },
    ];
    marks.forEach((m) => {
      const flagKey = 'notify_' + m.key;
      if (!flagOn(flagKey)) return;
      if (left > m.ms) return;
      const marker = 'm_' + m.key + '_' + a.id;
      if (db.findOne('auctionNotifications', (n) => n.marker === marker)) return;
      const audience = new Set();
      db.findWhere('auctionWatchers', (w) => w.auctionId === a.id).forEach((w) => audience.add(w.userId));
      db.findWhere('auctionBids', (b) => b.auctionId === a.id).forEach((b) => audience.add(b.userId));
      audience.forEach((uid) => {
        const n = notify(uid, m.type, 'Leilão terminando', m.text, a.id, { section: 'olho' });
      });
      db.insert('auctionNotifications', { userId: '', type: m.type, auctionId: a.id, marker, read: true, createdAt: nowIso() });
    });
  });
}

const viewBump = {};

function bumpViews(auctionId) {
  if (!auctionId) return;
  viewBump[auctionId] = (viewBump[auctionId] || 0) + 1;
}

function flushViews() {
  const ids = Object.keys(viewBump);
  if (!ids.length) return;
  db.batch(() => {
    ids.forEach((id) => {
      const a = db.findById('auctions', id);
      const n = viewBump[id] || 0;
      delete viewBump[id];
      if (a && n) db.update('auctions', a.id, { views: (a.views || 0) + n });
    });
  });
}

function runAuctionTicks() {
  try { flushViews(); } catch (e) { /* mantém o serviço de pé */ }
  try { timersTick(); } catch (e) { /* mantém o serviço de pé */ }
  try { milestonesTick(); } catch (e) { /* idem */ }
}

function computeLevel(rep) {
  const cfg = getAuctionConfig();
  const levels = cfg.settings.reputationLevels || [];
  let current = levels[0] || { id: 'novato', name: 'Novato' };
  levels.forEach((l) => {
    if (num(rep.totalPaid, 0) >= num(l.minPaid, 0) && num(rep.completionRate, 0) >= num(l.minRate, 0)) {
      current = l;
    }
  });
  return current;
}

function achievementsFor(rep) {
  const cfg = getAuctionConfig();
  const defs = Array.isArray(cfg.settings.achievements) ? cfg.settings.achievements : [];
  return defs
    .map((d) => {
      const value = d.type === 'rate' ? num(rep.completionRate, 0) : num(rep.totalPaid, 0);
      const ok = value >= num(d.threshold, 0) && (!d.extra || num(rep.totalPaid, 0) >= num(d.extra, 0));
      return { id: d.id, name: d.name, icon: d.icon, unlocked: ok, progress: Math.min(100, Math.round((value / Math.max(1, num(d.threshold, 1))) * 100)) };
    });
}

function badgesFor(rep) {
  const cfg = getAuctionConfig();
  const defs = Array.isArray(cfg.settings.badges) ? cfg.settings.badges : [];
  return defs.filter((b) => num(rep.totalPaid, 0) >= num(b.minPaid, 0) && num(rep.completionRate, 0) >= num(b.minRate, 0));
}

function reputationProfile(userId) {
  const rep = reputationOf(userId);
  const cfg = getAuctionConfig();
  const level = computeLevel(rep);
  return {
    userId,
    totalWon: num(rep.totalWon, 0),
    totalPaid: num(rep.totalPaid, 0),
    totalNotPaid: num(rep.totalNotPaid, 0),
    totalPenalties: num(rep.totalPenalties, 0),
    completionRate: num(rep.completionRate, 0),
    points: num(rep.points, 0),
    currentPenalty: num(rep.currentPenalty, 0),
    currentPenaltyUntil: rep.currentPenaltyUntil || null,
    permanentPenalty: !!rep.permanentPenalty,
    earlyUnlockUses: num(rep.earlyUnlockUses, 0),
    antifraudStatus: rep.antifraudStatus || 'NORMAL',
    level: cfg.flags.auction_levels_enabled ? { id: level.id, name: level.name } : null,
    badges: cfg.flags.auction_badges_enabled ? badgesFor(rep) : [],
    achievements: cfg.flags.auction_achievements_enabled ? achievementsFor(rep) : [],
    history: db
      .findWhere('auctionPoints', (p) => p.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50)
      .map((p) => ({ delta: p.delta, reason: p.reason, auctionId: p.auctionId, at: p.createdAt })),
  };
}

function ranking(metric, limit) {
  const cfg = getAuctionConfig();
  const key = metric || cfg.settings.rankingMetric || 'points';
  const rows = db.all('auctionReputation').map((rep) => {
    const user = db.findById('users', rep.userId);
    const level = computeLevel(rep);
    return {
      userId: rep.userId,
      name: publicName(user, 'abbrev'),
      points: num(rep.points, 0),
      totalPaid: num(rep.totalPaid, 0),
      completionRate: num(rep.completionRate, 0),
      level: cfg.flags.auction_levels_enabled ? { id: level.id, name: level.name } : null,
      achievements: cfg.flags.auction_achievements_enabled ? achievementsFor(rep).filter((a) => a.unlocked).length : 0,
    };
  });
  const sorters = {
    points: (a, b) => b.points - a.points,
    paid: (a, b) => b.totalPaid - a.totalPaid,
    rate: (a, b) => b.completionRate - a.completionRate || b.totalPaid - a.totalPaid,
    achievements: (a, b) => b.achievements - a.achievements || b.points - a.points,
  };
  rows.sort(sorters[key] || sorters.points);
  return { metric: key, items: rows.slice(0, Math.max(1, Math.min(100, limit || 50))) };
}

function statusOf(a) {
  if (a.status === 'ended' || a.status === 'cancelled') return a.status;
  const t = Date.now();
  const start = a.startAt ? new Date(a.startAt).getTime() : 0;
  const end = a.endAt ? new Date(a.endAt).getTime() : 0;
  if (t >= end) return 'ended';
  if (t >= start) return 'live';
  return 'scheduled';
}

function lotStatusOf(a) {
  if (a.status === 'cancelled' || statusOf(a) === 'cancelled') return 'cancelled';
  const st = statusOf(a);
  if (st === 'ended') return a.winnerId ? 'sold' : 'ended';
  const t = Date.now();
  const start = a.startAt ? new Date(a.startAt).getTime() : 0;
  const end = a.endAt ? new Date(a.endAt).getTime() : 0;
  const cfg = getAuctionConfig();
  if (st === 'live') {
    const trigger = Math.max(10, num(cfg.settings.extensionTriggerSeconds, 30)) * 1000;
    if (end - t <= trigger) return 'last_seconds';
    return 'live';
  }
  const soonMs = Math.max(1, num(cfg.settings.soonMinutes, 10)) * 60000;
  if (start - t <= soonMs) return 'soon';
  return 'scheduled';
}

function serializeBid(b, mode, viewerId) {
  const user = db.findById('users', b.userId);
  return {
    id: b.id,
    userId: b.userId,
    amount: round2(b.amount),
    at: b.createdAt,
    mine: viewerId === b.userId,
    bidder: publicName(user, mode),
    anonymousId: String(b.userId).slice(0, 4).toUpperCase(),
  };
}

function serializeAuction(a, opts = {}) {
  const cfg = opts.cfg || getAuctionConfig();
  const light = !!opts.light;
  const viewer = opts.user || null;
  const seller = db.findById('users', a.userId);
  const cat = db.findById('categories', a.categoryId);
  const images = light
    ? imagesOf(a.id).slice(0, 1)
    : imagesOf(a.id);
  const status = statusOf(a);
  const bidCount = num(a.bidCount, 0);
  const startingBid = round2(a.startingBid);
  const currentBid = bidCount ? round2(a.currentBid) : startingBid;
  const nextBid = nextBidFor(a);
  const winner = a.winnerId ? db.findById('users', a.winnerId) : null;
  const isSeller = viewer && viewer.id === a.userId;
  const isWinner = viewer && a.winnerId && viewer.id === a.winnerId;
  const isAdmin = viewer && isAdminRole(viewer.role);
  const isLeader = viewer && a.currentBidderId === viewer.id;
  const out = {
    id: a.id,
    userId: a.userId,
    title: a.title,
    description: a.description,
    categoryId: a.categoryId,
    category: cat ? { id: cat.id, name: cat.name, slug: cat.slug, icon: cat.icon } : null,
    subcategory: light ? '' : (a.subcategory || ''),
    city: a.city,
    cityId: a.cityId,
    startingBid,
    minIncrement: num(a.minIncrement, cfg.settings.minIncrement),
    currentBid,
    nextBid,
    bidCount,
    participantCount: light ? 0 : participantCount(a.id),
    watcherCount: light ? 0 : watcherCount(a.id),
    startAt: a.startAt,
    endAt: a.endAt,
    originalEndAt: a.originalEndAt || a.endAt,
    extensionCount: num(a.extensionCount, 0),
    durationHours: a.durationHours,
    deliveryMethod: light ? '' : (a.deliveryMethod || ''),
    pickupInfo: light ? '' : (a.pickupInfo || ''),
    extraInfo: light ? '' : (a.extraInfo || ''),
    sellerRules: light ? '' : (a.sellerRules || ''),
    status,
    lotStatus: lotStatusOf(a),
    sundayEvent: !!a.sundayEvent,
    editionId: a.editionId || '',
    featured: !!a.featured,
    finalLot: !!a.finalLot,
    programOrder: num(a.programOrder, 0),
    round: a.round || '',
    durationMinutes: num(a.durationMinutes, Math.round(num(a.durationHours, 0) * 60)),
    serverNow: Date.now(),
    winnerId: a.winnerId || null,
    winnerName: winner ? publicName(winner, cfg.settings.displayNames) : null,
    winnerAmount: a.winnerAmount != null ? round2(a.winnerAmount) : null,
    createdAt: a.createdAt,
    startedAt: a.startedAt || null,
    endedAt: a.endedAt || null,
    adminNote: (!light && (isSeller || isAdmin)) ? (a.adminNote || '') : '',
    images,
    seller: light ? null : safeUser(seller),
    watching: viewer ? isWatching(a.id, viewer.id) : false,
    canParticipate: light ? { ok: true } : canParticipate(viewer),
    myBest: 0,
    isLeader: !!isLeader,
    isWinner: !!isWinner,
    isSeller: !!isSeller,
    participated: false,
    win: null,
    history: [],
    paymentConfigured: false,
  };
  if (light) return out;
  const participant = viewer ? db.findOne('auctionBids', (b) => b.auctionId === a.id && b.userId === viewer.id) : null;
  const myBest = viewer
    ? round2(num((db.findWhere('auctionBids', (b) => b.auctionId === a.id && b.userId === viewer.id).reduce((m, b) => Math.max(m, num(b.amount, 0)), 0)), 0))
    : 0;
  const winnerRow = db.findOne('auctionWinners', (w) => w.auctionId === a.id);
  const win = winnerRow ? {
    id: winnerRow.id,
    status: winnerRow.status,
    amount: round2(winnerRow.amount),
    paymentDeadline: winnerRow.paymentDeadline,
    paidAt: winnerRow.paidAt,
    cancelledReason: winnerRow.cancelledReason || '',
  } : null;
  const history = db
    .findWhere('auctionBids', (b) => b.auctionId === a.id)
    .sort((x, y) => num(y.amount, 0) - num(x.amount, 0) || new Date(x.createdAt) - new Date(y.createdAt))
    .slice(0, 20)
    .map((b) => serializeBid(b, cfg.settings.displayNames, viewer && viewer.id));
  out.participantCount = participantCount(a.id);
  out.watcherCount = watcherCount(a.id);
  out.watching = viewer ? isWatching(a.id, viewer.id) : false;
  out.canParticipate = canParticipate(viewer);
  out.myBest = myBest;
  out.participated = !!participant;
  out.win = (isWinner || isSeller || isAdmin) ? win : null;
  out.history = history;
  out.paymentConfigured = !!require('../pix').getSettings().configured;
  return out;
}

function placeBid(auctionId, user, rawAmount) {
  const cfg = getAuctionConfig();
  if (!cfg.flags.auction_enabled) {
    const e = new Error('Leilões estão desativados no momento.');
    e.status = 403;
    throw e;
  }
  const a = db.findById('auctions', auctionId);
  if (!a) {
    const e = new Error('Leilão não encontrado.');
    e.status = 404;
    throw e;
  }
  if (a.status === 'cancelled') {
    const e = new Error('Este leilão foi cancelado.');
    e.status = 400;
    throw e;
  }
  const status = statusOf(a);
  if (status === 'scheduled') {
    const e = new Error('Este leilão ainda não começou.');
    e.status = 400;
    throw e;
  }
  if (status === 'ended') {
    const e = new Error('Este leilão já foi encerrado.');
    e.status = 400;
    throw e;
  }
  if (a.userId === user.id) {
    const e = new Error('Você não pode dar lance no próprio leilão.');
    e.status = 400;
    throw e;
  }
  const allowed = canParticipate(user);
  if (!allowed.ok) {
    const e = new Error(allowed.reason);
    e.status = 403;
    e.penalized = allowed.penalized;
    throw e;
  }
  // Seção crítica: sem await entre validação e gravação.
  const expected = nextBidFor(a);
  const amount = round2(num(rawAmount, NaN));
  if (!Number.isFinite(amount) || amount <= 0) {
    const e = new Error('Informe um valor de lance válido.');
    e.status = 400;
    throw e;
  }
  if (amount < expected) {
    const e = new Error('O lance mínimo agora é R$ ' + expected.toFixed(2) + '.');
    e.status = 400;
    throw e;
  }
  const previousBidder = a.currentBidderId;
  let endAt = a.endAt;
  let extensionCount = num(a.extensionCount, 0);
  const leftMs = new Date(a.endAt).getTime() - Date.now();
  const extendOn = !!(cfg.flags.auction_auto_extension_enabled || (cfg.flags.auction_lot_extension_enabled && a.sundayEvent));
  if (
    extendOn &&
    leftMs <= num(cfg.settings.extensionTriggerSeconds, 30) * 1000 &&
    (num(cfg.settings.maxExtensions, 0) === 0 || extensionCount < num(cfg.settings.maxExtensions, 0))
  ) {
    endAt = new Date(new Date(a.endAt).getTime() + num(cfg.settings.extensionSeconds, 30) * 1000).toISOString();
    extensionCount += 1;
  }
  const updated = db.update('auctions', a.id, {
    currentBid: amount,
    currentBidderId: user.id,
    bidCount: num(a.bidCount, 0) + 1,
    endAt,
    extensionCount,
    lastBidAt: nowIso(),
  });
  db.insert('auctionBids', {
    auctionId: a.id,
    userId: user.id,
    amount,
    createdAt: nowIso(),
  });
  antifraudRecord(user.id, a.id, 'bid');
  if (previousBidder && previousBidder !== user.id) {
    notify(previousBidder, 'outbid', 'Você foi ultrapassado!', 'Seu lance no leilão "' + a.title + '" foi superado.', a.id, { section: 'olho' });
  }
  return { auction: serializeAuction(updated, { user }), extended: extensionCount > num(a.extensionCount, 0) };
}

module.exports = {
  AUCTION_STATUSES,
  WINNER_STATUSES,
  ANTIFRAUD_STATUSES,
  round2,
  imagesOf,
  publicName,
  nextBidFor,
  statusOf,
  lotStatusOf,
  reputationOf,
  ensureReputation,
  reputationProfile,
  computeLevel,
  canParticipate,
  notify,
  addPoints,
  applyPenalty,
  processPaymentDeadlines,
  settleAuction,
  runAuctionTicks,
  bumpViews,
  serializeAuction,
  placeBid,
  ranking,
  participantCount,
  watcherCount,
  isWatching,
  updateCompletion,
};
