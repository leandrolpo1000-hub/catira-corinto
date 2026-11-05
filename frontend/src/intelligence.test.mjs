import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const admin = readFileSync(join(root, 'pages/Admin.jsx'), 'utf8');
const intel = readFileSync(join(root, 'pages/AdminIntelligence.jsx'), 'utf8');
const api = readFileSync(join(root, 'api.js'), 'utf8');
const listing = readFileSync(join(root, 'pages/Listing.jsx'), 'utf8');
const checkout = readFileSync(join(root, 'pages/Checkout.jsx'), 'utf8');

assert.match(admin, /Catira Intelligence/);
assert.match(admin, /AdminIntelligence/);
assert.match(intel, /Configurações/);
assert.match(intel, /Visão geral/);
assert.match(intel, /Oportunidades/);
assert.match(intel, /internalAnalyticsEnabled/);
assert.match(intel, /Marcados vendidos/);
assert.doesNotMatch(intel, /commercialReady/);
assert.match(api, /X-Catira-Session/);
assert.match(api, /catira_sid/);
assert.match(listing, /\/share/);
assert.doesNotMatch(checkout, /status:\s*['"]paid['"]/);
console.log('intelligence.test.mjs ok');
