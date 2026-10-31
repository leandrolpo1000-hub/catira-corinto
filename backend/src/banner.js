const db = require('./db');

const DEFAULTS = {
  id: 'homeBanner',
  enabled: false,
  imageUrl: '',
  link: '',
  title: '',
};

function getBannerSettings() {
  const row = db.findOne('settings', (s) => s.id === 'homeBanner') || {};
  return { ...DEFAULTS, ...row, id: 'homeBanner' };
}

function publicBanner() {
  const s = getBannerSettings();
  const enabled = s.enabled === true || s.enabled === 'true' || s.enabled === 1;
  const imageUrl = String(s.imageUrl || '').trim();
  return {
    enabled: enabled && !!imageUrl,
    imageUrl,
    link: String(s.link || '').trim(),
    title: String(s.title || '').trim(),
  };
}

function adminBanner() {
  const s = getBannerSettings();
  return {
    enabled: s.enabled === true || s.enabled === 'true' || s.enabled === 1,
    imageUrl: String(s.imageUrl || '').trim(),
    link: String(s.link || '').trim(),
    title: String(s.title || '').trim(),
  };
}

function normalizeLink(raw) {
  const link = String(raw || '').trim();
  if (!link) return '';
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  if (/^https?:\/\//i.test(link)) return link;
  const err = new Error('O link deve começar com / ou http.');
  err.status = 400;
  throw err;
}

function saveBannerSettings(patch) {
  const current = getBannerSettings();
  const next = {
    id: 'homeBanner',
    enabled: patch.enabled === undefined
      ? (current.enabled === true || current.enabled === 'true' || current.enabled === 1)
      : (patch.enabled === true || patch.enabled === 'true' || patch.enabled === 1),
    imageUrl: patch.imageUrl ? String(patch.imageUrl).trim() : String(current.imageUrl || '').trim(),
    link: patch.link !== undefined ? normalizeLink(patch.link) : String(current.link || '').trim(),
    title: patch.title !== undefined ? String(patch.title || '').trim() : String(current.title || '').trim(),
  };
  if (next.enabled && !next.imageUrl) {
    const err = new Error('Envie a imagem do banner antes de ativar.');
    err.status = 400;
    throw err;
  }
  const existing = db.findById('settings', 'homeBanner');
  return existing ? db.update('settings', 'homeBanner', next) : db.insert('settings', next);
}

module.exports = { publicBanner, adminBanner, saveBannerSettings };
