const assert = require('assert');
const db = require('./db');
const {
  CATEGORIES,
  canonicalSlug,
  looksLikeBike,
  targetSlugFor,
  ensureCategories,
  resolveCategory,
  activeCategories,
} = require('./categories');

function run() {
  assert.strictEqual(CATEGORIES.length, 10);
  assert.strictEqual(canonicalSlug('carros-motos'), 'veiculos');
  assert.strictEqual(canonicalSlug('celulares'), 'tecnologia');
  assert.strictEqual(canonicalSlug('games'), 'tecnologia');
  assert.strictEqual(canonicalSlug('roupas'), 'moda');
  assert.strictEqual(canonicalSlug('rural'), 'agro');
  assert.strictEqual(canonicalSlug('infantil'), 'lazer');
  assert.strictEqual(canonicalSlug('livros'), 'lazer');
  assert.strictEqual(canonicalSlug('outros'), 'servicos');
  assert.strictEqual(canonicalSlug('imoveis'), 'imoveis');
  assert.ok(looksLikeBike({ title: 'Bicicleta aro 29', subcategory: 'Ciclismo' }));
  assert.strictEqual(targetSlugFor('esportes', { title: 'Bicicleta Caloi Aro 29' }), 'veiculos');
  assert.strictEqual(targetSlugFor('esportes', { title: 'Halter 10kg' }), 'lazer');

  const listingCount = db.count('listings');
  const auctionCount = db.count('auctions');
  ensureCategories();
  ensureCategories();

  assert.strictEqual(db.count('listings'), listingCount, 'nenhum anúncio apagado');
  assert.strictEqual(db.count('auctions'), auctionCount, 'nenhum leilão apagado');

  const active = activeCategories();
  assert.strictEqual(active.length, 10);
  assert.deepStrictEqual(active.map((c) => c.slug), CATEGORIES.map((c) => c.slug));

  db.all('listings').forEach((l) => {
    const cat = db.findById('categories', l.categoryId);
    assert.ok(cat, 'anúncio com categoria');
    assert.strictEqual(cat.active, true);
    assert.ok(CATEGORIES.some((c) => c.slug === cat.slug));
  });

  const bike = db.findOne('listings', (l) => /bicicleta/i.test(l.title || ''));
  if (bike) {
    const cat = db.findById('categories', bike.categoryId);
    assert.strictEqual(cat.slug, 'veiculos');
  }

  const iphone = db.findOne('listings', (l) => /iphone/i.test(l.title || ''));
  if (iphone) {
    const cat = db.findById('categories', iphone.categoryId);
    assert.strictEqual(cat.slug, 'tecnologia');
  }

  const old = resolveCategory('carros-motos');
  assert.ok(old);
  assert.strictEqual(old.slug, 'veiculos');
  const byNew = resolveCategory('tecnologia');
  assert.ok(byNew);
  assert.strictEqual(byNew.slug, 'tecnologia');

  console.log('OK categories tests');
}

run();
