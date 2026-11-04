const { randomBytes } = require('crypto');
const db = require('./db');

const SANDBOX_URLS = {
  authUrl: 'https://auth.sandboxappmax.com.br/oauth2/token',
  apiUrl: 'https://api.sandboxappmax.com.br',
  scriptUrl: 'https://scripts.sandboxappmax.com.br/appmax.min.js',
};

const PRODUCTION_URLS = {
  authUrl: 'https://auth.appmax.com.br/oauth2/token',
  apiUrl: 'https://api.appmax.com.br',
  scriptUrl: 'https://scripts.appmax.com.br/appmax.min.js',
};

const TOKEN_SKEW_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 15000;
const CARD_FORBIDDEN = ['number', 'cvv', 'expiration_month', 'expiration_year'];

const CREDENTIAL_FIELDS = {
  USER_APPMAX_CLIENT_ID: 'clientId',
  USER_APPMAX_CLIENT_SECRET: 'clientSecret',
  USER_APPMAX_EXTERNAL_ID: 'externalId',
  USER_APPMAX_WEBHOOK_TOKEN: 'webhookToken',
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sourceEnv(env) {
  return env || process.env;
}

function appmaxEnvLabel(env) {
  const raw = String(sourceEnv(env).USER_APPMAX_ENV || 'production').trim().toLowerCase();
  if (raw === 'sandbox') return 'sandbox';
  if (raw === 'production' || raw === 'prod') return 'production';
  return 'invalid';
}

function isAppmaxProduction(env) {
  return appmaxEnvLabel(env) === 'production';
}

function resolveUrls(env) {
  return isAppmaxProduction(env) ? { ...PRODUCTION_URLS } : { ...SANDBOX_URLS };
}

function hintKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length < 8) return '••••';
  return s.slice(0, 3) + '••••' + s.slice(-4);
}

function looksMasked(value) {
  return /[•*]/.test(String(value || ''));
}

function looksLikeCredentialToken(value) {
  const s = String(value || '');
  if (s.length < 16) return false;
  if (/\s/.test(s)) return false;
  if (/[^\x21-\x7e]/.test(s)) return false;
  return true;
}

function emptyStored() {
  return { id: 'appmax', clientId: '', clientSecret: '', externalId: '', webhookToken: '' };
}

function getStored() {
  const row = db.findOne('settings', (s) => s.id === 'appmax') || {};
  return { ...emptyStored(), ...row, id: 'appmax' };
}

function readEnvOnly(env, key) {
  const raw = sourceEnv(env)[key];
  return raw == null ? '' : String(raw).trim();
}

function readCredential(env, key) {
  const fromEnv = readEnvOnly(env, key);
  if (fromEnv) return fromEnv;
  const field = CREDENTIAL_FIELDS[key];
  if (!field) return '';
  const stored = getStored()[field];
  return stored == null ? '' : String(stored).trim();
}

function credentialSource(key) {
  if (readEnvOnly(process.env, key)) return 'env';
  const field = CREDENTIAL_FIELDS[key];
  const stored = field ? String(getStored()[field] || '').trim() : '';
  if (stored) return 'settings';
  return 'absent';
}

function effectiveWebhookToken() {
  return readCredential(process.env, 'USER_APPMAX_WEBHOOK_TOKEN');
}

function publicAppmaxSettings() {
  const stored = getStored();
  const clientSecretSet = !!(stored.clientSecret && String(stored.clientSecret).trim());
  const webhookToken = effectiveWebhookToken();
  const described = describeConfig();
  return {
    clientId: stored.clientId || '',
    clientSecretSet,
    clientSecretHint: clientSecretSet ? hintKey(stored.clientSecret) : '',
    externalId: stored.externalId || '',
    webhookConfigured: !!webhookToken,
    webhookUrl: webhookToken ? 'https://SEU-DOMINIO/api/appmax/webhooks/' + webhookToken : '',
    env: described.env,
    source: {
      clientId: credentialSource('USER_APPMAX_CLIENT_ID'),
      clientSecret: credentialSource('USER_APPMAX_CLIENT_SECRET'),
      externalId: credentialSource('USER_APPMAX_EXTERNAL_ID'),
      webhookToken: credentialSource('USER_APPMAX_WEBHOOK_TOKEN'),
    },
  };
}

