# Mercado Livre third-party catalog import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar anúncio de terceiro via o mesmo botão Import, usando `/products/{id}` quando `GET /items/{id}` devolve 403, e gravar rascunho Catira + oferta ML.

**Architecture:** `parseImportRef` devolve `{ itemId, catalogId }`. `fetchItemBundle` tenta `/items`; 403 com catálogo cai em `fetchCatalogBundle` (`/products/{id}` + `/products/{id}/items` + description). O item de catálogo é normalizado para o mesmo shape de `mapFicha` / `applyMeliOffer`. `official.js` passa a persistir `meliCatalogId`. Sync usa catálogo se o campo existir.

**Tech Stack:** Node CommonJS, `backend/src/meli.js`, `backend/src/official.js`, testes `node src/meli.test.js` / `node src/official.test.js` (HTTP injetável, zero rede), UI em `AdminOfficial.jsx`.

## Global Constraints

- Somente GET + OAuth; sem POST/PUT em `/items`, sem scraping, sem `/sites/MLB/search`.
- Sem `MLBU` / `/up/`.
- Rascunho: `published=false`, sem `manualPrice`/`costPrice`.
- Sync nunca altera `manualPrice`, custo, margem, cobertura, `published`, categoria.
- Token/secret nunca logados nem devolvidos.
- Testes com `setHttp`; zero rede.
- Não commitar a menos que o usuário peça.
- Reiniciar `node src/server.js` depois de mudar o backend (não há nodemon).

---

### Task 1: parseImportRef

**Files:**
- Modify: `backend/src/meli.js` (`parseItemId`, novo `parseImportRef`, exports)
- Test: `backend/src/meli.test.js`

**Interfaces:**
- Consumes: URL/código MLB (já validado por host/javascript/data)
- Produces: `parseImportRef(raw) -> { itemId: string|null, catalogId: string|null }`; `parseItemId` continua devolvendo só o anúncio (`wid` ou MLB clássico)

- [ ] **Step 1: Write the failing test**

No início de `run()` em `backend/src/meli.test.js`, depois dos asserts atuais de `parseItemId` com `wid`, **trocar** o caso `/p/` sem `wid` (hoje espera throw) por:

```javascript
  const refWid = meli.parseImportRef('https://www.mercadolivre.com.br/kit/p/MLB60968045?wid=MLB5885455180');
  assert.deepStrictEqual(refWid, { itemId: 'MLB5885455180', catalogId: 'MLB60968045' });
  const refHash = meli.parseImportRef('https://www.mercadolivre.com.br/kit/p/MLB60968045#wid=MLB5885455180&sid=offers');
  assert.deepStrictEqual(refHash, { itemId: 'MLB5885455180', catalogId: 'MLB60968045' });
  const refPage = meli.parseImportRef('https://www.mercadolivre.com.br/controle/p/MLB60968045');
  assert.deepStrictEqual(refPage, { itemId: null, catalogId: 'MLB60968045' });
  const refClassic = meli.parseImportRef('https://produto.mercadolivre.com.br/MLB-1828680414-controle-xbox-_JM');
  assert.deepStrictEqual(refClassic, { itemId: 'MLB1828680414', catalogId: null });
```

Manter o throw de `parseItemId('…/p/MLB60968045')` **ou** alinhar: `parseItemId` em `/p/` sem `wid` deve continuar falhando (só anúncio). `parseImportRef` é quem aceita página de produto.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/meli.test.js`

Expected: FAIL `parseImportRef is not a function`

- [ ] **Step 3: Write minimal implementation**

Em `backend/src/meli.js`, ao lado de `parseItemId`:

```javascript
function parseCatalogId(raw, parsed) {
  const path = parsed && parsed.pathname ? parsed.pathname : String(raw || '');
  const m = path.toUpperCase().replace(/-/g, '').match(/\/P\/MLB(\d{6,15})/);
  return m ? 'MLB' + m[1] : null;
}

