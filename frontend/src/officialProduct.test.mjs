import assert from 'node:assert/strict';
import { nearestCity, CITY_CENTROIDS } from './cityCentroids.js';
import { deliveryZone, deliveryEta, REGION_CITY_NAMES } from './deliveryEta.js';
import { resolveGeoCity } from './geoCity.js';
import { productPath } from './productPath.js';

assert.equal(CITY_CENTROIDS.length, 34);
assert.equal(REGION_CITY_NAMES.length, 34);
['Dores do Indaiá', 'Luz', 'Bom Despacho', 'Quartel Geral', 'Cedro do Abaeté', 'Corinto'].forEach((n) => {
  assert.equal(REGION_CITY_NAMES.includes(n), true, n);
});

const corinto = nearestCity(-18.378, -44.456);
assert.equal(corinto.name, 'Corinto');
assert.equal(corinto.id, 'corinto');

const bh = nearestCity(-19.9167, -43.9345);
assert.equal(bh.zone, 'fora');
assert.equal(bh.name, null);

assert.equal(deliveryZone('Corinto'), 'regiao');
assert.equal(deliveryZone('Luz'), 'regiao');
assert.equal(deliveryZone('Belo Horizonte'), 'fora');
assert.equal(deliveryZone(''), 'fora');

const etaC = deliveryEta('Corinto');
assert.equal(etaC.zone, 'regiao');
assert.equal(etaC.daysLabel, '2 a 5 dias úteis');
assert.equal(etaC.label, 'Chega em 2 a 5 dias úteis em Corinto');
assert.equal(etaC.label.includes('Demais'), false);

const etaF = deliveryEta('Belo Horizonte');
assert.equal(etaF.zone, 'fora');
assert.equal(etaF.daysLabel, '5 a 12 dias úteis');
assert.equal(etaF.label, 'Chega em 5 a 12 dias úteis');
assert.equal(etaF.label.includes('Corinto e região'), false);
assert.equal(etaF.label.includes('domingo'), false);

assert.equal(productPath({ id: 'abc', isOfficial: true }), '/produto/abc');
assert.equal(productPath({ id: 'xyz', isOfficial: false }), '/anuncio/xyz');
assert.equal(productPath({ id: 'n' }), '/anuncio/n');

const mem = {};
const storage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
};

const denied = {
  getCurrentPosition(ok, err) { err({ code: 1 }); },
};
const c1 = await resolveGeoCity({ geolocation: denied, storage, fallbackCity: 'Curvelo' });
assert.equal(c1, 'Curvelo');

const c2 = await resolveGeoCity({ geolocation: denied, storage, fallbackCity: '' });
assert.equal(c2, 'Corinto');

mem.catira_geo_city = 'Diamantina';
const c3 = await resolveGeoCity({ geolocation: denied, storage, fallbackCity: 'Curvelo' });
assert.equal(c3, 'Diamantina');

const geoOk = {
  getCurrentPosition(ok) { ok({ coords: { latitude: -18.378, longitude: -44.456 } }); },
};
delete mem.catira_geo_city;
const c4 = await resolveGeoCity({ geolocation: geoOk, storage, fallbackCity: 'Luz' });
assert.equal(c4, 'Corinto');
assert.equal(mem.catira_geo_city, 'Corinto');

const geoBh = {
  getCurrentPosition(ok) { ok({ coords: { latitude: -19.9167, longitude: -43.9345 } }); },
};
delete mem.catira_geo_city;
const cFora = await resolveGeoCity({ geolocation: geoBh, storage, fallbackCity: 'Curvelo' });
assert.equal(cFora, 'fora');
assert.equal(mem.catira_geo_city, 'fora');
const etaForaMarker = deliveryEta('fora');
assert.equal(etaForaMarker.zone, 'fora');
assert.equal(etaForaMarker.daysLabel, '5 a 12 dias úteis');
const cForaStored = await resolveGeoCity({ geolocation: denied, storage, fallbackCity: 'Curvelo' });
assert.equal(cForaStored, 'fora');

console.log('OK official product helpers');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(dir, 'pages/OfficialProduct.jsx'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'App.jsx'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');

assert.equal(app.includes('/produto/:id'), true, 'rota /produto/:id');
assert.equal(app.includes('OfficialProduct'), true, 'App importa OfficialProduct');
assert.equal(page.includes('Comprar pelo Catira'), true, 'CTA copy');
assert.equal(page.includes('Adicionar ao carrinho'), false, 'sem carrinho');
assert.equal(page.includes('Corinto e região'), false, 'sem duas faixas');
assert.equal(page.includes('Demais cidades'), false, 'sem demais');
assert.equal(page.includes('domingo'), false, 'sem dia da semana');
assert.equal(page.includes('/checkout?listing='), true, 'vai ao checkout');
assert.equal(page.includes('/api/orders'), false, 'PDP não cria pedido');
assert.equal(page.includes('resolveGeoCity'), true, 'usa GPS helper');
assert.equal(page.includes('if (!item || !item.isOfficial) return;'), true, 'GPS só em oficial');
assert.equal(page.includes('[item, chipCity]'), true, 'geo effect depende de item');
assert.equal(/import \{[^}]*\bLink\b[^}]*\} from 'react-router-dom'/.test(page), false, 'sem Link unused');
assert.equal(page.includes('deliveryEta'), true, 'usa ETA helper');
assert.equal(page.includes('catiraOffer'), true, 'preço da oferta');
assert.equal(page.includes('Navigate'), true, 'redirect não-oficial');
assert.equal(css.includes('.pdp-eta'), true, 'estilo prazo');
assert.equal(css.includes('.pdp-cta'), true, 'CTA sticky');

console.log('OK official product page strings');

const listingSrc = fs.readFileSync(path.join(dir, 'pages/Listing.jsx'), 'utf8');
assert.equal(listingSrc.includes("to={'/produto/'"), true, 'Listing redireciona oficial');
const componentsSrc = fs.readFileSync(path.join(dir, 'components.jsx'), 'utf8');
assert.equal(componentsSrc.includes('productPath'), true, 'cards usam productPath');
const checkoutSrc = fs.readFileSync(path.join(dir, 'pages/Checkout.jsx'), 'utf8');
assert.equal(checkoutSrc.includes('deliveryEta'), true, 'checkout ETA');

console.log('OK listing redirect + checkout copy');
