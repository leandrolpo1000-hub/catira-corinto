const INSECURE_DEV_JWT_SECRET = 'catira-corinto-dev-secret-change-me';
const MIN_PROD_JWT_LENGTH = 32;

const ENV_KEYS = [
  'NODE_ENV',
  'CATIRA_ENV',
  'PORT',
  'CATIRA_JWT_SECRET',
  'USER_MELI_CLIENT_ID',
  'USER_MELI_CLIENT_SECRET',
  'USER_MELI_REDIRECT_URI',
  'USER_APPMAX_CLIENT_ID',
  'USER_APPMAX_CLIENT_SECRET',
  'USER_APPMAX_ENV',
  'USER_APPMAX_EXTERNAL_ID',
  'USER_APPMAX_WEBHOOK_TOKEN',
  'CATIRA_SQLITE_PATH',
  'CATIRA_BACKUP_DIR',
  'CATIRA_JSON_PATH',
];

function isProduction(env) {
  const source = env || process.env;
  const nodeEnv = String(source.NODE_ENV || '').trim().toLowerCase();
  const catiraEnv = String(source.CATIRA_ENV || '').trim().toLowerCase();
  return nodeEnv === 'production' || catiraEnv === 'production';
}

function resolveJwtSecret(env) {
  const source = env || process.env;
  const raw = source.CATIRA_JWT_SECRET == null ? '' : String(source.CATIRA_JWT_SECRET).trim();
  const production = isProduction(source);

  if (!production) {
    return raw || INSECURE_DEV_JWT_SECRET;
  }

  if (!raw) {
    throw new Error('CATIRA_JWT_SECRET é obrigatório em produção.');
  }
  if (raw === INSECURE_DEV_JWT_SECRET) {
    throw new Error('CATIRA_JWT_SECRET inseguro: não use o secret default de desenvolvimento em produção.');
  }
  if (raw.length < MIN_PROD_JWT_LENGTH) {
    throw new Error('CATIRA_JWT_SECRET deve ter pelo menos 32 caracteres em produção.');
  }
  return raw;
}

function assertRuntimeConfig(env) {
  resolveJwtSecret(env);
}

function describeEnv(env) {
  const source = env || process.env;
  const listed = {};
  ENV_KEYS.forEach((key) => {
    const value = source[key];
    listed[key] = !!(value != null && String(value).trim());
  });
  return listed;
}

module.exports = {
  INSECURE_DEV_JWT_SECRET,
  MIN_PROD_JWT_LENGTH,
  ENV_KEYS,
  isProduction,
  resolveJwtSecret,
  assertRuntimeConfig,
  describeEnv,
};
