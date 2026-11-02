# Fase 2B Mercado Livre Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar um anúncio MLB como produto oficial em rascunho e sincronizar ficha + oferta ML, sem publicar no Mercado Livre e sem tocar no preço comercial Catira.

**Architecture:** Módulo `backend/src/meli.js` faz OAuth, GET e mapeamento. `official.js` passa a aceitar rascunho sem preço comercial, grava `meliItemId` e aplica overwrite da ficha no sync. Admin ganha rotas de connect/import/sync; um `setInterval` de 15 min percorre produtos com `meliItemId`. UI só em `AdminOfficial.jsx`. Cliente HTTP injetável; testes com fixtures, zero rede.

**Tech Stack:** Node CommonJS, Express, `db.json`, React/Vite. Testes `node src/*.test.js` (assert). `https` nativo, sem dependência nova.

## Global Constraints

- Somente GET + OAuth no ML. Nenhum POST/PUT em `/items`.
- Env do projeto: `USER_MELI_CLIENT_ID`, `USER_MELI_CLIENT_SECRET`, `USER_MELI_REDIRECT_URI`. Nunca vars do Agent, nunca logar secret/token, nunca devolver token na API.
- Scopes: `read` + `offline_access`. Sem `write`.
- Import = rascunho: `published:false`, sem `manualPrice`/`costPrice`. Fora da Home/Busca até o admin precificar e publicar.
- Sync sempre reescreve título, descrição, fotos e condição + oferta ML. Nunca `manualPrice`, `costPrice`, margem, cobertura, `published`, categoria.
- Categoria Catira só no import (mapa `domain_id`); fallback `servicos`.
- Mesmo `MLB…` reaproveita o produto (`meliItemId`). Uma oferta `mercadolivre` por produto.
- Fotos: até 8 `secure_url` https; hotlink, sem `/uploads`.
- Preço da oferta: `sale_price.amount` / `regular_amount`. Estoque só com token do dono.
- Poll 15 min, serial, backoff em 429. Sem webhook.
- Callback OAuth: o redirect do ML cai no frontend (`USER_MELI_REDIRECT_URI`); o admin logado faz `POST /api/admin/official/meli/callback` com `{ code, state }` (Bearer JWT). GET `/api/admin/*` exigiria JWT que o ML não envia.
- Não commitar `backend/data/`, `.github-token`, secrets. Commit só se o usuário pedir; passos de commit abaixo são opcionais.

---

### Task 1: Parse e mapeamento ML (sem HTTP)

**Files:**
- Create: `backend/src/meli.js`
- Create: `backend/src/meli.test.js`
- Modify: `backend/package.json` (script `test` inclui `node src/meli.test.js`)

**Interfaces:**
- Consumes: nada do `official` ainda
- Produces:
  - `parseItemId(raw: string) -> string` (canônico `MLB` + dígitos, sem hífen)
  - `mapCondition(item) -> 'novo'|'usado'|'seminovo'`
  - `mapCategorySlug(item) -> string` (slug Catira)
  - `mapImages(item) -> [{ url, order }]` (máx. 8 https)
  - `mapOfferStatus(item) -> 'active'|'suspended'`
  - `mapSalePrice(sale) -> { price: number, previousPrice: number|null }`
  - `mapFicha(item, descriptionPlain) -> { title, description, condition, images, meliItemId, permalink, sellerId }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/meli.test.js`:

```js
const assert = require('assert');
const meli = require('./meli');

const ITEM = {
  id: 'MLB1828680414',
  title: 'Controle Xbox Series S Lacrado',
  seller_id: 35204426,
  domain_id: 'MLB-GAMEPADS_AND_JOYSTICKS',
  condition: 'new',
  status: 'active',
  permalink: 'https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-series-s-lacrado-_JM',
  pictures: [
    { secure_url: 'https://http2.mlstatic.com/D_938331-MLA45268824993_032021-O.jpg' },
    { url: 'http://http2.mlstatic.com/D_643476-MLA45268824996_032021-O.jpg' },
  ],
  attributes: [{ id: 'ITEM_CONDITION', value_name: 'Novo' }],
};

function run() {
  assert.strictEqual(meli.parseItemId('MLB1828680414'), 'MLB1828680414');
  assert.strictEqual(meli.parseItemId('MLB-1828680414'), 'MLB1828680414');
  assert.strictEqual(
    meli.parseItemId('https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-_JM'),
    'MLB1828680414'
  );
  assert.strictEqual(
    meli.parseItemId('https://www.mercadolivre.com.br/controle/p/MLB1828680414'),
    'MLB1828680414'
  );
  let threw = false;
  try { meli.parseItemId('javascript:alert(1)'); } catch (e) { threw = e.status === 400; }
  assert.ok(threw, 'URL insegura');
  threw = false;
  try { meli.parseItemId('https://shopee.com.br/p/1'); } catch (e) { threw = e.status === 400; }
  assert.ok(threw, 'não é MLB');

  assert.strictEqual(meli.mapCondition(ITEM), 'novo');
  assert.strictEqual(meli.mapCondition({ condition: 'used' }), 'usado');
  assert.strictEqual(meli.mapCondition({ attributes: [{ id: 'ITEM_CONDITION', value_name: 'Recondicionado' }] }), 'seminovo');

  assert.strictEqual(meli.mapCategorySlug(ITEM), 'tecnologia');
  assert.strictEqual(meli.mapCategorySlug({ domain_id: 'MLB-CARS_AND_VANS' }), 'veiculos');
  assert.strictEqual(meli.mapCategorySlug({ domain_id: 'MLB-UNKNOWN_WIDGETS' }), 'servicos');

  const imgs = meli.mapImages(ITEM);
  assert.strictEqual(imgs.length, 2);
  assert.ok(imgs[0].url.startsWith('https://'));
  assert.ok(imgs[1].url.startsWith('https://'));

  assert.strictEqual(meli.mapOfferStatus({ status: 'active' }), 'active');
  assert.strictEqual(meli.mapOfferStatus({ status: 'paused' }), 'suspended');
  assert.strictEqual(meli.mapOfferStatus({ status: 'closed' }), 'suspended');

  assert.deepStrictEqual(
    meli.mapSalePrice({ amount: 39200, regular_amount: 49000 }),
    { price: 39200, previousPrice: 49000 }
  );
  assert.deepStrictEqual(
    meli.mapSalePrice({ amount: 10, regular_amount: null }),
    { price: 10, previousPrice: null }
  );

  const ficha = meli.mapFicha(ITEM, 'Texto da descrição ML\nlinha 2');
  assert.strictEqual(ficha.meliItemId, 'MLB1828680414');
  assert.strictEqual(ficha.title, ITEM.title);
  assert.ok(ficha.description.includes('Texto da descrição'));
  assert.strictEqual(ficha.sellerId, 35204426);
  assert.strictEqual(ficha.permalink, ITEM.permalink);

  console.log('OK meli tests');
}

run();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node backend/src/meli.test.js`

