const TOKEN_KEY = 'catira_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo deu errado.');
  return data;
}

export const money = (n) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

export function parseBRL(value) {
  const digits = digitsOnly(value).slice(0, 11);
  if (!digits) return 0;
  return Number(digits) / 100;
}

export function formatBRLInput(value) {
  const digits = digitsOnly(value).slice(0, 11);
  if (!digits) return '';
  return (Number(digits) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const condLabel = {
  novo: 'Novo',
  usado: 'Usado',
  seminovo: 'Seminovo',
};

export const statusLabel = {
  draft: 'Rascunho',
  awaiting_payment: 'Aguardando pagamento',
  awaiting_confirmation: 'Aguardando confirmação',
  awaiting_review: 'Aguardando revisão',
  payment_expired: 'Pagamento expirado',
  changes_requested: 'Correção solicitada',
  paid: 'Pago',
  published: 'Ativo',
  paused: 'Pausado',
  sold: 'Vendido',
  traded: 'Trocado',
  negotiated: 'Negociado',
  expired: 'Expirado',
  cancelled: 'Encerrado',
  sent: 'Proposta enviada',
  negotiating: 'Em negociação',
  accepted: 'Aceita',
  rejected: 'Recusada',
  finished: 'Finalizada',
  open: 'Aberta',
  reviewed: 'Analisada',
  resolved: 'Resolvida',
  dismissed: 'Descartada',
  under_review: 'Oportunidade em análise',
  available: 'Disponível para propostas',
  reserved: 'Reservada',
  completed: 'Concluída',
  interested: 'Interesse enviado',
  disputed: 'Em disputa',
};

export const reportReasons = [
  { id: 'golpe', label: 'Possível golpe' },
  { id: 'falso', label: 'Anúncio falso' },
  { id: 'proibido', label: 'Produto proibido' },
  { id: 'preco', label: 'Informação enganosa' },
  { id: 'inadequado', label: 'Conteúdo inadequado' },
  { id: 'outro', label: 'Outro' },
];

export const listingTypes = [
  { id: 'venda', label: 'Venda' },
  { id: 'troca', label: 'Troca' },
  { id: 'venda_troca', label: 'Venda ou troca' },
  { id: 'procuro', label: 'Procuro' },
];

export function typeLabel(t) {
  return (listingTypes.find((x) => x.id === t) || {}).label || 'Venda';
}

export function priceText(item) {
  const value = money(item?.price);
  if (item?.listingType === 'procuro') return 'Até ' + value;
  return value;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function weekdayOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 15, 0, 0)).getUTCDay();
}

export function weekdayName(dateStr) {
  const names = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const d = weekdayOf(dateStr);
  return d === null ? '' : names[d];
}

export function premiumRateForDate(dateStr, full) {
  const dow = weekdayOf(dateStr);
  if (dow === null) return 0;
  const base = Number(full) || 0;
  if (dow === 0) return round2(base);
  if (dow === 6) return round2((base * 2) / 3);
  return round2(base / 3);
}

export function quotePremiumDays(days, full) {
  const items = (days || []).map((date) => ({
    date,
    weekday: weekdayOf(date),
    label: weekdayName(date),
    rate: premiumRateForDate(date, full),
  }));
  const total = round2(items.reduce((s, i) => s + (Number(i.rate) || 0), 0));
  return { items, total };
}

export function addDaysISO(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export const auctionStatusLabel = {
  scheduled: 'Agendado',
  soon: 'Em breve',
  live: 'Ao vivo',
  last_seconds: 'Últimos segundos',
  ended: 'Encerrado',
  sold: 'Arrematado',
  cancelled: 'Cancelado',
};

export function lotLabel(item) {
  const key = (item && (item.lotStatus || item.status)) || '';
  return auctionStatusLabel[key] || key;
}

export const winnerStatusLabel = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pago',
  EXPIRED: 'Prazo vencido',
  CANCELLED: 'Cancelado',
  COMPLETED: 'Concluído',
};

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 23) {
    const d = Math.floor(h / 24);
    return d + 'd ' + pad2(h % 24) + ':' + pad2(m) + ':' + pad2(sec);
  }
  return pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
}

export function auctionTimerTone(ms) {
  if (ms <= 0) return 'ended';
  if (ms <= 10000) return 'critical';
  if (ms <= 60000) return 'hot';
  return 'ok';
}
