const db = require('../db');
const { getAuctionConfig } = require('./config');
const { serializeAuction, lotStatusOf } = require('./engine');
const { dateKeyInTz, clockOf, phaseOf, atTimeOnDate, copyFor, TZ } = require('./sunday');

function endedLot(a) {
  const st = lotStatusOf(a);
  return st === 'ended' || st === 'sold' || st === 'cancelled';
}

function lotsOf(editionId) {
  return db
    .findWhere('auctions', (a) => a.editionId === editionId && a.status !== 'cancelled')
    .sort((a, b) => {
      const ao = Number(a.programOrder) || 0;
      const bo = Number(b.programOrder) || 0;
      if (ao !== bo) return ao - bo;
      return new Date(a.startAt) - new Date(b.startAt);
    });
}

function applyLotSequence(editionId) {
  const ed = db.findById('auctionEditions', editionId);
  if (!ed) return [];
  const cfg = getAuctionConfig();
  const interval = Math.max(0, Number(cfg.settings.sundayLotIntervalMinutes) || 0);
  const defMins = Math.max(1, Number(cfg.settings.sundayDefaultDurationMinutes) || 8);
  const clock = cfg.settings.sundayMainStart || '20:00';
  let cursor = ed.date ? atTimeOnDate(ed.date, clock) : new Date();
  if (Number.isNaN(cursor.getTime())) cursor = new Date();
  return db.batch(() => {
    const lots = lotsOf(editionId);
    lots.forEach((a, i) => {
      const order = i + 1;
      const durationMinutes = Math.max(1, Number(a.durationMinutes) || Math.round(Number(a.durationHours || 0) * 60) || defMins);
      const locked = a.status === 'live' || a.status === 'ended' || a.status === 'cancelled' || Number(a.bidCount) > 0;
      if (locked) {
        db.update('auctions', a.id, { programOrder: order });
        if (a.endAt) {
          const next = new Date(a.endAt).getTime() + interval * 60000;
          if (next > cursor.getTime()) cursor = new Date(next);
        }
        return;
      }
      const startAt = cursor;
      const endAt = new Date(startAt.getTime() + durationMinutes * 60000);
      db.update('auctions', a.id, {
        programOrder: order,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        originalEndAt: endAt.toISOString(),
        durationMinutes,
        durationHours: durationMinutes / 60,
        status: startAt.getTime() <= Date.now() ? 'live' : 'scheduled',
      });
      cursor = new Date(endAt.getTime() + interval * 60000);
    });
    return lotsOf(editionId);
  });
}

function reorderEditionLots(editionId, ids) {
  return db.batch(() => {
    const lots = lotsOf(editionId);
    const allowed = new Set(lots.map((a) => a.id));
    const ordered = (Array.isArray(ids) ? ids : []).filter((id) => allowed.has(id));
    lots.forEach((a) => { if (!ordered.includes(a.id)) ordered.push(a.id); });
    ordered.forEach((id, i) => db.update('auctions', id, { programOrder: i + 1 }));
    return applyLotSequence(editionId);
  });
}

function editionTimes(ed, lots) {
  const list = lots || lotsOf(ed.id);
  const starts = list.map((a) => a.startAt && new Date(a.startAt).getTime()).filter(Boolean);
  const ends = list.map((a) => a.endAt && new Date(a.endAt).getTime()).filter(Boolean);
  const startAt = ed.startAt || (starts.length ? new Date(Math.min(...starts)).toISOString() : null);
  const endAt = ends.length ? new Date(Math.max(...ends)).toISOString() : (ed.endAt || null);
  return { startAt, endAt, lotCount: list.length };
}

function editionClosed(ed, lots) {
  if (!ed || ed.status === 'closed' || ed.status === 'cancelled') return true;
  const list = lots || lotsOf(ed.id);
  if (!list.length) {
    const today = dateKeyInTz(new Date(), getAuctionConfig().settings.sundayTimezone || TZ);
    return !!(ed.date && ed.date < today);
  }
  return list.every(endedLot);
}

function editionLive(ed, lots) {
  const list = lots || lotsOf(ed.id);
  if (!ed || editionClosed(ed, list)) return false;
  return list.some((a) => {
    const st = lotStatusOf(a);
    return st === 'live' || st === 'last_seconds';
  });
}

function derivedEditionStatus(ed, lots) {
  if (!ed) return 'draft';
  if (ed.status === 'cancelled') return 'cancelled';
  const list = lots || lotsOf(ed.id);
  if (editionClosed(ed, list)) return 'closed';
  if (editionLive(ed, list)) return 'live';
  const times = editionTimes(ed, list);
  if (times.startAt && new Date(times.startAt).getTime() <= Date.now()) return 'open';
  return ed.status === 'draft' && !times.lotCount ? 'draft' : 'queued';
}

function allEditions() {
  if (!db.all('auctionEditions')) return [];
  return db
    .all('auctionEditions')
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0) || String(a.date || '').localeCompare(String(b.date || '')));
}

