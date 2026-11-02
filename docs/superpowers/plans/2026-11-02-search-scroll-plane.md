# Search Scroll Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na aba `/buscar`, chrome (logo, toggle, busca, chips, filtros) e resultados passam a viver no mesmo overflow e no mesmo fundo, sem auto-hide, para o flick não tremer nem voltar ao topo.

**Architecture:** `.search-body` vira o único scroller. O bloco `.search-head` some; o chrome vai para dentro de `.search-body`. Estado `toolsOpen` / `lastScroll` / `onBodyScroll` é apagado. CSS deixa de isolar o topo com borda e de criar scroll interno no painel de filtros.

**Tech Stack:** React 18, Vite, CSS do `frontend/src/styles.css`. Sem runner de componente; invariantes checadas com `node` + `assert` lendo o fonte. Verificação de scroll é manual.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-02-search-scroll-plane-design.md`
- Não muda API, ranking de oficiais, Início, Catiras nem a ficha do anúncio.
- Não muda o card do mosaico nem o card do feed.
- `VoiceFab` continua `position: fixed` acima da nav.
- Não deixa a barra sticky nem reimplementa auto-hide por transform.
- Não remove filtros, busca por voz, banner, paginação nem o toggle mosaico/feed.
- Chip Filtros continua controlando o painel via `open`; o painel expande o fluxo (sem `max-height: 40vh` / overflow próprio na Buscar).
- Não commitar `backend/data/`, `.github-token` nem secrets.
- Não commitar a menos que o usuário peça; os passos de commit abaixo são opcionais nesta sessão.

---

### Task 1: Chrome dentro do scroller, sem auto-hide

**Files:**
- Create: `frontend/src/searchLayout.test.mjs`
- Modify: `frontend/src/pages/Search.jsx`

**Interfaces:**
- Consumes: estado `open` (chip Filtros), `view` / `setViewMode`, `filters` / `apply`, `q` / `setQ`
- Produces: markup em que `search-top`, `search-view-switch`, `search-head-tools` e `.filters` ficam **dentro** de `search-body`; nenhum `toolsOpen`, `lastScroll`, `bodyRef` ou `onBodyScroll`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/searchLayout.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/src/searchLayout.test.mjs`

Expected: FAIL (`toolsOpen` ainda existe e/ou `search-top` aparece antes de `search-body`).

- [ ] **Step 3: Remove auto-hide e mover o chrome para `.search-body`**

In `frontend/src/pages/Search.jsx`:

1. Change the React import to drop `useRef`:

```js
import { useEffect, useState } from 'react';
```

2. Delete these three lines from the component body:

```js
const [toolsOpen, setToolsOpen] = useState(true);
const bodyRef = useRef(null);
const lastScroll = useRef(0);
```

3. Delete the entire `onBodyScroll` function.

4. Replace the returned `search-screen` tree (from `<div className="search-screen">` through the closing `search-body`) with chrome **inside** `search-body`. Keep `CommentsSheet`, `VoiceFab` and the report modal as siblings of `search-body` (not inside the scroller). The tools block is always mounted; the filters panel still depends only on `open`:

