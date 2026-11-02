function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

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

function parseItemId(raw) {
  const ref = parseImportRef(raw);
  if (ref.itemId) return ref.itemId;
  throw httpError(400, 'Essa URL é da página do produto, não de um anúncio. Abra o anúncio de um vendedor (link com MLB + números ou parâmetro wid).');
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

function pickCatalogItem(results, preferredId) {
  const rows = Array.isArray(results) ? results.filter((r) => r && r.item_id) : [];
  if (!rows.length) throw httpError(400, 'Catálogo sem anúncios ativos.');
  const want = preferredId ? String(preferredId).toUpperCase() : '';
  const hit = want && rows.find((r) => String(r.item_id).toUpperCase() === want);
  if (hit) return hit;
  return rows.slice().sort((a, b) => Number(a.price) - Number(b.price))[0];
}

function catalogPermalink(productPermalink, itemId, catalogId) {
  const base = String(productPermalink || '').trim().split('#')[0];
  let u;
  try {
    u = base ? new URL(base) : null;
  } catch {
    u = null;
  }
  if (!u || !u.hostname) {
    const id = String(catalogId || '').trim().toUpperCase();
    if (!id) return '';
    u = new URL('https://www.mercadolivre.com.br/p/' + id);
  }
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
    permalink: catalogPermalink(product.permalink, chosen.item_id, product.id),
    pictures: Array.isArray(product.pictures) ? product.pictures : [],
  };
}

function mapCatalogSale(chosen) {
  return {
    amount: chosen && chosen.price,
    regular_amount: chosen && chosen.original_price != null ? chosen.original_price : null,
  };
}

const { randomBytes, createHash } = require('crypto');
const https = require('https');
const http = require('http');
const db = require('./db');

let httpImpl = null;
function setHttp(fn) { httpImpl = fn; }

function looksMasked(value) {
  return /[•*]/.test(String(value || ''));
}

function hintKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length < 8) return '••••';
  return s.slice(0, 3) + '••••' + s.slice(-4);
}

function suggestedRedirectUri(origin) {
  const base = String(origin || '').trim().replace(/\/+$/, '');
  return base ? base + '/api/meli/callback' : '';
}

function normalizeRedirectUri(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  let parsed;
  try { parsed = new URL(text); } catch { return text; }
  const pathName = parsed.pathname.replace(/\/+$/, '') || '/';
  if (pathName === '/admin' || pathName === '/') {
    parsed.pathname = '/api/meli/callback';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }
  return text;
}

function frontendReturnUrl(redirectUri, status, message) {
  let origin = '';
  try { origin = new URL(redirectUri).origin; } catch { origin = ''; }
  const q = new URLSearchParams();
  q.set('tab', 'oficial');
  q.set('meli', status);
  if (message) q.set('meliMsg', String(message).slice(0, 180));
  return (origin || '') + '/admin?' + q.toString();
}

function pkceVerifier() {
  return randomBytes(32).toString('base64url');
}

function pkceChallenge(verifier) {
  return createHash('sha256').update(String(verifier || '')).digest('base64url');
}

function storedAppSettings() {
  const row = db.findById('settings', 'meli') || {};
  return {
    clientId: String(row.clientId || '').trim(),
    clientSecret: String(row.clientSecret || '').trim(),
    redirectUri: String(row.redirectUri || '').trim(),
  };
}