function nextEditionNumber() {
  const max = allEditions().reduce((m, e) => Math.max(m, Number(e.number) || 0), 0);
  const cancelled = (db.all('auctionEditions') || []).reduce((m, e) => Math.max(m, Number(e.number) || 0), 0);
  return Math.max(max, cancelled) + 1;
}

let publicEditionCache = { at: 0, value: null };

function currentPublicEdition() {
  const now = Date.now();
  if (publicEditionCache.value && now - publicEditionCache.at < 1000) return publicEditionCache.value;
  const eds = allEditions();
  const open = eds.find((e) => !editionClosed(e));
  const value = open || eds[eds.length - 1] || null;
  publicEditionCache = { at: now, value };
  return value;
}

function nextQueuedEdition(current) {
  if (!current) return allEditions().find((e) => !editionClosed(e)) || null;
  return allEditions().find((e) => e.id !== current.id && Number(e.number) > Number(current.number) && !editionClosed(e)) || null;
}

function serializeEdition(ed, opts = {}) {
  if (!ed) return null;
  const list = lotsOf(ed.id);
  const times = editionTimes(ed, list);
  const status = derivedEditionStatus(ed, list);
  const lots = opts.withLots
    ? list.map((a) => serializeAuction(a, { user: opts.user, light: opts.light !== false }))
    : undefined;
  return {
    id: ed.id,
    number: Number(ed.number) || 0,
    title: ed.title || ('Edição ' + (ed.number || '')),
    date: ed.date || '',
    startAt: times.startAt,
    endAt: times.endAt,
    status,
    lotCount: times.lotCount,
    notes: ed.notes || '',
    createdAt: ed.createdAt,
    items: lots,
  };
}

function publicLotVisible(a, viewer) {
  if (!a) return false;
  if (viewer && require('../middleware').isAdminRole(viewer.role)) return true;
  if (!a.editionId && !a.sundayEvent) return true;
  const current = currentPublicEdition();
  if (!current) return !a.editionId;
  if (a.editionId) return a.editionId === current.id;
  const zone = getAuctionConfig().settings.sundayTimezone || TZ;
  return dateKeyInTz(a.startAt, zone) === current.date;
}