function saveAppmaxSettings(patch) {
  const current = getStored();
  const src = patch || {};
  const incomingSecret = src.clientSecret !== undefined ? String(src.clientSecret).trim() : '';
  const next = {
    id: 'appmax',
    clientId: src.clientId !== undefined ? String(src.clientId).trim() : current.clientId,
    clientSecret: incomingSecret && !looksMasked(incomingSecret) ? incomingSecret : current.clientSecret,
    externalId: src.externalId !== undefined ? String(src.externalId).trim() : current.externalId,
    webhookToken: current.webhookToken,
  };
  if (!next.clientId || !next.clientSecret || !next.externalId) {
    throw httpError(400, 'Informe Client ID, Client Secret e External ID.');
  }
  if (!looksLikeCredentialToken(next.clientSecret)) {
    throw httpError(400, 'Client Secret inválido. Cole só o código copiado no painel, não o texto da tela.');
  }
  if (next.clientSecret === next.externalId) {
    throw httpError(400, 'Client Secret não pode ser o External ID. Cole o Secret do card (aparece uma vez).');
  }
  if (!next.webhookToken && !readEnvOnly(process.env, 'USER_APPMAX_WEBHOOK_TOKEN')) {
    next.webhookToken = randomBytes(32).toString('hex');
  }
  const existing = db.findById('settings', 'appmax');
  return existing ? db.update('settings', 'appmax', next) : db.insert('settings', next);
}

async function testAuth(opts) {
  return createClient({ fetch: opts && opts.fetch }).getAccessToken();
}

function credentialsOf(env) {
  const clientId = readCredential(env, 'USER_APPMAX_CLIENT_ID');
  const clientSecret = readCredential(env, 'USER_APPMAX_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw httpError(500, 'Credencial Appmax não configurada.');
  }
  return { clientId, clientSecret };
}

function isTimeoutError(err) {
  return !!(err && (err.name === 'AbortError' || err.name === 'TimeoutError'));
}

function assertCents(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw httpError(400, (label || 'Valores monetários') + ' devem ser inteiros em centavos.');
  }
  return value;
}

function rejectCardSecrets(input) {
  const src = input || {};
  const nested = src.credit_card || src.payment_data && src.payment_data.credit_card || {};
  for (let i = 0; i < CARD_FORBIDDEN.length; i++) {
    const key = CARD_FORBIDDEN[i];
    if (src[key] !== undefined || nested[key] !== undefined) {
      throw httpError(400, 'Pagamento com cartão exige token gerado no frontend. Não envie dados do cartão.');
    }
  }
}

function pickCustomer(data) {
  const customer = data && (data.customer || (data.data && data.data.customer) || data);
  const id = customer && customer.id;
  if (id == null) throw httpError(502, 'Resposta inválida da Appmax.');
  return { id };
}

function pickOrder(data) {
  const order = data && (data.order || (data.data && data.data.order) || data);
  if (!order || order.id == null) throw httpError(502, 'Resposta inválida da Appmax.');
  return order;
}

function pickPayment(data) {
  return (data && (data.payment || (data.data && data.data.payment) || data.data || data)) || {};
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    throw httpError(502, 'Resposta inválida da Appmax.');
  }
}