```jsx
  return (
    <div className="search-screen">
      <div className="search-body">
        <header className="search-top">
          <Link to="/" className="brand-link" aria-label="Início">
            <BrandLogo size="sm" />
          </Link>
          <div className="search-top-actions">
            <CityChip />
            <AccountButton />
          </div>
        </header>
        <div className="search-view-switch" role="tablist" aria-label="Modo de visualização">
          <button type="button" role="tab" className={view === 'grid' ? 'on' : ''} aria-selected={view === 'grid'} onClick={() => setViewMode('grid')}>
            <Ico name="grid" size={18} />
            Mosaico
          </button>
          <button type="button" role="tab" className={view === 'feed' ? 'on' : ''} aria-selected={view === 'feed'} onClick={() => setViewMode('feed')}>
            <Ico name="rows" size={18} />
            Feed
          </button>
        </div>
        <div className="search-head-tools">
          <SearchBox value={q} onChange={setQ} onSubmit={(term) => apply({ q: term })} />
          <div className="chips">
            <button className="chip" onClick={() => setOpen(!open)}>Filtros</button>
            {listingTypes.map((t) => (
              <button
                key={t.id}
                className={'chip' + (filters.type === t.id ? ' on' : '')}
                onClick={() => apply({ type: filters.type === t.id ? '' : t.id, sort: '' })}
              >
                {t.label}
              </button>
            ))}
            <button className={'chip' + (filters.sort === 'recent' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'recent' ? '' : 'recent', type: '' })}>Mais recentes</button>
            <button className={'chip' + (filters.sort === 'views' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'views' ? '' : 'views', type: '' })}>Mais vistos</button>
            <button className={'chip' + (filters.sort === 'price_asc' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'price_asc' ? '' : 'price_asc', type: '' })}>Menor preço</button>
            <button className={'chip' + (filters.sort === 'price_desc' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'price_desc' ? '' : 'price_desc', type: '' })}>Maior preço</button>
          </div>
        </div>
        {open && (
          <div className="filters">
            <div className="field">
              <label>Categoria</label>
              <select value={filters.category} onChange={(e) => apply({ category: e.target.value })}>
                <option value="">Todas</option>
                {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Cidade</label>
              <select value={filters.city} onChange={(e) => { setCity(e.target.value); apply({ city: e.target.value }); }}>
                <option value="">Todas</option>
                {cities.map((c) => <option key={c.id || c.name} value={c.name}>{c.name}{c.state ? '/' + c.state : ''}</option>)}
              </select>
            </div>
            <div className="grid2">
              <div className="field"><label>Preço mín.</label><input value={filters.minPrice} onChange={(e) => apply({ minPrice: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" /></div>
              <div className="field"><label>Preço máx.</label><input value={filters.maxPrice} onChange={(e) => apply({ maxPrice: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" /></div>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={filters.type} onChange={(e) => apply({ type: e.target.value, sort: '' })}>
                <option value="">Todos</option>
                {listingTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Condição</label>
              <select value={filters.condition} onChange={(e) => apply({ condition: e.target.value })}>
                <option value="">Qualquer</option>
                <option value="novo">Novo</option>
                <option value="seminovo">Seminovo</option>
                <option value="usado">Usado</option>
              </select>
            </div>
          </div>
        )}
        <HomeAdBanner />
        {!items.length && !loading && <Empty title="Nada por aqui" text="Tente outra busca ou categoria." />}
        {view === 'grid' ? (
          <div className="grid">
            {items.map((it) => <ListingCard key={it.id} item={it} />)}
          </div>
        ) : (
          <div className="search-feed">
            {items.map((it) => (
              <ListingFeedCard
                key={it.id}
                item={it}
                user={user}
                onChange={patchItem}
                onOpenComments={setOpenItem}
                onReport={user ? setReportFor : null}
              />
            ))}
          </div>
        )}
        {items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={loadMore}>
            {loading ? 'Carregando...' : 'Ver mais anúncios'}
          </button>
        )}
        {!!sellers.length && (
          <section className="search-sellers">
            <h2>Anunciantes</h2>
            <div className="search-sellers-list">
              {sellers.map((s) => (
                <Link key={s.id} to={'/usuario/' + s.id} className="search-seller">
                  <span className="avatar sm" style={{ background: s.avatarColor }}>{s.name.slice(0, 1)}</span>
                  <span className="search-seller-info">
                    <strong>{s.name}</strong>
                    <span className="hint">
                      {s.listingsCount} {s.listingsCount === 1 ? 'anúncio' : 'anúncios'}{s.city ? ' · ' + s.city : ''}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
```

Do not change `SearchNotices`, `CommentsSheet`, `VoiceFab` or the report modal.

- [ ] **Step 4: Run the JSX assertions — they should pass; CSS assertions still fail**

Run: `node frontend/src/searchLayout.test.mjs`

