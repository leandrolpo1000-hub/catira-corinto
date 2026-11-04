const assert = require('assert');
const { inspect } = require('util');

const db = require('./db');
const appmax = require('./appmax');

const SECRET = 'super-secret-appmax-client-secret-do-not-leak';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.appmax-test-token';

function env(extra) {
  return {
    USER_APPMAX_CLIENT_ID: 'merchant-client-id',
    USER_APPMAX_CLIENT_SECRET: SECRET,
    USER_APPMAX_ENV: 'sandbox',
    ...extra,
  };
}

function jsonResponse(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        const map = { 'content-type': 'application/json', ...(headers || {}) };
        return map[key] || map[name] || null;
      },
    },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function mockFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const entry = {
      url: String(url),
      method: (init && init.method) || 'GET',
      headers: Object.assign({}, (init && init.headers) || {}),
      body: init && init.body,
      signal: init && init.signal,
    };
    calls.push(entry);
    return handler(entry, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function tokenHandler(entry) {
  assert.ok(entry.url.endsWith('/oauth2/token'), 'token em /oauth2/token');
  assert.strictEqual(entry.method, 'POST');
  assert.match(String(entry.headers['Content-Type'] || entry.headers['content-type']), /application\/x-www-form-urlencoded/);
  const body = String(entry.body);
  assert.match(body, /grant_type=client_credentials/);
  assert.match(body, /client_id=/);
  assert.ok(!body.includes(TOKEN), 'token request não reenvia access_token');
  return jsonResponse(200, {
    access_token: TOKEN,
    token_type: 'Bearer',
    expires_in: 3600,
  });
}

function client(fetchImpl, extraEnv, now) {
  return appmax.createClient({
    env: env(extraEnv),
    fetch: fetchImpl,
    now: now || (() => 1_700_000_000_000),
  });
}

async function expectReject(fn, re, label) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, label + ' deveria lançar');
  if (re) assert.match(String(err.message), re, label);
  const dumped = inspect(err, { depth: 6 }) + JSON.stringify(err) + String(err.stack || '');
  assert.ok(!dumped.includes(SECRET), label + ' não vaza secret');
  assert.ok(!dumped.includes(TOKEN) || /token|expir|ausente|inválid/i.test(String(err.message)), label);
  return err;
}

function customerPayload() {
  return {
    first_name: 'Junior',
    last_name: 'Almeida',
    email: 'junior@example.com',
    phone: '51983655100',
    document_number: '19100000000',
    ip: '127.0.0.1',
    address: {
      postcode: '39200000',
      street: 'Rua das Flores',
      number: '100',
      complement: 'Casa',
      district: 'Centro',
      city: 'Corinto',
      state: 'MG',
    },
  };
}

function orderPayload() {
  return {
    customer_id: 17,
    products_value: 13550,
    discount_value: 0,
    shipping_value: 0,
    products: [{
      sku: 'catira-offer-1',
      name: 'Furadeira',
      quantity: 1,
      unit_value: 13550,
      type: 'physical',
    }],
  };
}