Expected: `Cannot find module './meli'`

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/meli.js`:

```js
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseItemId(raw) {
  const text = String(raw || '').trim();
  if (!text) throw httpError(400, 'Informe a URL ou o código MLB.');
  const lower = text.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    throw httpError(400, 'Link inválido.');
  }
  if (/^https?:\/\//i.test(text)) {
    let parsed;
    try { parsed = new URL(text); } catch { throw httpError(400, 'Informe um link http(s) válido.'); }
    if (parsed.username || parsed.password) throw httpError(400, 'Link inválido.');
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host.endsWith('mercadolivre.com.br') && !host.endsWith('mercadolibre.com')) {
      throw httpError(400, 'Use um link do Mercado Livre.');
    }
  }
  const compact = text.toUpperCase().replace(/-/g, '');
  const match = compact.match(/MLB(\d{6,15})/);
  if (!match) throw httpError(400, 'Não encontrei o código MLB.');
  return 'MLB' + match[1];
}

function attrName(item, id) {
  const rows = (item && item.attributes) || [];
  const row = rows.find((a) => a && a.id === id);
  return String((row && (row.value_name || row.valueName)) || '').toLowerCase();
}

function mapCondition(item) {
  const named = attrName(item, 'ITEM_CONDITION');
  const raw = named || String((item && item.condition) || '').toLowerCase();
  if (raw === 'new' || raw === 'novo') return 'novo';
  if (raw === 'used' || raw === 'usado') return 'usado';
  return 'seminovo';
}

const DOMAIN_SLUG = [
  [/cars|motos|bikes|vehicles|vehic/i, 'veiculos'],
  [/cell|phone|comput|game|electr|tablet|audio|camera/i, 'tecnologia'],
  [/home|furnit|applianc|house|kitchen/i, 'casa-moveis'],
  [/apparel|fashion|cloth|shoes|beauty/i, 'moda'],
  [/tool|ferrament/i, 'ferramentas'],
  [/agro|farm|rural/i, 'agro'],
  [/pet|animal/i, 'animais'],
  [/sport|book|toy|baby|leisure/i, 'lazer'],
  [/real_estate|propert/i, 'imoveis'],
];

function mapCategorySlug(item) {
  const domain = String((item && item.domain_id) || '');
  const hit = DOMAIN_SLUG.find((row) => row[0].test(domain));
  return hit ? hit[1] : 'servicos';
}

