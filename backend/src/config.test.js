const assert = require('assert');
const {
  INSECURE_DEV_JWT_SECRET,
  resolveJwtSecret,
  assertRuntimeConfig,
  describeEnv,
} = require('./config');

function env(extra) {
  return { NODE_ENV: 'development', ...extra };
}

function throws(fn, re, label) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, label + ' deveria lançar');
  if (re) assert.match(String(err.message), re, label);
}

function run() {
  assert.strictEqual(
    resolveJwtSecret(env()),
    INSECURE_DEV_JWT_SECRET,
    'dev sem CATIRA_JWT_SECRET usa o secret conhecido'
  );

  assert.strictEqual(
    resolveJwtSecret(env({ CATIRA_JWT_SECRET: 'local-dev-secret-at-least-16' })),
    'local-dev-secret-at-least-16',
    'dev usa CATIRA_JWT_SECRET quando definido'
  );

  throws(
    () => resolveJwtSecret(env({ NODE_ENV: 'production' })),
    /CATIRA_JWT_SECRET/,
    'produção recusa secret ausente'
  );

  throws(
    () => resolveJwtSecret(env({ CATIRA_ENV: 'production' })),
    /CATIRA_JWT_SECRET/,
    'CATIRA_ENV=production recusa secret ausente'
  );

  throws(
    () => resolveJwtSecret(env({
      NODE_ENV: 'production',
      CATIRA_JWT_SECRET: INSECURE_DEV_JWT_SECRET,
    })),
    /inseguro|default|desenvolvimento/i,
    'produção recusa o secret default de desenvolvimento'
  );

  throws(
    () => resolveJwtSecret(env({
      NODE_ENV: 'production',
      CATIRA_JWT_SECRET: '   ',
    })),
    /CATIRA_JWT_SECRET/,
    'produção recusa secret em branco'
  );

  throws(
    () => resolveJwtSecret(env({
      NODE_ENV: 'production',
      CATIRA_JWT_SECRET: 'short',
    })),
    /32/,
    'produção recusa secret curto'
  );

  const prodSecret = 'p'.repeat(32);
  assert.strictEqual(
    resolveJwtSecret(env({ NODE_ENV: 'production', CATIRA_JWT_SECRET: prodSecret })),
    prodSecret,
    'produção aceita secret próprio com 32+ caracteres'
  );

  throws(
    () => assertRuntimeConfig(env({ NODE_ENV: 'production' })),
    /CATIRA_JWT_SECRET/,
    'assertRuntimeConfig bloqueia boot em produção sem JWT'
  );

  assert.doesNotThrow(
    () => assertRuntimeConfig(env()),
    'assertRuntimeConfig permite desenvolvimento sem JWT próprio'
  );

  const listed = describeEnv(env({
    USER_MELI_CLIENT_ID: 'abc',
    USER_APPMAX_CLIENT_ID: '',
    CATIRA_JWT_SECRET: 'hidden-value-should-not-leak',
  }));
  assert.strictEqual(listed.USER_MELI_CLIENT_ID, true, 'describeEnv indica presença MELI');
  assert.strictEqual(listed.USER_APPMAX_CLIENT_ID, false, 'Appmax vazio conta como ausente');
  assert.strictEqual(listed.CATIRA_JWT_SECRET, true, 'JWT presente sem revelar valor');
  assert.ok(!JSON.stringify(listed).includes('hidden-value'), 'describeEnv não vaza secret');

  console.log('config.test.js ok');
}

run();
