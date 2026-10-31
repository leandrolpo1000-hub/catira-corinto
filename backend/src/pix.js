const db = require('./db');

const DEFAULTS = {
  pixKey: '',
  pixKeyType: 'email',
  merchantName: 'CATIRA CORINTO',
  merchantCity: 'CORINTO',
  fee: 5,
  vipListingFee: 15,
  vipAccessFee: 20,
  vipDays: 30,
  highlightFee: 10,
  highlightDays: 7,
  premiumDayFee: 30,
  vipWhatsappGroup: '',
  feeEnabled: false,
  commonFeeEnabled: false,
  vipFeeEnabled: false,
  premiumFeeEnabled: true,
};

function flagEnabled(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function getSettings() {
  const row = db.findOne('settings', (s) => s.id === 'pix') || {};
  const merged = { ...DEFAULTS, ...row };
  const common = row.commonFeeEnabled !== undefined ? flagEnabled(row.commonFeeEnabled) : flagEnabled(merged.feeEnabled);
  const vip = row.vipFeeEnabled !== undefined ? flagEnabled(row.vipFeeEnabled) : flagEnabled(merged.feeEnabled);
  const premium = row.premiumFeeEnabled !== undefined ? flagEnabled(row.premiumFeeEnabled) : true;
  return {
    ...merged,
    id: 'pix',
    feeEnabled: common,
    commonFeeEnabled: common,
    vipFeeEnabled: vip,
    premiumFeeEnabled: premium,
    configured: !!(row.pixKey && String(row.pixKey).trim()),
  };
}

function parseFee(raw) {
  if (raw === undefined || raw === null || raw === '') return NaN;
  const str = String(raw).trim();
  const normalized = str.includes(',')
    ? str.replace(/\./g, '').replace(',', '.')
    : str.replace(/[^\d.]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function moneyFee(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : fallback;
}

function commonChargingEnabled() {
  return getSettings().commonFeeEnabled === true;
}

function vipChargingEnabled() {
  return getSettings().vipFeeEnabled === true;
}

function premiumChargingEnabled() {
  return getSettings().premiumFeeEnabled === true;
}

function chargingEnabled() {
  const s = getSettings();
  return s.commonFeeEnabled === true || s.vipFeeEnabled === true || s.premiumFeeEnabled === true;
}

function listingFee() {
  return moneyFee(getSettings().fee, 5);
}

function vipListingFee() {
  return moneyFee(getSettings().vipListingFee, 15);
}

function vipAccessFee() {
  return moneyFee(getSettings().vipAccessFee, 20);
}

function vipDays() {
  const n = parseInt(getSettings().vipDays, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(365, n) : 30;
}

function sanitizeVipWhatsappGroup(raw) {
  let url = String(raw || '').trim().slice(0, 300);
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const host = String(u.hostname || '').toLowerCase();
    const ok = host === 'chat.whatsapp.com'
      || host === 'wa.me'
      || host === 'api.whatsapp.com'
      || host === 'www.whatsapp.com'
      || host.endsWith('.whatsapp.com');
    return ok ? u.toString() : '';
  } catch {
    return '';
  }
}

function vipWhatsappGroup() {
  return sanitizeVipWhatsappGroup(getSettings().vipWhatsappGroup);
}

function highlightFee() {
  return moneyFee(getSettings().highlightFee, 10);
}

function highlightDays() {
  const n = parseInt(getSettings().highlightDays, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(365, n) : 7;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function premiumDayFee() {
  return moneyFee(getSettings().premiumDayFee, 30);
}

function brazilToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function weekdayOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 15, 0, 0));
  return dt.getUTCDay();
}

function premiumRateForDate(dateStr, full) {
  const dow = weekdayOf(dateStr);
  if (dow === null) return NaN;
  const base = Number(full) > 0 ? Number(full) : premiumDayFee();
  if (dow === 0) return round2(base);
  if (dow === 6) return round2((base * 2) / 3);
  return round2(base / 3);
}

function parsePremiumDays(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch {
      arr = s.split(/[,\s]+/);
    }
  }
  if (!Array.isArray(arr)) return [];
  const today = brazilToday();
  const uniq = [...new Set(arr.map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  uniq.sort();
  return uniq.filter((d) => d >= today).slice(0, 30);
}

function quotePremium(days, full) {
  const rate = Number(full) > 0 ? Number(full) : premiumDayFee();
  const items = (days || []).map((date) => ({
    date,
    weekday: weekdayOf(date),
    rate: premiumRateForDate(date, rate),
  }));
  const total = round2(items.reduce((s, i) => s + (Number(i.rate) || 0), 0));
  return { full: rate, items, total, days: days || [] };
}

function premiumUntilIso(lastDate) {
  if (!lastDate) return null;
  return String(lastDate).slice(0, 10) + 'T23:59:59.000-03:00';
}

const PREMIUM_HOLD_STATUS = ['published', 'awaiting_payment', 'awaiting_confirmation', 'paused', 'changes_requested', 'awaiting_review', 'payment_expired'];

function takenPremiumDays(exceptListingId) {
  const today = brazilToday();
  const taken = new Set();
  function addDays(days, skipId) {
    if (skipId && exceptListingId && skipId === exceptListingId) return;
    (Array.isArray(days) ? days : []).forEach((d) => {
      const day = String(d).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today) taken.add(day);
    });
  }
  db.findWhere('listings', (l) => l && l.premium && PREMIUM_HOLD_STATUS.includes(l.status)).forEach((l) => {
    addDays(l.premiumDays, l.id);
  });
  db.findWhere('payments', (p) => p && p.kind === 'premium_listing' && ['pending', 'awaiting_confirmation'].includes(p.status)).forEach((p) => {
    const days = (p.premiumQuote && p.premiumQuote.days) || p.premiumDays || [];
    addDays(days, p.listingId);
  });
  return [...taken].sort();
}

function refreshUnpaidPix() {
  const fee = listingFee();
  db.findWhere('payments', (p) => p.status !== 'paid' && p.promoApplied && Number(p.amount) > 0 && p.kind !== 'vip_access').forEach((p) => {
    const amount = Number(p.amount) || fee;
    const txid = ('CATIRA' + String(p.listingId).replace(/-/g, '')).slice(0, 25);
    const pix = buildPix({ amount, txid, description: 'Anuncio CATIRA' });
    db.update('payments', p.id, {
      pixCode: pix.pixCode || '',
      pixKey: pix.pixKey || '',
      transactionId: pix.transactionId || txid,
    });
  });
}

function requireFee(raw, label) {
  const n = parseFee(raw);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error('Informe um valor válido para ' + label + '.');
    err.status = 400;
    throw err;
  }
  return Math.round(n * 100) / 100;
}

function saveSettings(patch) {
  const current = getSettings();
  let fee = current.fee;
  let vipFee = moneyFee(current.vipListingFee, 15);
  let accessFee = moneyFee(current.vipAccessFee, 20);
  let days = vipDays();
  let featFee = moneyFee(current.highlightFee, 10);
  let featDays = highlightDays();
  let premFee = moneyFee(current.premiumDayFee, 30);
  let commonOn = current.commonFeeEnabled === true;
  let vipOn = current.vipFeeEnabled === true;
  let premiumOn = current.premiumFeeEnabled === true;
  if (patch.fee !== undefined && patch.fee !== '') {
    fee = requireFee(patch.fee, 'a taxa do anúncio');
  }
  if (patch.vipListingFee !== undefined && patch.vipListingFee !== '') {
    vipFee = requireFee(patch.vipListingFee, 'a taxa do anúncio em destaque');
  }
  if (patch.vipAccessFee !== undefined && patch.vipAccessFee !== '') {
    accessFee = requireFee(patch.vipAccessFee, 'a taxa de acesso VIP');
  }
  if (patch.vipDays !== undefined && patch.vipDays !== '') {
    const n = parseInt(patch.vipDays, 10);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      const err = new Error('Informe a duração do VIP em dias (1 a 365).');
      err.status = 400;
      throw err;
    }
    days = n;
  }
  if (patch.highlightFee !== undefined && patch.highlightFee !== '') {
    featFee = requireFee(patch.highlightFee, 'o preço do destaque');
  }
  if (patch.highlightDays !== undefined && patch.highlightDays !== '') {
    const n = parseInt(patch.highlightDays, 10);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      const err = new Error('Informe a duração do destaque em dias (1 a 365).');
      err.status = 400;
      throw err;
    }
    featDays = n;
  }
  if (patch.premiumDayFee !== undefined && patch.premiumDayFee !== '') {
    premFee = requireFee(patch.premiumDayFee, 'o valor do dia Premium');
  }
  if (patch.commonFeeEnabled !== undefined) {
    commonOn = flagEnabled(patch.commonFeeEnabled);
  } else if (patch.feeEnabled !== undefined) {
    commonOn = flagEnabled(patch.feeEnabled);
  }
  if (patch.vipFeeEnabled !== undefined) {
    vipOn = flagEnabled(patch.vipFeeEnabled);
  } else if (patch.feeEnabled !== undefined && patch.commonFeeEnabled === undefined) {
    vipOn = flagEnabled(patch.feeEnabled);
  }
  if (patch.premiumFeeEnabled !== undefined) {
    premiumOn = flagEnabled(patch.premiumFeeEnabled);
  }
  const next = {
    id: 'pix',
    pixKey: patch.pixKey !== undefined ? String(patch.pixKey).trim() : current.pixKey,
    pixKeyType: patch.pixKeyType || current.pixKeyType,
    merchantName: (patch.merchantName || current.merchantName).trim().slice(0, 25),
    merchantCity: (patch.merchantCity || current.merchantCity).trim().slice(0, 15).toUpperCase(),
    fee,
    vipListingFee: vipFee,
    vipAccessFee: accessFee,
    vipDays: days,
    highlightFee: featFee,
    highlightDays: featDays,
    premiumDayFee: premFee,
    vipWhatsappGroup: (() => {
      if (patch.vipWhatsappGroup === undefined) return sanitizeVipWhatsappGroup(current.vipWhatsappGroup);
      const raw = String(patch.vipWhatsappGroup || '').trim();
      if (!raw) return '';
      const url = sanitizeVipWhatsappGroup(raw);
      if (!url) {
        const err = new Error('Informe um link válido do WhatsApp (chat.whatsapp.com ou wa.me).');
        err.status = 400;
        throw err;
      }
      return url;
    })(),
    feeEnabled: commonOn,
    commonFeeEnabled: commonOn,
    vipFeeEnabled: vipOn,
    premiumFeeEnabled: premiumOn,
  };
  const existing = db.findById('settings', 'pix');
  const saved = existing ? db.update('settings', 'pix', next) : db.insert('settings', next);
  refreshUnpaidPix();
  return saved;
}