function createClient(opts) {
  const options = opts || {};
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const now = options.now || Date.now;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const urls = resolveUrls(env);
  let cachedToken = null;
  let expiresAt = 0;

  async function request(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (isTimeoutError(err)) throw httpError(504, 'Tempo esgotado na Appmax.');
      throw httpError(502, 'Falha de comunicação com a Appmax.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function getAccessToken() {
    const { clientId, clientSecret } = credentialsOf(env);
    if (cachedToken && now() + TOKEN_SKEW_MS < expiresAt) return cachedToken;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await request(urls.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw httpError(res.status, res.status === 401
        ? 'Falha de autenticação na Appmax (401).'
        : 'Falha de autenticação na Appmax (' + res.status + ').');
    }
    const payload = await readJson(res);
    const token = payload && payload.access_token;
    if (!token || typeof token !== 'string') {
      throw httpError(502, 'Resposta inválida da Appmax.');
    }
    const ttl = Number(payload.expires_in);
    const ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 3600 * 1000;
    cachedToken = token;
    expiresAt = now() + ttlMs;
    return cachedToken;
  }

  async function api(method, path, payload) {
    const token = await getAccessToken();
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    };
    const res = await request(urls.apiUrl + path, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (!res.ok) {
      throw httpError(res.status, 'Appmax recusou a requisição (' + res.status + ').');
    }
    return readJson(res);
  }

  async function createCustomer(input) {
    const src = input || {};
    if (!src.ip) throw httpError(400, 'IP do comprador é obrigatório (Appmax JS).');
    const body = {
      first_name: src.first_name,
      last_name: src.last_name,
      email: src.email,
      phone: src.phone,
      ip: src.ip,
    };
    if (src.document_number) body.document_number = src.document_number;
    if (src.address) body.address = src.address;
    if (src.products) body.products = src.products;
    const json = await api('POST', '/v1/customers', body);
    return pickCustomer(json.data || json);
  }

  async function createOrder(input) {
    const src = input || {};
    const products = Array.isArray(src.products) ? src.products : [];
    products.forEach((p) => assertCents(p && p.unit_value, 'unit_value'));
    if (src.products_value !== undefined) assertCents(src.products_value, 'products_value');
    if (src.discount_value !== undefined) assertCents(src.discount_value, 'discount_value');
    if (src.shipping_value !== undefined) assertCents(src.shipping_value, 'shipping_value');
    const json = await api('POST', '/v1/orders', {
      customer_id: src.customer_id,
      products_value: src.products_value,
      discount_value: src.discount_value,
      shipping_value: src.shipping_value,
      products,
    });
    return pickOrder(json.data || json);
  }

  async function createPixPayment(input) {
    const src = input || {};
    const pix = { document_number: src.document_number };
    if (src.expiration_date) pix.expiration_date = src.expiration_date;
    const json = await api('POST', '/v1/payments/pix', {
      order_id: src.order_id,
      payment_data: { pix },
    });
    return pickPayment(json);
  }

  async function createCreditCardPayment(input) {
    const src = input || {};
    rejectCardSecrets(src);
    const token = src.token || (src.payment_data && src.payment_data.credit_card && src.payment_data.credit_card.token);
    if (!token) {
      throw httpError(400, 'Pagamento com cartão exige token gerado no frontend.');
    }
    const json = await api('POST', '/v1/payments/credit-card', {
      order_id: src.order_id,
      customer_id: src.customer_id,
      payment_data: {
        credit_card: {
          token,
          holder_document_number: src.holder_document_number,
          holder_name: src.holder_name,
          installments: src.installments || 1,
          ...(src.soft_descriptor ? { soft_descriptor: src.soft_descriptor } : {}),
        },
      },
    });
    return json.data || json;
  }

  async function getOrder(orderId) {
    const json = await api('GET', '/v1/orders/' + orderId);
    return pickOrder(json.data || json);
  }

  async function getInstallments(input) {
    const src = input || {};
    assertCents(src.total_value, 'total_value');
    const json = await api('POST', '/v1/payments/installments', {
      installments: src.installments,
      total_value: src.total_value,
      settings: src.settings !== undefined ? src.settings : true,
    });
    return json.data || json;
  }

  return {
    urls,
    getAccessToken,
    createCustomer,
    createOrder,
    createPixPayment,
    createCreditCardPayment,
    getOrder,
    getInstallments,
  };
}

function publicConfig(env) {
  const urls = resolveUrls(env);
  return {
    scriptUrl: urls.scriptUrl,
    externalId: readCredential(env, 'USER_APPMAX_EXTERNAL_ID'),
    env: isAppmaxProduction(env) ? 'production' : 'sandbox',
  };
}

function presenceOf(env, key) {
  return readCredential(env, key) ? 'configured' : 'absent';
}

function describeConfig(env) {
  const source = sourceEnv(env);
  const envLabel = appmaxEnvLabel(source);
  return {
    clientId: presenceOf(source, 'USER_APPMAX_CLIENT_ID'),
    clientSecret: presenceOf(source, 'USER_APPMAX_CLIENT_SECRET'),
    externalId: presenceOf(source, 'USER_APPMAX_EXTERNAL_ID'),
    webhookToken: presenceOf(source, 'USER_APPMAX_WEBHOOK_TOKEN'),
    env: envLabel,
    urls: envLabel,
  };
}

module.exports = {
  resolveUrls,
  createClient,
  isAppmaxProduction,
  publicConfig,
  describeConfig,
  publicAppmaxSettings,
  saveAppmaxSettings,
  testAuth,
  effectiveWebhookToken,
};
