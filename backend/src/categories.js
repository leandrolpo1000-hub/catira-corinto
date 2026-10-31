const db = require('./db');

const CATEGORIES = [
  { slug: 'veiculos', name: 'Veículos', icon: 'car', order: 1 },
  { slug: 'tecnologia', name: 'Celulares e Tecnologia', icon: 'phone', order: 2 },
  { slug: 'casa-moveis', name: 'Casa e Móveis', icon: 'home', order: 3 },
  { slug: 'moda', name: 'Moda e Acessórios', icon: 'shirt', order: 4 },
  { slug: 'ferramentas', name: 'Ferramentas', icon: 'tool', order: 5 },
  { slug: 'agro', name: 'Agro e Rural', icon: 'plant', order: 6 },
  { slug: 'animais', name: 'Animais', icon: 'cow', order: 7 },
  { slug: 'lazer', name: 'Esportes e Lazer', icon: 'sport', order: 8 },
  { slug: 'imoveis', name: 'Imóveis', icon: 'building', order: 9 },
  { slug: 'servicos', name: 'Serviços e Outros', icon: 'briefcase', order: 10 },
];

const SLUG_ALIAS = {
  veiculos: 'veiculos',
  'carros-motos': 'veiculos',
  motos: 'veiculos',
  carros: 'veiculos',
  bicicletas: 'veiculos',
  tecnologia: 'tecnologia',
  celulares: 'tecnologia',
  eletronicos: 'tecnologia',
  informatica: 'tecnologia',
  games: 'tecnologia',
  'casa-moveis': 'casa-moveis',
  moveis: 'casa-moveis',
  eletrodomesticos: 'casa-moveis',
  moda: 'moda',
  roupas: 'moda',
  ferramentas: 'ferramentas',
  agro: 'agro',
  rural: 'agro',
  animais: 'animais',
  lazer: 'lazer',
  esportes: 'lazer',
  infantil: 'lazer',
  livros: 'lazer',
  imoveis: 'imoveis',
  servicos: 'servicos',
  outros: 'servicos',
};

const BIKE_RE = /\b(bicicleta|bike|bikes|ciclismo|aro\s*2[0-9])\b/i;

function canonicalSlug(slug) {
  const key = String(slug || '').trim().toLowerCase();
  return SLUG_ALIAS[key] || '';
}

function looksLikeBike(row) {
  const hay = [row && row.title, row && row.subcategory, row && row.description]
    .filter(Boolean)
    .join(' ');
  return BIKE_RE.test(hay);
}

function targetSlugFor(oldSlug, row) {
  if (looksLikeBike(row) || oldSlug === 'bicicletas') return 'veiculos';
  return canonicalSlug(oldSlug) || 'servicos';
}

function bySlug(slug) {
  return db.findOne('categories', (c) => c.slug === slug);
}

function activeCategories() {
  return db
    .all('categories')
    .filter((c) => c.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function resolveCategory(ref) {
  if (!ref) return null;
  const raw = String(ref);
  const byId = db.findById('categories', raw);
  if (byId && byId.active !== false) return byId;
  const slug = canonicalSlug(raw) || raw;
  const cat = bySlug(slug);
  if (cat && cat.active !== false) return cat;
  if (byId) {
    const mapped = bySlug(canonicalSlug(byId.slug) || byId.slug);
    if (mapped && mapped.active !== false) return mapped;
  }
  return null;
}

function ensureCanonicalRows() {
  CATEGORIES.forEach((c) => {
    const existing = bySlug(c.slug);
    if (existing) {
      db.update('categories', existing.id, {
        name: c.name,
        icon: c.icon,
        order: c.order,
        parentId: null,
        active: true,
      });
      return;
    }
    db.insert('categories', {
      slug: c.slug,
      name: c.name,
      icon: c.icon,
      order: c.order,
      parentId: null,
      active: true,
    });
  });
}

function remapIdList(ids) {
  const seen = {};
  const out = [];
  (ids || []).forEach((id) => {
    const old = db.findById('categories', id);
    const slug = targetSlugFor(old && old.slug, null);
    const next = bySlug(slug);
    const nid = next ? next.id : id;
    if (seen[nid]) return;
    seen[nid] = true;
    out.push(nid);
  });
  return out;
}

function migrateTable(table) {
  const rows = db.all(table) || [];
  rows.forEach((row) => {
    const old = db.findById('categories', row.categoryId);
    const oldSlug = old ? old.slug : '';
    const nextSlug = targetSlugFor(oldSlug, row);
    const next = bySlug(nextSlug);
    if (!next) return;
    const patch = {};
    if (row.categoryId !== next.id) patch.categoryId = next.id;
    if (table === 'listings') {
      const sub = String(row.subcategory || '').trim();
      if (!sub && old && old.slug !== next.slug) patch.subcategory = old.name;
    }
    if (Object.keys(patch).length) db.update(table, row.id, patch);
  });
}

function migrateDealer(table) {
  (db.all(table) || []).forEach((row) => {
    if (!Array.isArray(row.categories)) return;
    const next = remapIdList(row.categories);
    const same = next.length === row.categories.length && next.every((id, i) => id === row.categories[i]);
    if (!same) db.update(table, row.id, { categories: next });
  });
}

function deactivateLegacy() {
  const keep = {};
  CATEGORIES.forEach((c) => { keep[c.slug] = true; });
  db.all('categories').forEach((c) => {
    if (keep[c.slug]) return;
    if (c.active === false) return;
    db.update('categories', c.id, { active: false });
  });
}

function ensureCategories() {
  ensureCanonicalRows();
  migrateTable('listings');
  migrateTable('auctions');
  migrateTable('opportunities');
  migrateTable('alerts');
  migrateDealer('dealerProfiles');
  migrateDealer('dealerApplications');
  deactivateLegacy();
  return activeCategories();
}

module.exports = {
  CATEGORIES,
  SLUG_ALIAS,
  canonicalSlug,
  resolveCategory,
  activeCategories,
  ensureCategories,
  targetSlugFor,
  looksLikeBike,
};