function envConfig() {
  const stored = storedAppSettings();
  const clientId = stored.clientId || String(process.env.USER_MELI_CLIENT_ID || '').trim();
  const clientSecret = stored.clientSecret || String(process.env.USER_MELI_CLIENT_SECRET || '').trim();
  const redirectUri = stored.redirectUri || String(process.env.USER_MELI_REDIRECT_URI || '').trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function publicAppSettings() {
  const stored = storedAppSettings();
  const env = envConfig();
  const secret = stored.clientSecret || String(process.env.USER_MELI_CLIENT_SECRET || '').trim();
  return {
    clientId: stored.clientId || (env ? env.clientId : ''),
    redirectUri: stored.redirectUri || (env ? env.redirectUri : ''),
    secretSet: !!secret,
    secretHint: secret ? hintKey(secret) : '',
    configured: !!env,
  };
}

function saveAppSettings(patch) {
  const current = storedAppSettings();
  const incomingSecret = patch.clientSecret !== undefined ? String(patch.clientSecret || '').trim() : '';
  const next = {
    id: 'meli',
    clientId: patch.clientId !== undefined ? String(patch.clientId || '').trim() : current.clientId,
    clientSecret: incomingSecret && !looksMasked(incomingSecret) ? incomingSecret : current.clientSecret,
    redirectUri: patch.redirectUri !== undefined ? normalizeRedirectUri(patch.redirectUri) : current.redirectUri,
  };
  if (next.redirectUri) {
    let parsed;
    try { parsed = new URL(next.redirectUri); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:') {
      throw httpError(400, 'O redirect precisa ser um endereço https.');
    }
  }
  const existing = db.findById('settings', 'meli');
  if (existing) db.update('settings', 'meli', next);
  else db.insert('settings', next);
  return publicAppSettings();
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
  const verifier = pkceVerifier();
  db.insert('meliOauthStates', {
    state,
    adminId: adminId || null,
    codeVerifier: verifier,
    createdAt: new Date().toISOString(),
  });
  const url = 'https://auth.mercadolivre.com.br/authorization'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(env.clientId)
    + '&redirect_uri=' + encodeURIComponent(env.redirectUri)
    + '&state=' + encodeURIComponent(state)
    + '&scope=' + encodeURIComponent('read offline_access')
    + '&code_challenge=' + encodeURIComponent(pkceChallenge(verifier))
    + '&code_challenge_method=S256';
  return { url, state };
}

function formBody(obj) {
  return Object.keys(obj).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
}

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

async function completeAuth(adminId, code, state) {
  const env = envConfig();
  if (!env) throw httpError(503, 'Mercado Livre não configurado.');
  const row = db.findOne('meliOauthStates', (s) => s.state === String(state || ''));
  if (!row) throw httpError(400, 'Estado OAuth inválido.');
  const age = Date.now() - new Date(row.createdAt).getTime();
  db.remove('meliOauthStates', row.id);
  if (!Number.isFinite(age) || age > 10 * 60 * 1000) throw httpError(400, 'Estado OAuth expirado.');
  if (row.adminId && adminId && row.adminId !== adminId) throw httpError(400, 'Estado OAuth inválido.');
  const tokenBody = {
    grant_type: 'authorization_code',
    client_id: env.clientId,
    client_secret: env.clientSecret,
    code: String(code || ''),
    redirect_uri: env.redirectUri,
  };
  if (row.codeVerifier) tokenBody.code_verifier = row.codeVerifier;
  const res = await requestJson({
    method: 'POST',
    url: 'https://api.mercadolibre.com/oauth/token',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(tokenBody),
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
  if (res.status === 403) throw httpError(403, 'Acesso negado pelo Mercado Livre.');
  if (res.status >= 400) throw httpError(400, 'Falha ao consultar o Mercado Livre.');
  return res.json;
}

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
  let descriptionPlain = '';
  try {
    const desc = await meliGet('/items/' + id + '/description');
    descriptionPlain = desc && desc.plain_text ? desc.plain_text : '';
  } catch (e) {
    if (e.status !== 404 && e.status !== 403) throw e;
  }
  let sale = { amount: 0, regular_amount: null };
  try {
    sale = await meliGet('/items/' + id + '/sale_price?context=channel_marketplace');
  } catch (e) {
    if (e.status !== 404 && e.status !== 403) throw e;
  }
  const auth = db.all('meliAuth')[0];
  const ownSeller = auth && Number(item.seller_id) === Number(auth.meliUserId);
  if (!ownSeller || !Number.isFinite(Number(item.available_quantity))) {
    delete item.available_quantity;
  }
  return { item, descriptionPlain, sale, catalogId: catalogId || null };
}

async function importFromUrl(url, actor) {
  const ref = parseImportRef(url);
  const bundle = ref.itemId
    ? await fetchItemBundle(ref.itemId, ref.catalogId)
    : await fetchCatalogBundle(ref.catalogId, null);
  const official = require('./official');
  const out = official.importMappedMeli({ ...bundle, actor });
  db.insert('officialAdminLogs', {
    actorId: actor && actor.id ? actor.id : null,
    action: out.created ? 'meli_imported' : 'meli_synced',
    payload: {
      productId: out.product.id,
      meliItemId: out.product.meliItemId || ref.itemId,
      meliCatalogId: bundle.catalogId || ref.catalogId || null,
    },
    createdAt: new Date().toISOString(),
  });
  return out;
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runSyncTick(opts = {}) {
  const sleep = opts.sleep || sleepMs;
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

async function syncProduct(productId, actor) {
  const official = require('./official');
  const product = official.productOf(productId);
  if (!product || !(product.meliItemId || product.meliCatalogId)) {
    throw httpError(404, 'Produto sem vínculo Mercado Livre.');
  }
  const bundle = product.meliCatalogId
    ? await fetchCatalogBundle(product.meliCatalogId, product.meliItemId)
    : await fetchItemBundle(product.meliItemId, null);
  const out = official.syncMappedMeli(product.id, { ...bundle, actor });
  db.insert('officialAdminLogs', {
    actorId: actor && actor.id ? actor.id : null,
    action: 'meli_synced',
    payload: {
      productId: product.id,
      meliItemId: product.meliItemId,
      meliCatalogId: product.meliCatalogId || bundle.catalogId || null,
    },
    createdAt: new Date().toISOString(),
  });
  return out;
}

module.exports = {
  parseItemId,
  parseImportRef,
  pickCatalogItem,
  catalogPermalink,
  mapCatalogItem,
  mapCatalogSale,
  mapCondition,
  mapCategorySlug,
  mapImages,
  mapOfferStatus,
  mapSalePrice,
  mapFicha,
  setHttp,
  configured,
  envConfig,
  publicAppSettings,
  saveAppSettings,
  suggestedRedirectUri,
  normalizeRedirectUri,
  frontendReturnUrl,
  createAuthUrl,
  completeAuth,
  disconnect,
  authStatus,
  getAccessToken,
  meliGet,
  fetchItemBundle,
  fetchCatalogBundle,
  importFromUrl,
  syncProduct,
  runSyncTick,
};