Expected after this task: FAIL still, but **only** on CSS (`sem bloco .search-head` / filtros). If `toolsOpen` or `search-top dentro de search-body` still fail, fix JSX before Task 2.

- [ ] **Step 5: Commit (optional)**

```bash
git add frontend/src/pages/Search.jsx frontend/src/searchLayout.test.mjs
git commit -m "fix: keep search chrome in the same scroller as results"
```

Skip unless the user asked to commit.

---

### Task 2: Mesmo plano visual (CSS)

**Files:**
- Modify: `frontend/src/styles.css` (blocos `.search-head*`, `.search-view-switch`, `.search-top`, `.search-body`)
- Test: `frontend/src/searchLayout.test.mjs` (já criado na Task 1)

**Interfaces:**
- Consumes: markup da Task 1 (`search-body` contém `search-top`, `search-view-switch`, `search-head-tools`, `.filters`)
- Produces: nenhum `.search-head { ... }`; `.search-body .filters` sem `max-height: 40vh` e sem `overflow: auto`; chrome com o mesmo `--bg` e sem `border-bottom` isolando o topo; padding horizontal do chrome alinhado ao padding de `.search-body` (16px), para o toggle não ficar com 32px de inset

- [ ] **Step 1: Confirm CSS assertions fail**

Run: `node frontend/src/searchLayout.test.mjs`

Expected: FAIL on `.search-head` still present and/or missing `.search-body .filters`.

- [ ] **Step 2: Replace the search layout CSS**

In `frontend/src/styles.css`, **delete** this entire block:

```css
.search-head {
  position: relative;
  flex-shrink: 0;
  z-index: 25;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}
.search-head-tools { padding: 0 16px 8px; }
.search-head-tools .chips { margin-top: 10px; }
.search-head .filters { margin: 0 16px 10px; max-height: 40vh; overflow: auto; }
```

**Insert** in the same place (still after `.search-screen`, before `.voice-fab`):

```css
.search-head-tools { padding: 0 0 8px; }
.search-head-tools .chips { margin-top: 10px; }
.search-body .filters { margin: 0 0 10px; }
```

Keep `.app:has(.search-screen)` and `.search-screen` unchanged (viewport travada; só `.search-body` rola). Keep `.search-body` padding:

```css
.search-body {
  flex: 1;
  overflow: auto;
  padding: 12px 16px calc(var(--nav-h) + var(--safe-b) + 8px);
  -webkit-overflow-scrolling: touch;
}
```

Update `.search-top` so it does not paint a second surface. Replace:

```css
.search-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 8px 16px;
  background: var(--bg);
}
```

with:

```css
.search-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 0 8px;
}
```

Update `.search-view-switch` margin so it does not double the 16px body padding. Replace:

```css
.search-view-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin: 0 16px 8px;
  padding: 3px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
}
```

with:

```css
.search-view-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin: 0 0 8px;
  padding: 3px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
}
```

Do not change `.filters { background: var(--paper); ... }` global (Admin ainda usa). Do not change `.voice-fab`. Do not add `position: sticky` on any search chrome.

- [ ] **Step 3: Run test to verify it passes**

Run: `node frontend/src/searchLayout.test.mjs`

Expected: exit 0, no assertion errors.

- [ ] **Step 4: Manual check on `/buscar`**

1. `/buscar` sem termo: um só scroll; barra e mosaico no mesmo fundo, sem linha separando o topo.
2. Busca com 1 resultado (ex.: `principia`): flick rápido e lento percorrem o card até o fim, sem tremer nem voltar ao topo.
3. Chip Filtros abre o painel no mesmo fluxo; a página não ganha um segundo overflow.
4. Toggle mosaico/feed, `VoiceFab` e “Ver mais” iguais.

- [ ] **Step 5: Commit (optional)**

```bash
git add frontend/src/styles.css frontend/src/searchLayout.test.mjs
git commit -m "fix: put search filters on the same visual plane as the feed"
```

Skip unless the user asked to commit.
