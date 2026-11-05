import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jsx = fs.readFileSync(path.join(dir, 'pages/Search.jsx'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');

assert.equal(jsx.includes('toolsOpen'), false, 'sem toolsOpen');
assert.equal(jsx.includes('lastScroll'), false, 'sem lastScroll');
assert.equal(jsx.includes('onBodyScroll'), false, 'sem onBodyScroll');
assert.equal(jsx.includes('bodyRef'), false, 'sem bodyRef');
assert.equal(jsx.includes('className="search-head"'), false, 'sem search-head');

const bodyIdx = jsx.indexOf('className="search-body"');
const topIdx = jsx.indexOf('className="search-top"');
const toolsIdx = jsx.indexOf('className="search-head-tools"');
const switchIdx = jsx.indexOf('className="search-view-switch"');
assert.ok(bodyIdx >= 0, 'tem search-body');
assert.ok(topIdx > bodyIdx, 'search-top dentro de search-body');
assert.ok(switchIdx > bodyIdx, 'toggle dentro de search-body');
assert.ok(toolsIdx > bodyIdx, 'tools dentro de search-body');

const filtersRule = css.match(/\.search-body\s+\.filters\s*\{[^}]*\}/);
assert.ok(filtersRule, 'filtros da Buscar sob .search-body');
assert.equal(/max-height\s*:\s*40vh/.test(filtersRule[0]), false, 'filtros sem max-height 40vh');
assert.equal(/overflow\s*:\s*auto/.test(filtersRule[0]), false, 'filtros sem overflow auto');
assert.equal(/\.search-head\s*\{/.test(css), false, 'sem bloco .search-head');

assert.equal(/PAGE_SIZE\s*=\s*24/.test(jsx), false, 'Search sem PAGE_SIZE 24');
assert.ok(/PAGE_SIZE\s*=\s*20|PAGE\.search/.test(jsx), 'Search PAGE_SIZE 20');
assert.ok(jsx.includes('setTimeout'), 'preço com debounce timeout');
assert.ok(/setTimeout\([\s\S]*?,\s*300\)/.test(jsx), 'debounce 300ms no preço');
assert.ok(/apply\(\{\s*minPrice,\s*maxPrice\s*\}\)/.test(jsx), 'debounce aplica minPrice e maxPrice juntos');
assert.equal(/apply\(\{\s*\[key\]:\s*value\s*\}\)/.test(jsx), false, 'debounce nao aplica so o ultimo campo');

const app = fs.readFileSync(path.join(dir, 'App.jsx'), 'utf8');
assert.ok(/\blazy\s*\(/.test(app), 'App usa React.lazy');
assert.ok(app.includes('Suspense'), 'App usa Suspense');
assert.ok(app.includes('Carregando...'), 'Suspense fallback Carregando...');
assert.ok(/lazy\(\(\)\s*=>\s*import\(['"]\.\/pages\/Admin['"]\)/.test(app), 'lazy Admin');
assert.ok(/lazy\(\(\)\s*=>\s*import\(['"]\.\/pages\/Checkout['"]\)/.test(app), 'lazy Checkout');
assert.ok(app.includes("import('./pages/Auction')") || app.includes('import("./pages/Auction")'), 'lazy Auction');
assert.ok(app.includes("import('./pages/LanceHub')") || app.includes('import("./pages/LanceHub")'), 'lazy LanceHub');
assert.ok(app.includes("import('./pages/Action')") || app.includes('import("./pages/Action")'), 'lazy Action');
assert.ok(app.includes("import('./pages/IntelligentCreate')") || app.includes('import("./pages/IntelligentCreate")'), 'lazy IntelligentCreate');
assert.ok(/import Home from ['"]\.\/pages\/Home['"]/.test(app), 'Home static');
assert.ok(/import Search/.test(app), 'Search static');
assert.ok(/import Listing from ['"]\.\/pages\/Listing['"]/.test(app), 'Listing static');
assert.ok(/from ['"]\.\/pages\/Auth['"]/.test(app), 'Auth static');
assert.ok(/import Profile/.test(app), 'Profile static');

const catiras = fs.readFileSync(path.join(dir, 'pages/Catiras.jsx'), 'utf8');
assert.equal(/PAGE_SIZE\s*=\s*24/.test(catiras), false, 'Catiras sem PAGE_SIZE 24');
assert.ok(/PAGE_SIZE\s*=\s*20|PAGE\.search/.test(catiras), 'Catiras PAGE_SIZE 20');

const config = fs.readFileSync(path.join(dir, 'config.jsx'), 'utf8');
assert.ok(config.includes('loadedAt'), 'ConfigProvider loadedAt');
assert.ok(/60_000|60000/.test(config), 'config TTL 60s');
assert.ok(config.includes('visibilitychange'), 'config visibilitychange');
assert.equal(config.includes('loc.pathname'), false, 'config sem loc.pathname');

const components = fs.readFileSync(path.join(dir, 'components.jsx'), 'utf8');
assert.ok(components.includes('setInterval'), 'notices interval');
assert.ok(/setInterval\([^,]+,\s*60000\)/.test(components), 'notices 60s');
assert.ok(/\[user,\s*auctionEnabled\]/.test(components), 'notices deps sem pathname');

const home = fs.readFileSync(path.join(dir, 'pages/Home.jsx'), 'utf8');
assert.ok(home.includes('skeleton'), 'Home skeleton class');