function emv(id, value) {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function normalizeKey(key, type) {
  const raw = String(key || '').trim();
  if (type === 'phone') {
    const d = raw.replace(/\D/g, '');
    if (d.startsWith('55')) return '+' + d;
    return '+55' + d;
  }
  if (type === 'cpf' || type === 'cnpj') return raw.replace(/\D/g, '');
  return raw;
}

function buildPix({ amount, txid, description }) {
  const cfg = getSettings();
  if (!cfg.pixKey) {
    return { error: 'Chave PIX não configurada.', configured: false };
  }
  const key = normalizeKey(cfg.pixKey, cfg.pixKeyType);
  const name = (cfg.merchantName || 'CATIRA').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().slice(0, 25);
  const city = (cfg.merchantCity || 'CORINTO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().slice(0, 15);
  const id = String(txid || 'CATIRA').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || 'CATIRA';
  const gui = emv('00', 'BR.GOV.BCB.PIX') + emv('01', key) + (description ? emv('02', String(description).slice(0, 50)) : '');
  const merchant = emv('26', gui);
  const additional = emv('62', emv('05', id));
  const base =
    emv('00', '01') +
    emv('01', '12') +
    merchant +
    emv('52', '0000') +
    emv('53', '986') +
    emv('54', Number(amount).toFixed(2)) +
    emv('58', 'BR') +
    emv('59', name) +
    emv('60', city) +
    additional +
    '6304';
  const pixCode = base + crc16(base);
  return {
    pixCode,
    transactionId: id,
    amount: Number(amount),
    pixKey: key,
    merchantName: name,
    merchantCity: city,
    configured: true,
  };
}

module.exports = {
  getSettings,
  saveSettings,
  buildPix,
  chargingEnabled,
  commonChargingEnabled,
  vipChargingEnabled,
  premiumChargingEnabled,
  listingFee,
  vipListingFee,
  vipAccessFee,
  vipDays,
  vipWhatsappGroup,
  highlightFee,
  highlightDays,
  premiumDayFee,
  premiumRateForDate,
  parsePremiumDays,
  quotePremium,
  premiumUntilIso,
  brazilToday,
  weekdayOf,
  takenPremiumDays,
  parseFee,
  DEFAULTS,
};