function parseImportRef(raw) {
  const text = String(raw || '').trim();
  if (!text) throw httpError(400, 'Informe a URL ou o código MLB.');
  const lower = text.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    throw httpError(400, 'Link inválido.');
  }
  let parsed;
  if (/^https?:\/\//i.test(text)) {
    try { parsed = new URL(text); } catch { throw httpError(400, 'Informe um link http(s) válido.'); }
    if (parsed.username || parsed.password) throw httpError(400, 'Link inválido.');
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host.endsWith('mercadolivre.com.br') && !host.endsWith('mercadolibre.com')) {
      throw httpError(400, 'Use um link do Mercado Livre.');
    }
  }
  const compact = text.toUpperCase().replace(/-/g, '');
  if (/\/UP\/MLBU\d+|MLBU\d{6,}/.test(compact)) {
    throw httpError(400, 'Essa URL é de catálogo, não de anúncio. Abra um anúncio de um vendedor e cole o link com código MLB (números depois de MLB).');
  }
  const catalogId = parseCatalogId(text, parsed);
  const wid = compact.match(/WID=MLB(\d{6,15})/);
  if (wid) return { itemId: 'MLB' + wid[1], catalogId };
  if (catalogId) return { itemId: null, catalogId };
  const match = compact.match(/MLB(\d{6,15})/);
  if (!match) throw httpError(400, 'Não encontrei o código MLB.');
  return { itemId: 'MLB' + match[1], catalogId: null };
}
```

Refatore `parseItemId` para:

```javascript
function parseItemId(raw) {
  const ref = parseImportRef(raw);
  if (ref.itemId) return ref.itemId;
  throw httpError(400, 'Essa URL é da página do produto, não de um anúncio. Abra o anúncio de um vendedor (link com MLB + números ou parâmetro wid).');
}
```

Exportar `parseImportRef` em `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/backend && node src/meli.test.js`

Expected: `OK meli tests`

- [ ] **Step 5: Do not commit** unless the user asked.

---

### Task 2: pick catalog item + normalize catalog product

**Files:**
- Modify: `backend/src/meli.js`
- Test: `backend/src/meli.test.js`

**Interfaces:**
- Consumes: JSON de `/products/{id}` e `/products/{id}/items`
- Produces:
  - `pickCatalogItem(results, preferredId) -> row`
  - `catalogPermalink(productPermalink, itemId) -> string`
  - `mapCatalogItem(product, chosen) -> item` (shape de `/items` o bastante para `mapFicha` / `applyMeliOffer`)
  - `mapCatalogSale(chosen) -> { amount, regular_amount }`

- [ ] **Step 1: Write the failing test**

```javascript
  const PRODUCT = {
    id: 'MLB60968045',
    name: 'Principia Kit Essencial',
    domain_id: 'MLB-SKINCARE_KITS',
    permalink: 'https://www.mercadolivre.com.br/principia-kit/p/MLB60968045',
    pictures: [{ url: 'http://http2.mlstatic.com/D_1.jpg' }],
  };
  const RESULTS = [
    { item_id: 'MLB111', seller_id: 9, price: 200, original_price: 250, condition: 'new' },
    { item_id: 'MLB5885455180', seller_id: 518092731, price: 137.15, original_price: 211, condition: 'new' },
  ];
  const pickedWid = meli.pickCatalogItem(RESULTS, 'MLB5885455180');
  assert.strictEqual(pickedWid.item_id, 'MLB5885455180');
  const cheapest = meli.pickCatalogItem(RESULTS, null);
  assert.strictEqual(cheapest.item_id, 'MLB5885455180');
  assert.strictEqual(
    meli.catalogPermalink(PRODUCT.permalink, 'MLB5885455180'),
    'https://www.mercadolivre.com.br/principia-kit/p/MLB60968045?wid=MLB5885455180'
  );
  const mapped = meli.mapCatalogItem(PRODUCT, pickedWid);
  assert.strictEqual(mapped.id, 'MLB5885455180');
  assert.strictEqual(mapped.title, PRODUCT.name);
  assert.strictEqual(mapped.seller_id, 518092731);
  assert.ok(mapped.permalink.includes('wid=MLB5885455180'));
  assert.ok(!Object.prototype.hasOwnProperty.call(mapped, 'available_quantity'));
  const fichaCat = meli.mapFicha(mapped, 'Texto desc');
  assert.strictEqual(fichaCat.title, PRODUCT.name);
  assert.ok(fichaCat.images[0].url.startsWith('https://'));
  assert.deepStrictEqual(meli.mapCatalogSale(pickedWid), { amount: 137.15, regular_amount: 211 });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/meli.test.js`

Expected: FAIL `pickCatalogItem is not a function`

- [ ] **Step 3: Write minimal implementation**

```javascript
function pickCatalogItem(results, preferredId) {
  const rows = Array.isArray(results) ? results.filter((r) => r && r.item_id) : [];
  if (!rows.length) throw httpError(400, 'Catálogo sem anúncios ativos.');
  const want = preferredId ? String(preferredId).toUpperCase() : '';
  const hit = want && rows.find((r) => String(r.item_id).toUpperCase() === want);
  if (hit) return hit;
  return rows.slice().sort((a, b) => Number(a.price) - Number(b.price))[0];
}