function ensureEditions() {
  if (!db.getCache().auctionEditions) db.getCache().auctionEditions = [];
  const orphans = db.findWhere('auctions', (a) => a.sundayEvent && !a.editionId && a.status !== 'cancelled');
  if (!orphans.length) return;
  const zone = getAuctionConfig().settings.sundayTimezone || TZ;
  const groups = {};
  orphans.forEach((a) => {
    const k = dateKeyInTz(a.startAt, zone);
    if (!groups[k]) groups[k] = [];
    groups[k].push(a);
  });
  db.batch(() => {
    Object.keys(groups).sort().forEach((date) => {
      const existing = db.findOne('auctionEditions', (e) => e.date === date && e.status !== 'cancelled');
      const ed = existing || db.insert('auctionEditions', {
        number: nextEditionNumber(),
        title: 'CATIRA LEILÃO',
        date,
        notes: '',
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
      groups[date].forEach((a) => db.update('auctions', a.id, { editionId: ed.id }));
    });
  });
}

function createEdition(body, user) {
  ensureEditions();
  const b = body || {};
  const date = String(b.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const e = new Error('Informe a data da edição.');
    e.status = 400;
    throw e;
  }
  const number = Number(b.number) || nextEditionNumber();
  if (db.findOne('auctionEditions', (e) => Number(e.number) === number && e.status !== 'cancelled')) {
    const e = new Error('Já existe a edição ' + number + '.');
    e.status = 400;
    throw e;
  }
  const title = String(b.title || ('CATIRA LEILÃO #' + number)).trim().slice(0, 80);
  return db.insert('auctionEditions', {
    number,
    title,
    date,
    notes: String(b.notes || '').slice(0, 400),
    status: 'queued',
    createdBy: user && user.id,
    createdAt: new Date().toISOString(),
  });
}

function editionProgram(opts = {}) {
  ensureEditions();
  const cfg = getAuctionConfig();
  const flags = cfg.flags;
  const settings = cfg.settings;
  const zone = settings.sundayTimezone || TZ;
  const now = opts.now || new Date();
  const enabled = !!(flags.auction_enabled && flags.auction_sunday_schedule_enabled);
  const user = opts.user || null;
  const admin = !!(user && require('../middleware').isAdminRole(user.role));
  const current = enabled ? currentPublicEdition() : null;
  const nextEd = current ? nextQueuedEdition(current) : null;
  const dateKey = current && current.date ? current.date : dateKeyInTz(now, zone);
  const clock = clockOf(settings);
  let phase = enabled ? phaseOf(now, dateKey, settings, flags) : 'off';
  const raw = enabled && current ? lotsOf(current.id) : [];
  const compact = !!opts.compact;
  const items = raw.map((a) => serializeAuction(a, { user, light: true, cfg }));
  const live = items.filter((a) => a.lotStatus === 'live' || a.lotStatus === 'last_seconds');
  const liveLot = live[0] ? serializeAuction(raw.find((a) => a.id === live[0].id), { user, cfg }) : null;
  const upcoming = items.filter((a) => a.lotStatus === 'scheduled' || a.lotStatus === 'soon');
  const nextLot = upcoming[0] || null;
  const remainingLots = upcoming.length + live.length;
  const featured = flags.auction_featured_lots_enabled
    ? items.filter((a) => a.featured || a.finalLot || a.round === 'main')
    : [];
  const finalLot = flags.auction_final_lot_enabled ? (items.find((a) => a.finalLot) || null) : null;
  const mainAt = current && current.date ? atTimeOnDate(current.date, clock.mainStart) : atTimeOnDate(dateKey, clock.mainStart);
  const times = current ? editionTimes(current, raw) : { startAt: null, endAt: null };
  const nextTimes = nextEd ? editionTimes(nextEd) : { startAt: null, endAt: null };
  const finalAt = finalLot ? new Date(finalLot.startAt) : (times.endAt ? new Date(times.endAt) : atTimeOnDate(dateKey, clock.final));
  const edStatus = current ? derivedEditionStatus(current, raw) : 'closed';
  const allEnded = items.length > 0 && items.every((a) => a.lotStatus === 'ended' || a.lotStatus === 'sold' || a.lotStatus === 'cancelled');
  const closed = !current || edStatus === 'closed' || allEnded;
  if (liveLot) {
    if (liveLot.finalLot || liveLot.round === 'final') phase = 'final';
    else if (liveLot.round === 'first') phase = 'first_round';
    else phase = 'main';
  } else if (closed) {
    phase = nextEd ? 'upcoming' : 'closed';
  } else if (nextLot) {
    const untilMin = (new Date(nextLot.startAt).getTime() - now.getTime()) / 60000;
    if (phase !== 'upcoming' && flags.auction_countdown_enabled && untilMin <= 30) phase = 'countdown';
    else if (phase !== 'upcoming' && flags.auction_warmup_enabled && untilMin <= 240) phase = phase === 'pre' || phase === 'discovery' || phase === 'interval' || phase === 'warmup' || phase === 'countdown' ? phase : 'warmup';
  }
  const copyPhase = phase === 'main' && finalLot && (finalLot.lotStatus === 'live' || finalLot.lotStatus === 'last_seconds') ? 'final' : phase;
  let copy = typeof copyFor === 'function'
    ? copyFor(closed && !nextEd ? 'closed' : copyPhase, clock, settings)
    : { kicker: 'CATIRA LEILÃO', title: 'Leilão', text: '' };
  if (current) {
    copy = {
      ...copy,
      kicker: current.title || copy.kicker,
      title: closed ? (current.title + ' encerrada') : (liveLot ? current.title : copy.title),
    };
    if (closed && nextEd) {
      copy.text = 'A edição ' + nextEd.number + ' entra no ar agora.';
    } else if (closed) {
      copy.kicker = 'Em breve';
      copy.text = 'Estamos preparando nosso próximo evento e divulgaremos em breve.';
    }
  }
  const nextStart = (nextLot && nextLot.startAt)
    || times.startAt
    || (closed && nextEd && (nextTimes.startAt || (nextEd.date && atTimeOnDate(nextEd.date, clock.mainStart).toISOString())))
    || mainAt.toISOString();
  return {
    enabled,
    date: dateKey,
    phase: closed && !nextEd ? 'closed' : phase,
    serverNow: Date.now(),
    clock,
    mainStartsAt: nextStart,
    finalStartsAt: finalAt.toISOString(),
    copy,
    liveLot,
    nextLot,
    remainingLots,
    featured: compact ? featured.slice(0, 6) : featured,
    finalLot,
    items: compact ? items.filter((a) => a.lotStatus !== 'ended' && a.lotStatus !== 'sold') : items,
    edition: serializeEdition(current),
    nextEdition: serializeEdition(nextEd),
    flags: {
      countdown: !!flags.auction_countdown_enabled,
      liveMode: !!flags.auction_live_mode_enabled,
      warmup: !!flags.auction_warmup_enabled,
      featured: !!flags.auction_featured_lots_enabled,
      finalLot: !!flags.auction_final_lot_enabled,
      watchers: !!flags.auction_watchers_enabled,
      notifications: !!flags.auction_notifications_enabled,
      extension: !!(flags.auction_lot_extension_enabled || flags.auction_auto_extension_enabled),
    },
  };
}

module.exports = {
  lotsOf,
  editionTimes,
  editionClosed,
  derivedEditionStatus,
  allEditions,
  nextEditionNumber,
  currentPublicEdition,
  nextQueuedEdition,
  serializeEdition,
  publicLotVisible,
  ensureEditions,
  createEdition,
  editionProgram,
  applyLotSequence,
  reorderEditionLots,
};
