const db = require('../db');
const { getAuctionConfig } = require('./config');
const { serializeAuction } = require('./engine');

const TZ = 'America/Sao_Paulo';
const WEEK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function tz() {
  return getAuctionConfig().settings.sundayTimezone || TZ;
}

function dateKeyInTz(date, zone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone || tz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

function weekdayOfKey(dateKey, zone) {
  const [Y, M, D] = String(dateKey).split('-').map(Number);
  const noon = new Date(Date.UTC(Y, M - 1, D, 15, 0, 0));
  const w = new Intl.DateTimeFormat('en-US', { timeZone: zone || tz(), weekday: 'short' }).format(noon);
  return WEEK[w] ?? 0;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function atTimeOnDate(dateKey, hm) {
  const parts = String(hm || '00:00').split(':');
  const h = pad2(parseInt(parts[0], 10) || 0);
  const m = pad2(parseInt(parts[1], 10) || 0);
  return new Date(dateKey + 'T' + h + ':' + m + ':00-03:00');
}

function parseHm(s) {
  const parts = String(s || '00:00').split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

function minutesOnDate(date, dateKey, zone) {
  if (dateKeyInTz(date, zone) !== dateKey) {
    if (new Date(date).getTime() < atTimeOnDate(dateKey, '00:00').getTime()) return -1;
    return 24 * 60 + 1;
  }
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: zone || tz(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(date)).forEach((p) => { if (p.type !== 'literal') parts[p.type] = p.value; });
  return (parseInt(parts.hour, 10) || 0) * 60 + (parseInt(parts.minute, 10) || 0);
}

function nextEventDateKey(now, weekday, zone) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const key = dateKeyInTz(d, zone);
    if (weekdayOfKey(key, zone) === weekday) return key;
  }
  return dateKeyInTz(now, zone);
}

function clockOf(settings) {
  return {
    open: settings.sundayOpenTime || '09:00',
    firstStart: settings.sundayFirstRoundStart || '10:00',
    firstEnd: settings.sundayFirstRoundEnd || '11:00',
    warmupStart: settings.sundayWarmupStart || '14:00',
    warmupEnd: settings.sundayWarmupEnd || '19:30',
    mainStart: settings.sundayMainStart || '20:00',
    mainEnd: settings.sundayMainEnd || '21:30',
    final: settings.sundayFinalLotTime || '21:30',
  };
}

function phaseOf(now, dateKey, settings, flags) {
  const zone = settings.sundayTimezone || TZ;
  const today = dateKeyInTz(now, zone);
  const clock = clockOf(settings);
  if (today < dateKey) return 'upcoming';
  if (today > dateKey) return 'closed';
  const t = minutesOnDate(now, dateKey, zone);
  const open = parseHm(clock.open);
  const firstStart = parseHm(clock.firstStart);
  const firstEnd = parseHm(clock.firstEnd);
  const warmupStart = parseHm(clock.warmupStart);
  const warmupEnd = parseHm(clock.warmupEnd);
  const mainStart = parseHm(clock.mainStart);
  const mainEnd = parseHm(clock.mainEnd);
  if (t < open) return 'pre';
  if (t < firstStart) return 'discovery';
  if (t < firstEnd) return 'first_round';
  if (!flags.auction_warmup_enabled) {
    if (t < mainStart) return flags.auction_countdown_enabled && t >= warmupEnd ? 'countdown' : 'interval';
  } else {
    if (t < warmupStart) return 'interval';
    if (t < warmupEnd) return 'warmup';
    if (t < mainStart) return flags.auction_countdown_enabled ? 'countdown' : 'warmup';
  }
  if (t < mainEnd) return 'main';
  return 'final';
}

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEKDAY_TITLES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function weekdayName(settings) {
  const n = Number(settings && settings.sundayEventWeekday);
  return WEEKDAY_NAMES[Number.isFinite(n) ? n : 0] || 'domingo';
}

function copyFor(phase, clock, settings) {
  const start = clock.mainStart || '20:00';
  const day = weekdayName(settings);
  const wd = Number(settings && settings.sundayEventWeekday);
  const Day = WEEKDAY_TITLES[Number.isFinite(wd) ? wd : 0] || 'Domingo';
  if (phase === 'upcoming') {
    return {
      kicker: 'Leilão programado',
      title: Day + ' tem leilão no CATIRA!',
      text: 'Confira os lotes e escolha seus favoritos.',
    };
  }
  if (phase === 'pre' || phase === 'discovery') {
    return {
      kicker: 'Leilão programado',
      title: 'Hoje tem leilão no CATIRA!',
      text: 'Confira os lotes e escolha seus favoritos.',
    };
  }
  if (phase === 'first_round') {
    return {
      kicker: 'Primeira rodada',
      title: 'Itens para você experimentar o leilão',
      text: 'Lotes mais simples agora. Os melhores ficam para a noite.',
    };
  }
  if (phase === 'interval') {
    return {
      kicker: 'Aquecimento',
      title: 'O grande leilão acontece hoje à noite',
      text: 'Os melhores lotes entram em disputa a partir das ' + start.replace(':', 'h') + '.',
    };
  }
  if (phase === 'warmup' || phase === 'countdown') {
    return {
      kicker: 'Hoje à noite',
      title: 'O grande leilão acontece hoje à noite',
      text: 'Os melhores lotes entram em disputa a partir das ' + start.replace(':', 'h') + '.',
    };
  }
  if (phase === 'main') {
    return {
      kicker: 'Ao vivo',
      title: 'Grande rodada da noite',
      text: 'Acompanhe o lote atual e prepare-se para o próximo.',
    };
  }
  if (phase === 'final') {
    return {
      kicker: 'Grande final',
      title: 'O último e maior lote da noite',
      text: 'O encerramento do leilão.',
    };
  }
  return {
    kicker: 'Em breve',
    title: 'Leilão encerrado',
    text: 'Estamos preparando nosso próximo evento e divulgaremos em breve.',
  };
}

function sundayLots(dateKey, zone) {
  return db
    .findWhere('auctions', (a) => a.sundayEvent && a.status !== 'cancelled' && dateKeyInTz(a.startAt, zone) === dateKey)
    .sort((a, b) => {
      const ao = Number(a.programOrder) || 0;
      const bo = Number(b.programOrder) || 0;
      if (ao !== bo) return ao - bo;
      return new Date(a.startAt) - new Date(b.startAt);
    });
}

function pickEventDate(now, settings, zone) {
  const weekday = Number(settings.sundayEventWeekday);
  const wd = Number.isFinite(weekday) ? weekday : 0;
  const today = dateKeyInTz(now, zone);
  if (sundayLots(today, zone).length) return today;
  const next = nextEventDateKey(now, wd, zone);
  if (sundayLots(next, zone).length) return next;
  const grouped = {};
  db.findWhere('auctions', (a) => a.sundayEvent && a.status !== 'cancelled').forEach((a) => {
    const k = dateKeyInTz(a.startAt, zone);
    grouped[k] = (grouped[k] || 0) + 1;
  });
  const future = Object.keys(grouped).filter((k) => k >= today).sort();
  if (future.length) return future[0];
  const past = Object.keys(grouped).sort();
  if (past.length) return past[past.length - 1];
  return next;
}

function sundayProgram(opts = {}) {
  const cfg = getAuctionConfig();
  const flags = cfg.flags;
  const settings = cfg.settings;
  const zone = settings.sundayTimezone || TZ;
  const now = opts.now || new Date();
  const enabled = !!(flags.auction_enabled && flags.auction_sunday_schedule_enabled);
  const dateKey = pickEventDate(now, settings, zone);
  const clock = clockOf(settings);
  const phase = enabled ? phaseOf(now, dateKey, settings, flags) : 'off';
  const raw = enabled ? sundayLots(dateKey, zone) : [];
  const user = opts.user || null;
  const items = raw.map((a) => serializeAuction(a, { user }));
  const live = items.filter((a) => a.lotStatus === 'live' || a.lotStatus === 'last_seconds');
  const liveLot = live[0] || null;
  const upcoming = items.filter((a) => a.lotStatus === 'scheduled' || a.lotStatus === 'soon');
  const nextLot = upcoming[0] || null;
  const remainingLots = upcoming.length + live.length;
  const featured = flags.auction_featured_lots_enabled
    ? items.filter((a) => a.featured || a.finalLot || a.round === 'main')
    : [];
  const finalLot = flags.auction_final_lot_enabled ? (items.find((a) => a.finalLot) || null) : null;
  const mainAt = atTimeOnDate(dateKey, clock.mainStart);
  const finalAt = finalLot ? new Date(finalLot.startAt) : atTimeOnDate(dateKey, clock.final);
  const copy = copyFor(phase === 'main' && finalLot && (finalLot.lotStatus === 'live' || finalLot.lotStatus === 'last_seconds') ? 'final' : phase, clock, settings);
  const allEnded = items.length > 0 && items.every((a) => a.lotStatus === 'ended' || a.lotStatus === 'sold' || a.lotStatus === 'cancelled');
  const closed = allEnded || phase === 'closed';
  return {
    enabled,
    date: dateKey,
    phase: closed && phase !== 'upcoming' ? 'closed' : phase,
    serverNow: Date.now(),
    clock,
    mainStartsAt: mainAt.toISOString(),
    finalStartsAt: finalAt.toISOString(),
    copy,
    liveLot,
    nextLot,
    remainingLots,
    featured,
    finalLot,
    items,
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
  TZ,
  dateKeyInTz,
  weekdayOfKey,
  atTimeOnDate,
  nextEventDateKey,
  clockOf,
  phaseOf,
  sundayLots,
  sundayProgram,
  pickEventDate,
  copyFor,
  weekdayName,
};