function catalogPermalink(productPermalink, itemId) {
  const base = String(productPermalink || '').trim().split('#')[0];
  if (!base) return '';
  const u = new URL(base);
  if (itemId) u.searchParams.set('wid', itemId);
  return u.toString();
}

function mapCatalogItem(product, chosen) {
  return {
    id: chosen.item_id,
    title: product.name,
    seller_id: chosen.seller_id,
    domain_id: product.domain_id,
    condition: chosen.condition,
    status: 'active',
    permalink: catalogPermalink(product.permalink, chosen.item_id),
    pictures: Array.isArray(product.pictures) ? product.pictures : [],
  };
}

function mapCatalogSale(chosen) {
  return {
    amount: chosen && chosen.price,
    regular_amount: chosen && chosen.original_price != null ? chosen.original_price : null,
  };
}
```

Exportar as quatro funções.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/backend && node src/meli.test.js`

Expected: `OK meli tests`

- [ ] **Step 5: Do not commit** unless asked.

---

### Task 3: fetchCatalogBundle + fallback 403

**Files:**
- Modify: `backend/src/meli.js` (`fetchItemBundle`, `importFromUrl`, `syncProduct`, novo `fetchCatalogBundle`)
- Test: `backend/src/meli.test.js`

**Interfaces:**
- Consumes: `meliGet`, `parseImportRef`, helpers da Task 2, `official.importMappedMeli` / `syncMappedMeli`
- Produces:
  - `fetchCatalogBundle(catalogId, preferredItemId) -> { item, descriptionPlain, sale, catalogId }`
  - `fetchItemBundle(itemId, catalogId) -> mesmo shape`; 403 + `catalogId` → catálogo; 403 sem catálogo → 400 pedindo `/p/`
  - `importFromUrl` usa `parseImportRef`; `/p/` sem `wid` vai direto ao catálogo
  - `syncProduct`: se `product.meliCatalogId`, catálogo (preferred = `meliItemId`); senão `/items`; 403 em `/items` sem catálogo → oferta `stale` via throw (poll já conta failed)

- [ ] **Step 1: Write the failing tests** (HTTP fake, zero rede)

Depois do bloco que já autentica e importa `ITEM`, adicionar:

```javascript
  meli.setHttp(async (req) => {
    const url = String(req.url);
    if (url.includes('/oauth/token')) {
      return { status: 200, json: { access_token: 'APP_USR-aaa', expires_in: 21600, user_id: 35204426, refresh_token: 'TG-refresh-1' } };
    }
    if (url.includes('/items/MLB5885455180/description')) {
      return { status: 200, json: { plain_text: 'Desc terceiro' } };
    }
    if (url.includes('/items/MLB5885455180')) {
      return { status: 403, json: { error: 'access_denied' } };
    }
    if (url.includes('/products/MLB60968045/items')) {
      return { status: 200, json: { results: RESULTS } };
    }
    if (url.includes('/products/MLB60968045')) {
      return { status: 200, json: PRODUCT };
    }
    return { status: 404, json: {} };
  });
  let needPage;
  try { await meli.importFromUrl('MLB5885455180', { id: 'admin-1' }); }
  catch (e) { needPage = e; }
  assert.strictEqual(needPage.status, 400);
  assert.ok(/\/p\//i.test(needPage.message), needPage.message);

  const third = await meli.importFromUrl(
    'https://www.mercadolivre.com.br/kit/p/MLB60968045#wid=MLB5885455180',
    { id: 'admin-1' }
  );
  assert.strictEqual(third.created, true);
  assert.strictEqual(third.product.meliItemId, 'MLB5885455180');
  assert.strictEqual(third.product.meliCatalogId, 'MLB60968045');
  assert.strictEqual(third.offer.price, 137.15);
  assert.ok(!third.offer.stock);
```