async function run() {
  const urlsSandbox = appmax.resolveUrls(env());
  assert.strictEqual(urlsSandbox.authUrl, 'https://auth.sandboxappmax.com.br/oauth2/token');
  assert.strictEqual(urlsSandbox.apiUrl, 'https://api.sandboxappmax.com.br');
  assert.strictEqual(urlsSandbox.scriptUrl, 'https://scripts.sandboxappmax.com.br/appmax.min.js');

  const urlsProd = appmax.resolveUrls(env({ USER_APPMAX_ENV: 'production' }));
  assert.strictEqual(urlsProd.authUrl, 'https://auth.appmax.com.br/oauth2/token');
  assert.strictEqual(urlsProd.apiUrl, 'https://api.appmax.com.br');
  assert.strictEqual(urlsProd.scriptUrl, 'https://scripts.appmax.com.br/appmax.min.js');

  const pub = appmax.publicConfig(env({ USER_APPMAX_EXTERNAL_ID: 'ext-sandbox-1' }));
  assert.strictEqual(pub.scriptUrl, urlsSandbox.scriptUrl);
  assert.strictEqual(pub.externalId, 'ext-sandbox-1');
  assert.strictEqual(pub.env, 'sandbox');
  assert.ok(!JSON.stringify(pub).includes(SECRET), 'publicConfig não vaza secret');
  assert.ok(!('clientSecret' in pub) && !('clientId' in pub));

  const describedEmpty = appmax.describeConfig(env({
    USER_APPMAX_CLIENT_ID: '',
    USER_APPMAX_CLIENT_SECRET: '',
    USER_APPMAX_EXTERNAL_ID: '',
    USER_APPMAX_WEBHOOK_TOKEN: '',
    USER_APPMAX_ENV: '',
  }));
  assert.strictEqual(describedEmpty.clientId, 'absent');
  assert.strictEqual(describedEmpty.clientSecret, 'absent');
  assert.strictEqual(describedEmpty.externalId, 'absent');
  assert.strictEqual(describedEmpty.webhookToken, 'absent');
  assert.strictEqual(describedEmpty.env, 'production');
  assert.strictEqual(describedEmpty.urls, 'production');
  assert.ok(!JSON.stringify(describedEmpty).includes(SECRET));

  const describedOk = appmax.describeConfig(env({
    USER_APPMAX_EXTERNAL_ID: 'ext-sandbox-1',
    USER_APPMAX_WEBHOOK_TOKEN: 'whsec_not_for_report',
  }));
  assert.strictEqual(describedOk.clientId, 'configured');
  assert.strictEqual(describedOk.clientSecret, 'configured');
  assert.strictEqual(describedOk.externalId, 'configured');
  assert.strictEqual(describedOk.webhookToken, 'configured');
  assert.strictEqual(describedOk.env, 'sandbox');
  assert.ok(!JSON.stringify(describedOk).includes('whsec_not_for_report'), 'describeConfig não vaza token');
  assert.ok(!JSON.stringify(describedOk).includes(SECRET), 'describeConfig não vaza secret');
  assert.ok(!JSON.stringify(describedOk).includes('merchant-client-id'), 'describeConfig não vaza client id');

  const describedProd = appmax.describeConfig(env({ USER_APPMAX_ENV: 'production' }));
  assert.strictEqual(describedProd.env, 'production');
  assert.strictEqual(describedProd.urls, 'production');
  const describedBogus = appmax.describeConfig(env({ USER_APPMAX_ENV: 'staging' }));
  assert.strictEqual(describedBogus.env, 'invalid');
  assert.strictEqual(describedBogus.urls, 'invalid');

  await expectReject(
    () => client(mockFetch(() => { throw new Error('não deveria chamar'); }), {
      USER_APPMAX_CLIENT_ID: '',
      USER_APPMAX_CLIENT_SECRET: '',
    }).getAccessToken(),
    /não configurado|credencial/i,
    'sem credenciais'
  );

  await expectReject(
    () => client(mockFetch(() => { throw new Error('não deveria chamar'); }), {
      USER_APPMAX_CLIENT_SECRET: '',
    }).createCustomer(customerPayload()),
    /não configurado|credencial/i,
    'secret ausente'
  );

  const authFetch = mockFetch((entry) => {
    if (entry.url.includes('/oauth2/token')) return tokenHandler(entry);
    throw new Error('url inesperada ' + entry.url);
  });
  const token = await client(authFetch).getAccessToken();
  assert.strictEqual(token, TOKEN);
  assert.strictEqual(authFetch.calls.length, 1, 'primeira autenticação chama oauth');
  assert.match(String(authFetch.calls[0].body), /client_id=merchant-client-id/);

  const cached = await client(authFetch).getAccessToken();
  assert.strictEqual(cached, TOKEN);

  const reuseFetch = mockFetch((entry) => tokenHandler(entry));
  const reuse = client(reuseFetch);
  await reuse.getAccessToken();
  await reuse.getAccessToken();
  assert.strictEqual(reuseFetch.calls.length, 1, 'token em cache não reautentica');

  let nowMs = 1_700_000_000_000;
  const expireFetch = mockFetch((entry) => tokenHandler(entry));
  const expiring = client(expireFetch, null, () => nowMs);
  await expiring.getAccessToken();
  nowMs += 3600 * 1000 - 10_000;
  await expiring.getAccessToken();
  assert.strictEqual(expireFetch.calls.length, 2, 'token perto de expirar é renovado');

  const apiFetch = mockFetch((entry) => {
    if (entry.url.includes('/oauth2/token')) return tokenHandler(entry);
    assert.match(entry.headers.Authorization || entry.headers.authorization, /^Bearer /);
    assert.ok(!(entry.headers.Authorization || '').includes(SECRET));
    if (entry.url.endsWith('/v1/customers') && entry.method === 'POST') {
      const body = JSON.parse(entry.body);
      assert.strictEqual(body.first_name, 'Junior');
      assert.strictEqual(body.ip, '127.0.0.1');
      assert.strictEqual(body.document_number, '19100000000');
      assert.strictEqual(body.address.postcode, '39200000');
      return jsonResponse(201, { data: { customer: { id: 17 } } });
    }
    if (entry.url.endsWith('/v1/orders') && entry.method === 'POST') {
      const body = JSON.parse(entry.body);
      assert.strictEqual(body.customer_id, 17);
      assert.strictEqual(body.products[0].unit_value, 13550);
      assert.strictEqual(body.products_value, 13550);
      assert.ok(Number.isInteger(body.products[0].unit_value), 'unit_value em centavos inteiros');
      assert.strictEqual(body.products[0].type, 'physical');
      return jsonResponse(201, { data: { order: { id: 99, status: 'pendente' } } });
    }
    if (entry.url.endsWith('/v1/payments/pix') && entry.method === 'POST') {
      const body = JSON.parse(entry.body);
      assert.strictEqual(body.order_id, 99);
      assert.strictEqual(body.payment_data.pix.document_number, '19100000000');
      return jsonResponse(200, {
        data: {
          payment: {
            pix_emv: '00020126580014br.gov.bcb.pix',
            pix_qrcode: 'iVBORw0KGgo=',
            pix_expiration_date: '2026-11-03 15:00:00',
          },
        },
      });
    }
    if (entry.url.endsWith('/v1/payments/credit-card') && entry.method === 'POST') {
      const body = JSON.parse(entry.body);
      assert.strictEqual(body.order_id, 99);
      assert.strictEqual(body.customer_id, 17);
      assert.strictEqual(body.payment_data.credit_card.token, 'tok_front_end');
      assert.strictEqual(body.payment_data.credit_card.installments, 1);
      assert.ok(!body.payment_data.credit_card.number);
      assert.ok(!body.payment_data.credit_card.cvv);
      return jsonResponse(201, { data: { pay: { status: 'pendente' } } });
    }
    if (entry.url.endsWith('/v1/orders/99') && entry.method === 'GET') {
      return jsonResponse(200, {
        data: {
          order: { id: 99, status: 'pendente', total_paid: 0 },
        },
      });
    }
    if (entry.url.endsWith('/v1/payments/installments') && entry.method === 'POST') {
      const body = JSON.parse(entry.body);
      assert.strictEqual(body.total_value, 13550);
      assert.strictEqual(body.installments, 3);
      assert.ok(Number.isInteger(body.total_value));
      return jsonResponse(200, { data: { installments: [{ installment: 1, amount: 13550 }] } });
    }
    throw new Error('url inesperada ' + entry.method + ' ' + entry.url);
  });

  const api = client(apiFetch);
  const customer = await api.createCustomer(customerPayload());
  assert.strictEqual(customer.id, 17);

  const order = await api.createOrder(orderPayload());
  assert.strictEqual(order.id, 99);
  assert.strictEqual(order.status, 'pendente');

  const pix = await api.createPixPayment({
    order_id: 99,
    document_number: '19100000000',
  });
  assert.ok(pix.pix_emv);
  assert.ok(pix.pix_expiration_date);

  const card = await api.createCreditCardPayment({
    order_id: 99,
    customer_id: 17,
    token: 'tok_front_end',
    holder_document_number: '19100000000',
    holder_name: 'Junior Almeida',
    installments: 1,
  });
  assert.ok(card);

  const looked = await api.getOrder(99);
  assert.strictEqual(looked.id, 99);
  assert.strictEqual(looked.status, 'pendente');
  assert.notStrictEqual(looked.status, 'aprovado', 'consulta não marca pago');

  const installments = await api.getInstallments({ total_value: 13550, installments: 3 });
  assert.ok(installments);

  await expectReject(
    () => api.createCreditCardPayment({
      order_id: 99,
      customer_id: 17,
      number: '4000000000000010',
      cvv: '123',
      expiration_month: '12',
      expiration_year: '28',
      holder_name: 'Junior',
    }),
    /tokenizad|cartão/i,
    'recusa PAN/CVV'
  );

  await expectReject(
    () => api.createOrder({
      customer_id: 17,
      products: [{ sku: 'x', name: 'y', quantity: 1, unit_value: 135.5, type: 'physical' }],
    }),
    /centavos/i,
    'recusa reais no lugar de centavos'
  );

  const httpErrFetch = mockFetch((entry) => {
    if (entry.url.includes('/oauth2/token')) return tokenHandler(entry);
    return jsonResponse(422, { message: 'field is required' });
  });
  const httpErr = await expectReject(
    () => client(httpErrFetch).createCustomer(customerPayload()),
    /422|inválid|Appmax/i,
    'erro HTTP 422'
  );
  assert.strictEqual(httpErr.status, 422);

  const timeoutFetch = mockFetch(async (entry) => {
    if (entry.url.includes('/oauth2/token')) return tokenHandler(entry);
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  });
  await expectReject(
    () => client(timeoutFetch).getOrder(99),
    /tempo|timeout|abort/i,
    'timeout'
  );

  const badJsonFetch = mockFetch((entry) => {
    if (entry.url.includes('/oauth2/token')) return tokenHandler(entry);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      async json() { throw new SyntaxError('Unexpected token'); },
      async text() { return '<html>nope</html>'; },
    };
  });
  await expectReject(
    () => client(badJsonFetch).getOrder(99),
    /inválid|json|resposta/i,
    'resposta inválida'
  );

  const authFail = mockFetch(() => jsonResponse(401, { error: 'invalid_client' }));
  await expectReject(
    () => client(authFail).getAccessToken(),
    /401|autentic/i,
    'oauth 401'
  );

  const apiOnly = apiFetch.calls.filter((c) => !c.url.includes('/oauth2/token'));
  apiOnly.forEach((c) => {
    const blob = JSON.stringify(c);
    assert.ok(!blob.includes(SECRET), 'requisição de API não leva client_secret');
    assert.ok(!/number":"4000|cvv":"123/.test(blob), 'API não envia PAN/CVV');
  });

  const prevAppmaxEnv = {
    USER_APPMAX_CLIENT_ID: process.env.USER_APPMAX_CLIENT_ID,
    USER_APPMAX_CLIENT_SECRET: process.env.USER_APPMAX_CLIENT_SECRET,
    USER_APPMAX_EXTERNAL_ID: process.env.USER_APPMAX_EXTERNAL_ID,
    USER_APPMAX_WEBHOOK_TOKEN: process.env.USER_APPMAX_WEBHOOK_TOKEN,
  };
  function restoreAppmaxEnv() {
    Object.keys(prevAppmaxEnv).forEach((key) => {
      if (prevAppmaxEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevAppmaxEnv[key];
    });
  }
  function clearAppmaxRow() {
    const row = db.findById('settings', 'appmax');
    if (row) db.remove('settings', 'appmax');
  }

  try {
    delete process.env.USER_APPMAX_CLIENT_ID;
    delete process.env.USER_APPMAX_CLIENT_SECRET;
    delete process.env.USER_APPMAX_EXTERNAL_ID;
    delete process.env.USER_APPMAX_WEBHOOK_TOKEN;
    clearAppmaxRow();

    const emptyPublic = appmax.publicAppmaxSettings();
    assert.strictEqual(emptyPublic.clientId, '');
    assert.strictEqual(emptyPublic.clientSecretSet, false);
    assert.strictEqual(emptyPublic.externalId, '');
    assert.strictEqual(emptyPublic.webhookConfigured, false);
    assert.strictEqual(emptyPublic.webhookUrl, '');
    assert.ok(!('clientSecret' in emptyPublic), 'GET sem clientSecret');
    assert.ok(!('webhookToken' in emptyPublic), 'GET sem webhookToken');
    assert.strictEqual(emptyPublic.source.clientId, 'absent');
    assert.strictEqual(emptyPublic.env, 'production');

    let saveErr;
    try {
      appmax.saveAppmaxSettings({ clientId: 'id-only', clientSecret: '', externalId: 'ext-1' });
    } catch (e) { saveErr = e; }
    assert.ok(saveErr, 'faltou secret');
    assert.strictEqual(saveErr.status, 400);
    assert.strictEqual(db.findById('settings', 'appmax'), null, '400 não grava');

    let copyErr;
    try {
      appmax.saveAppmaxSettings({
        clientId: 'merchant-from-db',
        clientSecret: 'visível apenas uma vez (copie agora)',
        externalId: 'ext-1',
      });
    } catch (e) { copyErr = e; }
    assert.ok(copyErr, 'secret com texto da tela');
    assert.strictEqual(copyErr.status, 400);
    assert.match(String(copyErr.message), /código copiado|texto da tela/i);
    assert.strictEqual(db.findById('settings', 'appmax'), null, 'texto da tela não grava');

    let sameErr;
    try {
      appmax.saveAppmaxSettings({
        clientId: 'merchant-from-db',
        clientSecret: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        externalId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      });
    } catch (e) { sameErr = e; }
    assert.ok(sameErr, 'secret igual ao external id');
    assert.strictEqual(sameErr.status, 400);
    assert.match(String(sameErr.message), /External ID/i);
    assert.strictEqual(db.findById('settings', 'appmax'), null, 'secret=externalId não grava');

    const saved = appmax.saveAppmaxSettings({
      clientId: 'merchant-from-db',
      clientSecret: SECRET,
      externalId: 'ext-from-db',
    });
    assert.strictEqual(saved.clientId, 'merchant-from-db');
    assert.ok(saved.webhookToken && saved.webhookToken.length >= 32, 'token gerado');
    assert.match(saved.webhookToken, /^[0-9a-f]+$/);

    const pub = appmax.publicAppmaxSettings();
    assert.strictEqual(pub.clientId, 'merchant-from-db');
    assert.strictEqual(pub.externalId, 'ext-from-db');
    assert.strictEqual(pub.clientSecretSet, true);
    assert.ok(pub.clientSecretHint.includes('••••'));
    assert.ok(!JSON.stringify(pub).includes(SECRET), 'hint não vaza secret');
    assert.ok(!('webhookToken' in pub));
    assert.ok(pub.webhookUrl.startsWith('https://SEU-DOMINIO/api/appmax/webhooks/'));
    assert.ok(pub.webhookUrl.endsWith(saved.webhookToken));
    assert.strictEqual(pub.source.clientId, 'settings');
    assert.strictEqual(pub.source.clientSecret, 'settings');
    assert.strictEqual(pub.source.externalId, 'settings');
    assert.strictEqual(pub.source.webhookToken, 'settings');

    const kept = appmax.saveAppmaxSettings({
      clientId: 'merchant-from-db',
      clientSecret: '',
      externalId: 'ext-from-db',
    });
    assert.strictEqual(kept.clientSecret, SECRET, 'vazio mantém secret');
    const masked = appmax.saveAppmaxSettings({
      clientId: 'merchant-from-db',
      clientSecret: pub.clientSecretHint,
      externalId: 'ext-2',
    });
    assert.strictEqual(masked.clientSecret, SECRET, 'mascarado mantém secret');
    assert.strictEqual(masked.externalId, 'ext-2');
    assert.strictEqual(masked.webhookToken, saved.webhookToken, 'não rotaciona');

    const describedDb = appmax.describeConfig({
      USER_APPMAX_CLIENT_ID: '',
      USER_APPMAX_CLIENT_SECRET: '',
      USER_APPMAX_EXTERNAL_ID: '',
      USER_APPMAX_WEBHOOK_TOKEN: '',
    });
    assert.strictEqual(describedDb.clientId, 'configured');
    assert.strictEqual(describedDb.clientSecret, 'configured');
    assert.strictEqual(describedDb.externalId, 'configured');
    assert.strictEqual(describedDb.webhookToken, 'configured');
    assert.ok(!JSON.stringify(describedDb).includes(SECRET));

    const pubCfg = appmax.publicConfig({ USER_APPMAX_EXTERNAL_ID: '' });
    assert.strictEqual(pubCfg.externalId, 'ext-2');
    assert.strictEqual(pubCfg.env, 'production');

    process.env.USER_APPMAX_CLIENT_ID = 'env-client';
    process.env.USER_APPMAX_CLIENT_SECRET = 'env-secret-value-xxxx';
    process.env.USER_APPMAX_EXTERNAL_ID = 'env-ext';
    process.env.USER_APPMAX_WEBHOOK_TOKEN = 'env-webhook-token';
    const sourced = appmax.publicAppmaxSettings();
    assert.strictEqual(sourced.source.clientId, 'env');
    assert.strictEqual(sourced.source.clientSecret, 'env');
    assert.strictEqual(sourced.source.externalId, 'env');
    assert.strictEqual(sourced.source.webhookToken, 'env');
    assert.strictEqual(sourced.clientId, 'merchant-from-db', 'form mostra o banco');
    assert.ok(sourced.webhookUrl.endsWith('env-webhook-token'), 'URL usa token efetivo');
    assert.ok(!JSON.stringify(sourced).includes('env-secret-value-xxxx'));

    const tokenOk = await appmax.testAuth({
      fetch: mockFetch((entry) => tokenHandler(entry)),
    });
    assert.strictEqual(tokenOk, TOKEN);

    let authErr;
    try {
      await appmax.testAuth({
        fetch: mockFetch(() => jsonResponse(401, { error: 'invalid_client' })),
      });
    } catch (e) { authErr = e; }
    assert.ok(authErr);
    assert.match(String(authErr.message), /401/);
    assert.ok(!JSON.stringify(authErr).includes(SECRET));
  } finally {
    clearAppmaxRow();
    restoreAppmaxEnv();
  }

  console.log('appmax.test.js ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
