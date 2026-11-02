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