Ajustar o teste atual “403 vira 400 / conta conectada”: a mensagem nova é pedir `/p/`, não “conta conectada”.

Ajustar o teste “anúncio de outro vendedor” (`seller_id: 1` com `/items` 200): **passa a importar**, sem estoque.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/meli.test.js`

Expected: FAIL no assert de `meliCatalogId` ou na mensagem 403

- [ ] **Step 3: Write minimal implementation**

1. Remover o throw `seller_id !== meliUserId` em `fetchItemBundle`.
2. Em `fetchItemBundle`, se `GET /items/{id}` 403 e `catalogId`, `return fetchCatalogBundle(catalogId, id)`.
3. Se 403 sem `catalogId`, throw 400: `Essa URL é de anúncio de terceiro. Cole a página do produto (/p/MLB…).`
4. `sale_price` 403: tratar como 404 (sale vazio).
5. Sem `available_quantity` se `seller_id` ≠ conta (já delete se não for número; garantir delete quando vendedor ≠ grant).

```javascript
async function fetchCatalogBundle(catalogId, preferredItemId) {
  const product = await meliGet('/products/' + catalogId);
  const listed = await meliGet('/products/' + catalogId + '/items');
  const chosen = pickCatalogItem(listed && listed.results, preferredItemId);
  let descriptionPlain = '';
  try {
    const desc = await meliGet('/items/' + chosen.item_id + '/description');
    descriptionPlain = desc && desc.plain_text ? desc.plain_text : '';
  } catch (e) {
    if (e.status !== 404 && e.status !== 403) throw e;
  }
  return {
    item: mapCatalogItem(product, chosen),
    descriptionPlain,
    sale: mapCatalogSale(chosen),
    catalogId,
  };
}

async function fetchItemBundle(itemId, catalogId) {
  const id = parseItemId(itemId);
  let item;
  try {
    item = await meliGet('/items/' + id);
  } catch (e) {
    if (e.status === 403 && catalogId) return fetchCatalogBundle(catalogId, id);
    if (e.status === 403) throw httpError(400, 'Essa URL é de anúncio de terceiro. Cole a página do produto (/p/MLB…).');
    throw e;
  }
  // description + sale_price: 403/404 → vazio
  // se seller_id !== auth.meliUserId: delete available_quantity
  return { item, descriptionPlain, sale, catalogId: catalogId || null };
}

async function importFromUrl(url, actor) {
  const ref = parseImportRef(url);
  const bundle = ref.itemId
    ? await fetchItemBundle(ref.itemId, ref.catalogId)
    : await fetchCatalogBundle(ref.catalogId, null);
  const official = require('./official');
  const out = official.importMappedMeli({ ...bundle, actor });
  // log meli_imported / meli_synced com productId, meliItemId, meliCatalogId
  return out;
}

