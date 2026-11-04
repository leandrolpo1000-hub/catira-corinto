const SANDBOX_SCRIPT = 'https://scripts.sandboxappmax.com.br/appmax.min.js';
const PRODUCTION_SCRIPT = 'https://scripts.appmax.com.br/appmax.min.js';

export function scriptUrlOf(env) {
  return env === 'production' || env === 'prod' ? PRODUCTION_SCRIPT : SANDBOX_SCRIPT;
}

export function loadAppmaxScript(scriptUrl) {
  const src = scriptUrl || SANDBOX_SCRIPT;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-appmax-sdk]');
    if (existing && window.AppmaxScripts) {
      resolve(window.AppmaxScripts);
      return;
    }
    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.appmaxSdk = '1';
    script.onload = () => resolve(window.AppmaxScripts);
    script.onerror = () => reject(new Error('Falha ao carregar Appmax JS.'));
    if (!existing) document.head.appendChild(script);
  });
}

export function initAppmaxScripts(opts) {
  const options = opts || {};
  const sdk = options.sdk || (typeof window !== 'undefined' ? window.AppmaxScripts : null);
  if (!sdk || typeof sdk.init !== 'function') {
    throw new Error('Appmax JS não carregado.');
  }
  const payload = {
    externalId: options.externalId,
    onIp: options.onIp,
    onTokenize: options.onTokenize,
    onError: options.onError,
  };
  if (typeof window !== 'undefined' && window.AppmaxScripts && sdk === window.AppmaxScripts) {
    window.AppmaxScripts.init(payload);
    return;
  }
  sdk.init(payload);
}

export const APPMAX_CUSTOMER_FORM = 'data-appmax-customer';
export const APPMAX_CHECKOUT_FORM = 'data-appmax-checkout';
export const APPMAX_CARD_FIELD_NAMES = [
  'card-number',
  'card-holder-name',
  'exp-month',
  'exp-year',
  'cvv',
];
