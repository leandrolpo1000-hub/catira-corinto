import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appmaxJs = fs.readFileSync(path.join(dir, 'appmax.js'), 'utf8');
const form = fs.readFileSync(path.join(dir, 'AppmaxCardForm.jsx'), 'utf8');
const listing = fs.readFileSync(path.join(dir, 'pages/Listing.jsx'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'App.jsx'), 'utf8');
const api = fs.readFileSync(path.join(dir, 'api.js'), 'utf8');

assert.equal(appmaxJs.includes('scripts.sandboxappmax.com.br/appmax.min.js'), true, 'script sandbox');
assert.equal(appmaxJs.includes('scripts.appmax.com.br/appmax.min.js'), true, 'script produção');
assert.equal(appmaxJs.includes('AppmaxScripts.init'), true, 'init oficial');
assert.equal(appmaxJs.includes('externalId'), true, 'externalId no init');
assert.equal(appmaxJs.includes('onTokenize'), true, 'callback onTokenize');
assert.equal(appmaxJs.includes('onIp'), true, 'callback onIp');
assert.equal(appmaxJs.includes('data-appmax-customer'), true, 'gatilho de IP');
assert.equal(appmaxJs.includes('data-appmax-checkout'), true, 'form de cartão');
assert.equal(/number|cvv|expiration_month/.test(appmaxJs) && appmaxJs.includes('/api/'), false, 'helper não posta PAN');

assert.equal(form.includes('data-appmax-checkout'), true, 'form oficial');
assert.equal(form.includes('name="card-number"'), true, 'name card-number');
assert.equal(form.includes('name="card-holder-name"'), true, 'name card-holder-name');
assert.equal(form.includes('name="exp-month"'), true, 'name exp-month');
assert.equal(form.includes('name="exp-year"'), true, 'name exp-year');
assert.equal(form.includes('name="cvv"'), true, 'name cvv');
assert.equal(form.includes('preventDefault'), true, 'SPA preventDefault');
assert.equal(form.includes('Comprar pelo Catira'), false, 'form sem Comprar');
assert.equal(/api\(/.test(form), false, 'form não envia cartão ao backend');

assert.equal(listing.includes('Comprar pelo Catira'), false, 'ficha sem Comprar pelo');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem form de cartão');
assert.equal(listing.includes('data-appmax-checkout'), false, 'ficha sem checkout de cartão');
assert.equal(listing.includes('data-appmax-customer'), true, 'ficha pede IP Appmax JS');
assert.equal(app.includes('checkout'), false, 'sem rota pública de checkout');
assert.equal(api.includes('card-number'), false, 'api.js sem PAN');
assert.equal(api.includes('/v1/payments/tokenize'), false, 'api.js não tokeniza');

console.log('OK appmax card ui tests');