async function syncProduct(productId, actor) {
  const official = require('./official');
  const product = official.productOf(productId);
  if (!product || !(product.meliItemId || product.meliCatalogId)) {
    throw httpError(404, 'Produto sem vínculo Mercado Livre.');
  }
  const bundle = product.meliCatalogId
    ? await fetchCatalogBundle(product.meliCatalogId, product.meliItemId)
    : await fetchItemBundle(product.meliItemId, null);
  return official.syncMappedMeli(product.id, { ...bundle, actor });
}
```

`meliGet` 403 em `/products` deve continuar 400 genérico ou a mensagem de terceiro só no `/items`.

- [ ] **Step 4: Run tests**

Run: `cd /workspace/backend && node src/meli.test.js`

Expected: pode falhar em `meliCatalogId` até a Task 4 — se falhar só nisso, siga; se falhar parse/import, corrija aqui.

- [ ] **Step 5: Do not commit** unless asked.

---

### Task 4: persistir meliCatalogId e estoque vazio de terceiro

**Files:**
- Modify: `backend/src/official.js` (`sanitizeProductInput`, `createProduct`, `serializeProduct`, `importMappedMeli`, `syncMappedMeli`, `applyMeliOffer`)
- Test: `backend/src/official.test.js` e o assert `meliCatalogId` de `meli.test.js`

**Interfaces:**
- Consumes: bundle `{ item, descriptionPlain, sale, catalogId, actor }`
- Produces: produto com `meliCatalogId`; oferta sem `stock` quando `available_quantity` ausente; `meliUserId` do vendedor do anúncio (terceiro ok)

- [ ] **Step 1: Write the failing test**

Em `official.test.js`, no bloco `importMappedMeli`, passar `catalogId: 'MLB60968045'` e assertar `first.product.meliCatalogId === 'MLB60968045'`. Segundo import do mesmo item preserva o id.

Item sem `available_quantity`: `offer.stock` 0/vazio, não uma faixa inventada.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/official.test.js`

Expected: FAIL `meliCatalogId` undefined

- [ ] **Step 3: Write minimal implementation**

- `sanitizeProductInput`: igual `meliItemId` para `meliCatalogId`.
- `createProduct` insert + update: `meliCatalogId: input.meliCatalogId || null`.
- `serializeProduct`: incluir `meliCatalogId`.
- `importMappedMeli` / `syncMappedMeli`: gravar `meliCatalogId: catalogId || ficha` existente.
- `applyMeliOffer`: `stock` só se `Number.isFinite(item.available_quantity)`; senão `0`.

- [ ] **Step 4: Run tests**

Run:

```bash
cd /workspace/backend && node src/official.test.js && node src/meli.test.js
```

Expected: ambos `OK`

- [ ] **Step 5: Do not commit** unless asked.

---

### Task 5: UI hint + restart API

**Files:**
- Modify: `frontend/src/pages/AdminOfficial.jsx` (hint do form Import)
- Restart: processo `node src/server.js`

**Interfaces:**
- Consumes: mesmos `POST /api/admin/official/meli/import` `{ url }`
- Produces: copy alinhada ao 2C

- [ ] **Step 1: Update hint**

```jsx
<div className="hint">Cole anúncio próprio (MLB) ou página /p/ de terceiro (wid= escolhe o vendedor; senão o menor preço). Catálogo /up/MLBU não importa.</div>
```

Placeholder: `URL do anúncio, /p/ ou código MLB…`

- [ ] **Step 2: Full backend tests**

Run: `cd /workspace/backend && npm test`

Expected: todas as suítes `OK`. Se `official.test.js` falhar por DB compartilhado depois de `meli.test.js`, rodar `official.test.js` isolado; não “corrigir” cobertura de cidade.

- [ ] **Step 3: Restart API**

Matar o `node src/server.js` atual via `background_terminal_kill` e subir de novo `cd /workspace/backend && node src/server.js`.

- [ ] **Step 4: Do not commit** unless asked.

---

## Spec coverage

| Spec | Task |
|---|---|
| `wid` + `/p/` parse | 1 |
| Pick wid / menor preço | 2 |
| Ficha catálogo name/fotos/https | 2 |
| `/items` 403 sem `/p/` recusa | 3 |
| `/items` 403 com `/p/` importa | 3 |
| `/p/` sem wid → menor preço | 3 |
| Clássico 403 sem catálogo recusa | 3 |
| Não recusar seller_id ≠ grant se `/items` 200 | 3 |
| Sync usa `meliCatalogId` | 3 |
| Persist `meliCatalogId` | 4 |
| Stock vazio terceiro | 4 |
| UI | 5 |
| OAuth obrigatório / sem scrape | inalterado |
| Rascunho / sync não toca preço comercial | 2B existente + 4 |