function mapImages(item) {
  const rows = Array.isArray(item && item.pictures) ? item.pictures : [];
  const out = [];
  rows.forEach((pic) => {
    if (out.length >= 8) return;
    let url = String((pic && (pic.secure_url || pic.url)) || '').trim();
    if (!url) return;
    if (url.startsWith('http://')) url = 'https://' + url.slice(7);
    if (!/^https:\/\//i.test(url)) return;
    out.push({ url: url.slice(0, 1000), order: out.length });
  });
  return out;
}

function mapOfferStatus(item) {
  const status = String((item && item.status) || '').toLowerCase();
  return status === 'active' ? 'active' : 'suspended';
}

function money2(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

function mapSalePrice(sale) {
  const price = money2(sale && sale.amount);
  const prev = sale && sale.regular_amount != null ? money2(sale.regular_amount) : null;
  return { price, previousPrice: prev && prev !== price ? prev : (prev || null) };
}

function mapFicha(item, descriptionPlain) {
  const title = String((item && item.title) || '').trim().slice(0, 140);
  if (!title) throw httpError(400, 'Anúncio sem título.');
  return {
    meliItemId: parseItemId(item.id),
    title,
    description: String(descriptionPlain || '').trim().slice(0, 4000),
    condition: mapCondition(item),
    images: mapImages(item),
    permalink: String((item && item.permalink) || '').trim(),
    sellerId: item && item.seller_id ? Number(item.seller_id) : null,
  };
}

module.exports = {
  parseItemId,
  mapCondition,
  mapCategorySlug,
  mapImages,
  mapOfferStatus,
  mapSalePrice,
  mapFicha,
};
```

In `backend/package.json`, change the `test` script to append `&& node src/meli.test.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node backend/src/meli.test.js`

Expected: `OK meli tests`

- [ ] **Step 5: Commit (optional)**

```bash
git add backend/src/meli.js backend/src/meli.test.js backend/package.json
git commit -m "feat: map Mercado Livre item ids and ficha fields"
```

---

### Task 2: Rascunho oficial + import a partir do mapeamento

**Files:**
- Modify: `backend/src/db.js` (`meliAuth: []`, `meliOauthStates: []`)
- Modify: `backend/src/official.js` (`createProduct` rascunho, `meliItemId`, `importMappedMeli`, `syncMappedMeli`)
- Modify: `backend/src/official.test.js`
- Modify: `backend/src/meli.test.js` (casos de import/sync via official)

**Interfaces:**
- Consumes: `meli.mapFicha`, `meli.mapSalePrice`, `meli.mapOfferStatus`, `meli.mapCategorySlug`
- Produces:
  - `createProduct(body, actor, { draft?: boolean })`
  - `importMappedMeli({ item, descriptionPlain, sale, actor }) -> { product, offer, listing, created: boolean }`
  - `syncMappedMeli(productId, { item, descriptionPlain, sale, actor }) -> { product, offer }`
  - Product field `meliItemId: string|null`
  - Offer fields `externalId`, `meliUserId`

- [ ] **Step 1: Write the failing test**

Append to `backend/src/official.test.js` inside `run()`, before `cleanup`, using the same `ids` bag:

```js
    const meli = require('./meli');
    const mappedItem = {
      id: 'MLB1828680414',
      title: 'Controle Xbox Series S Lacrado',
      seller_id: 35204426,
      domain_id: 'MLB-GAMEPADS_AND_JOYSTICKS',
      condition: 'new',
      status: 'active',
      permalink: 'https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-series-s-lacrado-_JM',
      pictures: [{ secure_url: 'https://http2.mlstatic.com/D_938331-MLA45268824993_032021-O.jpg' }],
    };
    const first = official.importMappedMeli({
      item: mappedItem,
      descriptionPlain: 'Descrição ML',
      sale: { amount: 599.9, regular_amount: 699.9 },
      actor: { id: 'admin-test' },
    });
    ids.products.push(first.product.id);
    ids.offers.push(first.offer.id);
    assert.strictEqual(first.created, true, 'cria na primeira vez');
    assert.strictEqual(first.product.published, false, 'rascunho');
    assert.strictEqual(first.product.manualPrice, null, 'sem preço comercial');
    assert.strictEqual(first.product.costPrice, 0, 'sem custo');
    assert.strictEqual(first.product.meliItemId, 'MLB1828680414');
    assert.strictEqual(first.listing.status, 'paused', 'listing pausado');
    assert.strictEqual(first.offer.provider, 'mercadolivre');
    assert.strictEqual(first.offer.source, 'process');
    assert.strictEqual(first.offer.externalId, 'MLB1828680414');
    assert.strictEqual(first.offer.price, 599.9);
    assert.strictEqual(first.offer.previousPrice, 699.9);

    const second = official.importMappedMeli({
      item: { ...mappedItem, title: 'Título novo ML' },
      descriptionPlain: 'Outra desc',
      sale: { amount: 580, regular_amount: 699.9 },
      actor: { id: 'admin-test' },
    });
    assert.strictEqual(second.created, false, 'não duplica');
    assert.strictEqual(second.product.id, first.product.id);
    assert.strictEqual(second.product.title, 'Título novo ML');
    assert.strictEqual(second.offer.price, 580);

    official.updateProduct(first.product.id, { manualPrice: 650, published: true });
    const priced = db.findById('officialProducts', first.product.id);
    assert.strictEqual(priced.manualPrice, 650);
    assert.strictEqual(priced.published, true);

    const synced = official.syncMappedMeli(first.product.id, {
      item: { ...mappedItem, title: 'Sync título', status: 'paused' },
      descriptionPlain: 'Sync desc',
      sale: { amount: 500, regular_amount: null },
      actor: { id: 'admin-test' },
    });
    assert.strictEqual(synced.product.title, 'Sync título');
    assert.strictEqual(synced.product.description, 'Sync desc');
    assert.strictEqual(synced.product.manualPrice, 650, 'sync não toca manualPrice');
    assert.strictEqual(synced.product.published, true, 'sync não toca published');
    assert.strictEqual(synced.offer.status, 'suspended');
    assert.strictEqual(synced.offer.price, 500);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node backend/src/official.test.js`

Expected: FAIL `importMappedMeli is not a function`

- [ ] **Step 3: Write minimal implementation**

In `backend/src/db.js` EMPTY, add:

```js
  meliAuth: [],
  meliOauthStates: [],
```

In `backend/src/official.js`:

Change `sanitizeProductInput` price check to:

```js
  if (base.id) {
    const price = computePrice(next);
    if (!price && next.published !== false) throw httpError(400, 'Defina um preço comercial ou custo e margem.');
  }
```

Change `createProduct` signature to `createProduct(body, actor, opts = {})` and replace the block that rejects empty price with:

```js
  const draft = !!opts.draft;
  const price = computePrice(product);
  if (!price && !draft) {
    db.remove('officialProducts', product.id);
    throw httpError(400, 'Defina um preço comercial ou custo e margem.');
  }
  const updated = db.update('officialProducts', product.id, {
    price,
    publishedAt: !draft && product.published ? now : null,
    published: draft ? false : product.published !== false,
    sellerId: seller.id,
    meliItemId: input.meliItemId || null,
  });
```

In `sanitizeProductInput`, allow `meliItemId`:

```js
  if (b.meliItemId !== undefined) {
    const id = String(b.meliItemId || '').trim().toUpperCase();
    out.meliItemId = id || null;
  }
```

In `createProduct` insert, add `meliItemId: input.meliItemId || null`.

In `serializeProduct`, add `meliItemId: product.meliItemId || null`.

In `serializeOffer`, add `externalId: publicView ? undefined : (offer.externalId || null)`.

Add at the bottom of `official.js` (before `module.exports`):

```js
function categoryIdForSlug(slug) {
  const row = db.findOne('categories', (c) => c.slug === slug && c.active !== false);
  const fallback = db.findOne('categories', (c) => c.slug === 'servicos' && c.active !== false);
  return (row || fallback || db.findOne('categories', () => true) || {}).id;
}

function applyMeliOffer(product, item, sale, actor) {
  const meli = require('./meli');
  const money = meli.mapSalePrice(sale || {});
  const status = meli.mapOfferStatus(item);
  return upsertOffer(product.id, {
    provider: 'mercadolivre',
    price: money.price,
    previousPrice: money.previousPrice,
    url: item.permalink,
    stock: Number.isFinite(Number(item.available_quantity)) ? Number(item.available_quantity) : 0,
    status,
    source: 'process',
    enabled: true,
    externalId: meli.parseItemId(item.id),
    meliUserId: item.seller_id || null,
  }, actor);
}

function importMappedMeli({ item, descriptionPlain, sale, actor }) {
  const meli = require('./meli');
  const ficha = meli.mapFicha(item, descriptionPlain);
  const existing = db.findOne('officialProducts', (p) => p.meliItemId === ficha.meliItemId);
  if (existing) {
    const synced = syncMappedMeli(existing.id, { item, descriptionPlain, sale, actor });
    return { ...synced, listing: db.findById('listings', synced.product.listingId), created: false };
  }
  const out = createProduct({
    title: ficha.title,
    description: ficha.description,
    categoryId: categoryIdForSlug(meli.mapCategorySlug(item)),
    condition: ficha.condition,
    images: ficha.images,
    published: false,
    meliItemId: ficha.meliItemId,
  }, actor, { draft: true });
  const offerOut = applyMeliOffer(out.product, item, sale, actor);
  return {
    product: productOf(out.product.id),
    offer: offerOut.offer,
    listing: out.listing,
    created: true,
  };
}

function syncMappedMeli(productId, { item, descriptionPlain, sale, actor }) {
  const product = productOf(productId);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  const meli = require('./meli');
  const ficha = meli.mapFicha(item, descriptionPlain);
  const updated = updateProduct(product.id, {
    title: ficha.title,
    description: ficha.description,
    condition: ficha.condition,
    images: ficha.images,
    meliItemId: ficha.meliItemId,
  });
  const offerOut = applyMeliOffer(updated.product, item, sale, actor);
  return { product: productOf(updated.product.id), offer: offerOut.offer };
}
```

In `sanitizeOfferInput`, persist `externalId` / `meliUserId`:

```js
  if (b.externalId !== undefined) out.externalId = String(b.externalId || '').trim() || null;
  if (b.meliUserId !== undefined) out.meliUserId = b.meliUserId || null;
```

In `upsertOffer` patch, keep those fields from `input`.

Export `importMappedMeli` and `syncMappedMeli`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node backend/src/official.test.js`

Expected: `OK official tests`

- [ ] **Step 5: Commit (optional)**

```bash
git add backend/src/db.js backend/src/official.js backend/src/official.test.js
git commit -m "feat: import Mercado Livre ficha as official draft"
```

---

### Task 3: OAuth, tokens e HTTP injetável

**Files:**
- Modify: `backend/src/meli.js`
- Modify: `backend/src/meli.test.js`

**Interfaces:**
- Consumes: `db`, `crypto`
- Produces:
  - `configured() -> boolean`
  - `envConfig() -> { clientId, clientSecret, redirectUri }`
  - `setHttp(fn)` where `fn({ method, url, headers, body }) -> Promise({ status, json })`
  - `createAuthUrl(adminId) -> { url, state }`
  - `completeAuth(adminId, code, state) -> { meliUserId }`
  - `disconnect() -> { ok: true }`
  - `authStatus() -> { configured, connected, meliUserId, expiresAt, tokenExpired }`
  - `getAccessToken() -> string`
  - `meliGet(path) -> json`

Env names (only existence/read in code, never printed): `USER_MELI_CLIENT_ID`, `USER_MELI_CLIENT_SECRET`, `USER_MELI_REDIRECT_URI`.

- [ ] **Step 1: Write the failing test**

Append to `meli.test.js` `run()`:

```js
  const db = require('./db');
  db.all('meliAuth').slice().forEach((r) => db.remove('meliAuth', r.id));
  db.all('meliOauthStates').slice().forEach((r) => db.remove('meliOauthStates', r.id));

  const prev = {
    id: process.env.USER_MELI_CLIENT_ID,
    secret: process.env.USER_MELI_CLIENT_SECRET,
    redir: process.env.USER_MELI_REDIRECT_URI,
  };
  delete process.env.USER_MELI_CLIENT_ID;
  delete process.env.USER_MELI_CLIENT_SECRET;
  delete process.env.USER_MELI_REDIRECT_URI;
  assert.strictEqual(meli.configured(), false);

  process.env.USER_MELI_CLIENT_ID = 'app-id';
  process.env.USER_MELI_CLIENT_SECRET = 'app-secret';
  process.env.USER_MELI_REDIRECT_URI = 'https://example.monkeycode-ai.live/admin';
  assert.strictEqual(meli.configured(), true);

  const auth = meli.createAuthUrl('admin-1');
  assert.ok(auth.url.includes('https://auth.mercadolivre.com.br/authorization'));
  assert.ok(auth.url.includes('client_id=app-id'));
  assert.ok(auth.url.includes('offline_access'));
  assert.ok(auth.state);

  const calls = [];
  meli.setHttp(async (req) => {
    calls.push(req);
    if (String(req.url).includes('/oauth/token')) {
      return {
        status: 200,
        json: {
          access_token: 'APP_USR-aaa',
          token_type: 'bearer',
          expires_in: 21600,
          scope: 'offline_access read',
          user_id: 35204426,
          refresh_token: 'TG-refresh-1',
        },
      };
    }
    return { status: 200, json: {} };
  });
  const done = await meli.completeAuth('admin-1', 'CODE123', auth.state);
  assert.strictEqual(done.meliUserId, 35204426);
  const st = meli.authStatus();
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.meliUserId, 35204426);
  assert.ok(!JSON.stringify(st).includes('APP_USR'));
  assert.ok(calls[0].body.includes('grant_type=authorization_code'));

  meli.setHttp(async (req) => {
    if (String(req.body || '').includes('grant_type=refresh_token')) {
      return {
        status: 200,
        json: {
          access_token: 'APP_USR-bbb',
          expires_in: 21600,
          user_id: 35204426,
          refresh_token: 'TG-refresh-2',
          scope: 'offline_access read',
        },
      };
    }
    return { status: 200, json: { id: 'MLB1' } };
  });
  const row = db.all('meliAuth')[0];
  db.update('meliAuth', row.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const token = await meli.getAccessToken();
  assert.strictEqual(token, 'APP_USR-bbb');
  assert.strictEqual(db.all('meliAuth')[0].refreshToken, 'TG-refresh-2');

  await meli.disconnect();
  assert.strictEqual(meli.authStatus().connected, false);

  if (prev.id == null) delete process.env.USER_MELI_CLIENT_ID; else process.env.USER_MELI_CLIENT_ID = prev.id;
  if (prev.secret == null) delete process.env.USER_MELI_CLIENT_SECRET; else process.env.USER_MELI_CLIENT_SECRET = prev.secret;
  if (prev.redir == null) delete process.env.USER_MELI_REDIRECT_URI; else process.env.USER_MELI_REDIRECT_URI = prev.redir;
```

Change `function run()` to `async function run()` and `run()` to `run().catch((e) => { console.error(e); process.exit(1); })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node backend/src/meli.test.js`

Expected: FAIL `configured is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/src/meli.js`:

```js
const { randomBytes } = require('crypto');
const https = require('https');
const http = require('http');
const db = require('./db');

let httpImpl = null;
function setHttp(fn) { httpImpl = fn; }

function envConfig() {
  const clientId = String(process.env.USER_MELI_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.USER_MELI_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.USER_MELI_REDIRECT_URI || '').trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function configured() {
  return !!envConfig();
}

function requestJson(opts) {
  if (httpImpl) return httpImpl(opts);
  return new Promise((resolve, reject) => {
    const u = new URL(opts.url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw }; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function createAuthUrl(adminId) {
  const env = envConfig();
  if (!env) throw httpError(503, 'Mercado Livre não configurado.');
  const state = randomBytes(16).toString('hex');
  db.insert('meliOauthStates', {
    state,
    adminId: adminId || null,
    createdAt: new Date().toISOString(),
  });
  const url = 'https://auth.mercadolivre.com.br/authorization'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(env.clientId)
    + '&redirect_uri=' + encodeURIComponent(env.redirectUri)
    + '&state=' + encodeURIComponent(state);
  return { url, state };
}

function formBody(obj) {
  return Object.keys(obj).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
}

async function completeAuth(adminId, code, state) {
  const env = envConfig();
  if (!env) throw httpError(503, 'Mercado Livre não configurado.');
  const row = db.findOne('meliOauthStates', (s) => s.state === String(state || ''));
  if (!row) throw httpError(400, 'Estado OAuth inválido.');
  const age = Date.now() - new Date(row.createdAt).getTime();
  db.remove('meliOauthStates', row.id);
  if (!Number.isFinite(age) || age > 10 * 60 * 1000) throw httpError(400, 'Estado OAuth expirado.');
  if (row.adminId && adminId && row.adminId !== adminId) throw httpError(400, 'Estado OAuth inválido.');
  const res = await requestJson({
    method: 'POST',
    url: 'https://api.mercadolibre.com/oauth/token',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      grant_type: 'authorization_code',
      client_id: env.clientId,
      client_secret: env.clientSecret,
      code: String(code || ''),
      redirect_uri: env.redirectUri,
    }),
  });
  if (res.status >= 400) {
    const errName = res.json && res.json.error;
    if (errName === 'invalid_grant') throw httpError(400, 'Use a conta administrador do Mercado Livre.');
    throw httpError(400, 'Não foi possível conectar o Mercado Livre.');
  }
  persistTokens(res.json);
  return { meliUserId: Number(res.json.user_id) };
}

let refreshLock = Promise.resolve();

function persistTokens(json) {
  const now = Date.now();
  const expiresAt = new Date(now + (Number(json.expires_in) || 21600) * 1000).toISOString();
  const patch = {
    meliUserId: Number(json.user_id),
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt,
    scope: json.scope || '',
    updatedAt: new Date(now).toISOString(),
  };
  const existing = db.all('meliAuth')[0];
  if (existing) db.update('meliAuth', existing.id, patch);
  else db.insert('meliAuth', patch);
}

function authStatus() {
  const env = configured();
  const row = db.all('meliAuth')[0] || null;
  const expired = !!(row && new Date(row.expiresAt).getTime() <= Date.now());
  return {
    configured: env,
    connected: !!(row && row.refreshToken),
    meliUserId: row ? row.meliUserId : null,
    expiresAt: row ? row.expiresAt : null,
    tokenExpired: expired,
  };
}

async function disconnect() {
  db.all('meliAuth').forEach((r) => db.remove('meliAuth', r.id));
  db.all('meliOauthStates').forEach((r) => db.remove('meliOauthStates', r.id));
  return { ok: true };
}

async function getAccessToken() {
  const env = envConfig();
  if (!env) throw httpError(503, 'Mercado Livre não configurado.');
  const row = db.all('meliAuth')[0];
  if (!row) throw httpError(400, 'Conecte a conta do Mercado Livre.');
  if (new Date(row.expiresAt).getTime() - 60000 > Date.now() && row.accessToken) return row.accessToken;
  const run = refreshLock.then(async () => {
    const current = db.all('meliAuth')[0];
    if (!current) throw httpError(400, 'Conecte a conta do Mercado Livre.');
    if (new Date(current.expiresAt).getTime() - 60000 > Date.now() && current.accessToken) return current.accessToken;
    const res = await requestJson({
      method: 'POST',
      url: 'https://api.mercadolibre.com/oauth/token',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        grant_type: 'refresh_token',
        client_id: env.clientId,
        client_secret: env.clientSecret,
        refresh_token: current.refreshToken,
      }),
    });
    if (res.status >= 400) throw httpError(400, 'Conecte de novo a conta do Mercado Livre.');
    persistTokens({ ...res.json, user_id: res.json.user_id || current.meliUserId });
    return res.json.access_token;
  });
  refreshLock = run.catch(() => {});
  return run;
}

async function meliGet(path) {
  const token = await getAccessToken();
  const res = await requestJson({
    method: 'GET',
    url: 'https://api.mercadolibre.com' + path,
    headers: { Authorization: 'Bearer ' + token, accept: 'application/json' },
  });
  if (res.status === 429) {
    const err = httpError(429, 'Mercado Livre pediu para aguardar.');
    err.retry = true;
    throw err;
  }
  if (res.status === 404) throw httpError(404, 'Anúncio não encontrado no Mercado Livre.');
  if (res.status >= 400) throw httpError(400, 'Falha ao consultar o Mercado Livre.');
  return res.json;
}

module.exports.parseItemId = parseItemId;
module.exports.mapCondition = mapCondition;
module.exports.mapCategorySlug = mapCategorySlug;
module.exports.mapImages = mapImages;
module.exports.mapOfferStatus = mapOfferStatus;
module.exports.mapSalePrice = mapSalePrice;
module.exports.mapFicha = mapFicha;
module.exports.setHttp = setHttp;
module.exports.configured = configured;
module.exports.envConfig = envConfig;
module.exports.createAuthUrl = createAuthUrl;
module.exports.completeAuth = completeAuth;
module.exports.disconnect = disconnect;
module.exports.authStatus = authStatus;
module.exports.getAccessToken = getAccessToken;
module.exports.meliGet = meliGet;
```

Keep a single `module.exports = { ... }` object at the end instead of reassigning keys if that is cleaner; do not duplicate exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `node backend/src/meli.test.js`

Expected: `OK meli tests`

- [ ] **Step 5: Commit (optional)**

```bash
git add backend/src/meli.js backend/src/meli.test.js
git commit -m "feat: Mercado Livre OAuth with injectable HTTP"
```

---

### Task 4: Fetch item, import/sync real, rotas admin

**Files:**
- Modify: `backend/src/meli.js` (`fetchItemBundle`, `importFromUrl`, `syncProduct`)
- Modify: `backend/src/meli.test.js`
- Modify: `backend/src/routes/admin.js`
- Modify: `backend/src/official.js` (`logOfficial` already exists)

**Interfaces:**
- Consumes: `meliGet`, `official.importMappedMeli`, `official.syncMappedMeli`
- Produces:
  - `fetchItemBundle(itemId) -> { item, descriptionPlain, sale }`
  - `importFromUrl(url, actor) -> official.importMappedMeli result`
  - `syncProduct(productId, actor) -> official.syncMappedMeli result`
  - Routes:
    - `GET /api/admin/official/meli/status`
    - `GET /api/admin/official/meli/connect`
    - `POST /api/admin/official/meli/callback` `{ code, state }`
    - `POST /api/admin/official/meli/disconnect`
    - `POST /api/admin/official/meli/import` `{ url }`
    - `POST /api/admin/official/products/:id/meli/sync`

Seller guard: `item.seller_id` must equal `meliAuth.meliUserId`.

- [ ] **Step 1: Write the failing test**

Append to `meli.test.js` (with env + `setHttp` still in place in that block, reconnect first):

```js
  process.env.USER_MELI_CLIENT_ID = 'app-id';
  process.env.USER_MELI_CLIENT_SECRET = 'app-secret';
  process.env.USER_MELI_REDIRECT_URI = 'https://example.monkeycode-ai.live/admin';
  meli.setHttp(async (req) => {
    if (String(req.url).includes('/oauth/token')) {
      return {
        status: 200,
        json: {
          access_token: 'APP_USR-aaa',
          expires_in: 21600,
          user_id: 35204426,
          refresh_token: 'TG-refresh-1',
          scope: 'offline_access read',
        },
      };
    }
    if (String(req.url).includes('/sale_price')) {
      return { status: 200, json: { amount: 599.9, regular_amount: 699.9 } };
    }
    if (String(req.url).includes('/description')) {
      return { status: 200, json: { plain_text: 'Descrição ML' } };
    }
    if (String(req.url).includes('/items/MLB1828680414')) {
      return { status: 200, json: ITEM };
    }
    return { status: 404, json: {} };
  });
  const auth2 = meli.createAuthUrl('admin-1');
  await meli.completeAuth('admin-1', 'CODE', auth2.state);
  const imported = await meli.importFromUrl(ITEM.permalink, { id: 'admin-1' });
  assert.strictEqual(imported.created, true);
  assert.strictEqual(imported.product.meliItemId, 'MLB1828680414');
  const again = await meli.importFromUrl('MLB1828680414', { id: 'admin-1' });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.product.id, imported.product.id);
```

Also add a case where `seller_id` differs → status 400.

- [ ] **Step 2: Run test to verify it fails**

Run: `node backend/src/meli.test.js`

Expected: FAIL `importFromUrl is not a function`

- [ ] **Step 3: Write minimal implementation**

In `meli.js`:

```js
async function fetchItemBundle(itemId) {
  const id = parseItemId(itemId);
  const item = await meliGet('/items/' + id);
  let descriptionPlain = '';
  try {
    const desc = await meliGet('/items/' + id + '/description');
    descriptionPlain = desc && desc.plain_text ? desc.plain_text : '';
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  let sale = { amount: 0, regular_amount: null };
  try {
    sale = await meliGet('/items/' + id + '/sale_price?context=channel_marketplace');
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const auth = db.all('meliAuth')[0];
  if (auth && item.seller_id && Number(item.seller_id) !== Number(auth.meliUserId)) {
    throw httpError(400, 'Este anúncio não é da conta conectada.');
  }
  if (auth && Number.isFinite(Number(item.available_quantity))) {
    /* owner token: keep stock */
  } else {
    delete item.available_quantity;
  }
  return { item, descriptionPlain, sale };
}

async function importFromUrl(url, actor) {
  const id = parseItemId(url);
  const bundle = await fetchItemBundle(id);
  const official = require('./official');
  const out = official.importMappedMeli({ ...bundle, actor });
  official.logOfficial && null;
  require('./official');
  const { log } = { log: null };
  try {
    const officialMod = require('./official');
    if (typeof officialMod === 'object') {
      /* log via db to avoid circular export issues */
    }
  } catch {}
  db.insert('officialAdminLogs', {
    actorId: actor && actor.id ? actor.id : null,
    action: out.created ? 'meli_imported' : 'meli_synced',
    payload: { productId: out.product.id, meliItemId: id },
    createdAt: new Date().toISOString(),
  });
  return out;
}

async function syncProduct(productId, actor) {
  const official = require('./official');
  const product = official.productOf(productId);
  if (!product || !product.meliItemId) throw httpError(404, 'Produto sem vínculo Mercado Livre.');
  const bundle = await fetchItemBundle(product.meliItemId);
  const out = official.syncMappedMeli(product.id, { ...bundle, actor });
  db.insert('officialAdminLogs', {
    actorId: actor && actor.id ? actor.id : null,
    action: 'meli_synced',
    payload: { productId: product.id, meliItemId: product.meliItemId },
    createdAt: new Date().toISOString(),
  });
  return out;
}
```

Do **not** leave the empty try/catch stub in the final code: call `db.insert('officialAdminLogs', …)` only, as above. Export `fetchItemBundle`, `importFromUrl`, `syncProduct`.

In `backend/src/routes/admin.js`, after `officialHandler`, add:

```js
function officialAsync(fn) {
  return (req, res) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((result) => {
        res.status(result && result.status ? result.status : 200).json(result && result.body ? result.body : result);
      })
      .catch((e) => {
        res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
      });
  };
}

router.get('/official/meli/status', officialHandler(() => require('../meli').authStatus()));

router.get('/official/meli/connect', officialHandler((req) => {
  const meli = require('../meli');
  const out = meli.createAuthUrl(req.user.id);
  return { url: out.url };
}));

router.post('/official/meli/callback', officialAsync(async (req) => {
  const meli = require('../meli');
  const body = req.body || {};
  await meli.completeAuth(req.user.id, body.code, body.state);
  db.insert('officialAdminLogs', {
    actorId: req.user.id,
    action: 'meli_connected',
    payload: {},
    createdAt: new Date().toISOString(),
  });
  return meli.authStatus();
}));

router.post('/official/meli/disconnect', officialAsync(async (req) => {
  const meli = require('../meli');
  await meli.disconnect();
  db.insert('officialAdminLogs', {
    actorId: req.user.id,
    action: 'meli_disconnected',
    payload: {},
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}));

router.post('/official/meli/import', officialAsync(async (req) => {
  const meli = require('../meli');
  const official = require('../official');
  const out = await meli.importFromUrl((req.body && req.body.url) || '', req.user);
  return {
    status: out.created ? 201 : 200,
    body: {
      product: official.serializeProduct(out.product),
      offer: official.serializeOffer(out.offer),
      listingId: out.listing ? out.listing.id : null,
      created: out.created,
    },
  };
}));

router.post('/official/products/:id/meli/sync', officialAsync(async (req) => {
  const meli = require('../meli');
  const official = require('../official');
  const out = await meli.syncProduct(req.params.id, req.user);
  return {
    product: official.serializeProduct(out.product),
    offer: official.serializeOffer(out.offer),
  };
}));
```

Place these **before** `router.get('/official/products/:id')` so `meli` is not captured as `:id`.

- [ ] **Step 4: Run tests**

Run: `node backend/src/meli.test.js && node backend/src/official.test.js`

Expected: both `OK`

- [ ] **Step 5: Commit (optional)**

```bash
git add backend/src/meli.js backend/src/meli.test.js backend/src/routes/admin.js
git commit -m "feat: admin routes to import and sync Mercado Livre items"
```

---

### Task 5: Poll 15 min + stale/429

**Files:**
- Modify: `backend/src/meli.js` (`runSyncTick`)
- Modify: `backend/src/server.js`
- Modify: `backend/src/meli.test.js`

**Interfaces:**
- Produces: `runSyncTick({ now, sleep }?) -> { ok: number, failed: number, delayed: boolean }`
- `server.js` `setInterval(() => { require('./meli').runSyncTick().catch(() => {}); }, 15 * 60 * 1000)` with `.unref()`

- [ ] **Step 1: Write the failing test**

```js
  let hits = 0;
  meli.setHttp(async (req) => {
    if (String(req.url).includes('/oauth/token')) {
      return { status: 200, json: { access_token: 'APP_USR-aaa', expires_in: 21600, user_id: 35204426, refresh_token: 'TG-refresh-1' } };
    }
    hits += 1;
    if (hits === 1) return { status: 429, json: {} };
    if (String(req.url).includes('/sale_price')) return { status: 200, json: { amount: 10, regular_amount: null } };
    if (String(req.url).includes('/description')) return { status: 200, json: { plain_text: 'x' } };
    return { status: 200, json: { ...ITEM, title: 'Depois do 429', seller_id: 35204426, status: 'active' } };
  });
  const waits = [];
  const tick = await meli.runSyncTick({
    sleep: (ms) => { waits.push(ms); return Promise.resolve(); },
  });
  assert.strictEqual(tick.delayed, true);
  assert.ok(waits[0] >= 500);
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL `runSyncTick is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runSyncTick(opts = {}) {
  const sleep = opts.sleep || sleepMs;
  const official = require('./official');
  const rows = db.findWhere('officialProducts', (p) => !!p.meliItemId);
  let ok = 0;
  let failed = 0;
  let delayed = false;
  for (const product of rows) {
    try {
      await syncProduct(product.id, null);
      ok += 1;
    } catch (e) {
      if (e.status === 429) {
        delayed = true;
        await sleep(500 + Math.floor(Math.random() * 500));
        failed += 1;
        continue;
      }
      failed += 1;
    }
  }
  return { ok, failed, delayed };
}
```

On 401 after failed refresh, `syncMappedMeli` is not called; existing offer stays until a later successful sync. Do **not** mark `stale` on 429.

In `server.js`, next to `lanceTick`:

```js
const meliTick = setInterval(() => {
  try { require('./meli').runSyncTick().catch(() => {}); } catch (e) { /* mantém o serviço de pé */ }
}, 15 * 60 * 1000);
if (meliTick.unref) meliTick.unref();
```

- [ ] **Step 4: Run tests**

Run: `node backend/src/meli.test.js`

Expected: `OK meli tests`

- [ ] **Step 5: Commit (optional)**

```bash
git add backend/src/meli.js backend/src/meli.test.js backend/src/server.js
git commit -m "feat: poll Mercado Livre ficha every 15 minutes"
```

---

### Task 6: UI Admin Oficial

**Files:**
- Modify: `frontend/src/pages/AdminOfficial.jsx`
- Modify: `frontend/src/pages/Admin.jsx` (se a tab lê `?tab=oficial`; garantir que `meli=ok` / `code` sobrevivam)
- Modify: `frontend/src/styles.css` (classes mínimas `.meli-box`, `.awaiting-price`)

**Interfaces:**
- Consumes the admin JSON above
- No tokens in UI state

- [ ] **Step 1: Write the failing UI wiring (manual + existing backend tests still pass)**

There is no frontend test runner. Backend tests remain the gate. Implement UI against the routes from Task 4.

- [ ] **Step 2: Confirm backend still passes**

Run: `cd backend && npm test`

Expected: all current suites + `OK meli tests`

- [ ] **Step 3: UI implementation**

In `AdminOfficial.jsx`:

1. State: `meli`, `meliUrl`, `meliBusy`.
2. `load()` also `GET /api/admin/official/meli/status`.
3. `useEffect` on mount: if `URLSearchParams` has `code` and `state`, `POST /api/admin/official/meli/callback`, then `history.replaceState` to strip query, then `load()`.
4. Card above “Novo produto oficial”:

```jsx
<div className="meli-box">
  <strong>Mercado Livre</strong>
  {!meli || !meli.configured ? (
    <p className="hint">Mercado Livre não configurado. Defina USER_MELI_CLIENT_ID, USER_MELI_CLIENT_SECRET e USER_MELI_REDIRECT_URI.</p>
  ) : (
    <>
      <p className="hint">
        {meli.connected ? ('Conta ' + meli.meliUserId + (meli.tokenExpired ? ' · token vencido' : ' · conectada')) : 'Desconectado'}
      </p>
      {meli.connected
        ? <button type="button" className="chip" onClick={disconnectMeli}>Desconectar</button>
        : <button type="button" className="chip" onClick={connectMeli}>Conectar</button>}
      <form onSubmit={importMeli}>
        <input value={meliUrl} onChange={(e) => setMeliUrl(e.target.value)} placeholder="URL ou código MLB…" />
        <button type="submit" className="btn btn-primary" disabled={meliBusy || !meli.connected}>Importar</button>
      </form>
    </>
  )}
</div>
```

`connectMeli`: `GET /api/admin/official/meli/connect` then `window.location.href = d.url`.

`importMeli`: `POST /api/admin/official/meli/import` `{ url: meliUrl }`, `openEdit` on `d.product`.

On product card, if `!p.manualPrice && !p.costPrice`, show `<em className="awaiting-price">Aguardando preço</em>`.

In the editor, if `form.id` and `editing.meliItemId`:

```jsx
<button type="button" className="chip" onClick={syncNow} disabled={busy}>Atualizar agora</button>
```

`syncNow`: `POST /api/admin/official/products/${editing.id}/meli/sync`, then `openEdit(d.product)`.

Offer row: if `o.source === 'process'`, hide the “editar” fields for URL/preço (keep suspender/reativar). Show `formatWhen(o.lastSyncAt)`.

`toggleOffer` for process offers: suspended ↔ **active** (not `manual`).

CSS:

```css
.meli-box { border: 1px solid #e5e7eb; padding: 12px; margin-bottom: 16px; border-radius: 12px; }
.awaiting-price { color: #b45309; font-size: 12px; }
```

- [ ] **Step 4: Run backend tests again**

Run: `cd backend && npm test`

Expected: all OK

- [ ] **Step 5: Commit (optional)**

```bash
git add frontend/src/pages/AdminOfficial.jsx frontend/src/styles.css
git commit -m "feat: admin UI to connect and import Mercado Livre listings"
```

---

## Self-review

**Spec coverage**
- OAuth read+offline, env USER_MELI_*, no token in JSON → Task 3–4
- Import rascunho sem preço comercial → Task 2
- Reimport mesmo MLB → Task 2 / 4
- Sync overwrite ficha + oferta, preserve manualPrice/published/categoria → Task 2
- sale_price + owner stock → Task 4
- seller_id guard → Task 4
- Poll 15 min, 429 no stale → Task 5
- UI connect/import/sync/aguardando preço → Task 6
- Fora de escopo (write ML, webhook, Shopee) → nenhum task

**Callback:** spec said GET `/api/admin/official/meli/callback`. Plan uses POST from the frontend after ML redirects to `USER_MELI_REDIRECT_URI` (the admin page), because `adminRequired` needs the Catira JWT. Same security, SPA-compatible.

**createProduct draft:** `published:false` skips the commercial price requirement; publishing still requires price (`sanitizeProductInput`).

**Placeholders:** none.

**Types:** `importMappedMeli` / `syncMappedMeli` / `importFromUrl` / `syncProduct` names match across tasks.
