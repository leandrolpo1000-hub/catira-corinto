# Search Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na aba Buscar, manter o mosaico e acrescentar um modo feed Instagram (foto 1:1, like, comentário, preço, Ver anúncio e sino de avisos).

**Architecture:** Espelhar o social do Em Ação em anúncios (`listingLikes`, `listingComments`, `listingCommentLikes`, `listingNotifications`) num módulo `listingSocial.js`. O serialize da listagem passa a incluir `liked` / counts. A UI de Buscar troca mosaico/feed por ícones no topo; a folha de comentários vira componente compartilhado.

**Tech Stack:** Node (Express, db.json), React 18, Vite, react-router-dom, lucide-react. Testes com `node src/*.test.js` (assert).

## Global Constraints

- Não alterar o mosaico atual (`.grid` + `ListingCard`) além do toggle.
- Sino de avisos só no modo feed; avisos em `/buscar/avisos`, separados de `/em-acao/avisos`.
- Preferência de vista em `localStorage` chave `catira.searchView` (`grid` | `feed`); padrão `grid`.
- Comentário: 1–240 chars; bloquear preço e contato (reusar `action.looksLikePrice` / `looksLikeContact`).
- Rotas `GET/POST /api/listings/notices*` **antes** de `GET /:id`.
- Não commitar `backend/data/`, `.github-token` nem secrets.
- Não commitar a menos que o usuário peça; os passos de commit abaixo são opcionais nesta sessão.

---

### Task 1: Social do anúncio (backend + testes)

**Files:**
- Create: `backend/src/listingSocial.js`
- Create: `backend/src/listingSocial.test.js`
- Modify: `backend/src/db.js` (coleções vazias)
- Modify: `backend/src/helpers.js` (`serializeListing` + export)

**Interfaces:**
- Consumes: `db`, `safeUser`, `isAdminRole`, `timeAgo`, `action.looksLikePrice`, `action.looksLikeContact`
- Produces:
  - `toggleLike(user, listingId) -> serialized listing`
  - `listComments(listingId, viewerId) -> comment[]`
  - `addComment(user, listingId, text, parentId?) -> comment`
  - `toggleCommentLike(user, listingId, commentId) -> comment`
  - `deleteComment(user, listingId, commentId) -> { ok, id }`
  - `listNotifications(user) -> { items, unread }`
  - `markNotificationsRead(user) -> { ok: true }`
  - Comment shape: `{ id, listingId, parentId, text, createdAt, timeAgo, userId, author, likeCount, liked }`
  - Listing extra fields: `likeCount: number`, `commentCount: number`, `liked: boolean`

- [ ] **Step 1: Write the failing test**

Create `backend/src/listingSocial.test.js`:

```js
const assert = require('assert');
const db = require('./db');
const helpers = require('./helpers');
const social = require('./listingSocial');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function cleanup(ids) {
  (ids.listings || []).forEach((id) => {
    db.findWhere('listingLikes', (i) => i.listingId === id).forEach((i) => db.remove('listingLikes', i.id));
    db.findWhere('listingComments', (i) => i.listingId === id).forEach((c) => {
      db.findWhere('listingCommentLikes', (l) => l.commentId === c.id).forEach((l) => db.remove('listingCommentLikes', l.id));
      db.remove('listingComments', c.id);
    });
    db.findWhere('listingNotifications', (i) => i.listingId === id).forEach((i) => db.remove('listingNotifications', i.id));
    db.remove('listings', id);
  });
}

function run() {
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  assert.ok(joao && maria, 'usuários demo');
  const cat = db.findOne('categories', () => true);
  const now = new Date().toISOString();
  const listing = db.insert('listings', {
    userId: joao.id,
    title: '[TESTE] Feed busca geladeira',
    description: 'Item de teste do feed de busca.',
    categoryId: cat.id,
    subcategory: '',
    price: 800,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    acceptsTrade: false,
    acceptsCash: true,
    tradeWishes: '',
    status: 'published',
    featured: false,
    vip: false,
    premium: false,
    views: 0,
    createdAt: now,
    publishedAt: now,
  });
  const ids = { listings: [listing.id] };
  try {
    const row = helpers.serializeListing(listing, { userId: maria.id, user: maria });
    assert.strictEqual(row.likeCount, 0);
    assert.strictEqual(row.commentCount, 0);
    assert.strictEqual(row.liked, false);

    const liked = social.toggleLike(maria, listing.id);
    assert.strictEqual(liked.liked, true);
    assert.strictEqual(liked.likeCount, 1);
    const notices = social.listNotifications(joao);
    assert.ok(notices.items.find((n) => n.type === 'like' && n.listingId === listing.id));
    const selfLike = social.toggleLike(joao, listing.id);
    assert.strictEqual(selfLike.liked, true);
    assert.ok(!social.listNotifications(joao).items.find((n) => n.type === 'like' && n.actor && n.actor.id === joao.id));
    social.toggleLike(joao, listing.id);

    const comment = social.addComment(maria, listing.id, 'Parabéns, item top da busca.');
    assert.ok(comment.id);
    assert.strictEqual(social.listComments(listing.id, maria.id).length, 1);
    assert.ok(social.listNotifications(joao).items.find((n) => n.type === 'comment'));

    const likedComment = social.toggleCommentLike(joao, listing.id, comment.id);
    assert.strictEqual(likedComment.liked, true);
    assert.strictEqual(likedComment.likeCount, 1);

    const reply = social.addComment(joao, listing.id, 'Valeu, deu certo.', comment.id);
    assert.strictEqual(reply.parentId, comment.id);

    social.deleteComment(maria, listing.id, comment.id);
    assert.strictEqual(social.listComments(listing.id).length, 0);

    const again = social.addComment(maria, listing.id, 'Ficou bom demais o anúncio.');
    social.deleteComment(joao, listing.id, again.id);
    assert.strictEqual(social.listComments(listing.id).length, 0);

    try {
      social.addComment(maria, listing.id, 'Me chama no 31988887777');
      throw new Error('contato deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }
    try {
      social.addComment(maria, listing.id, 'Foi R$ 500,00');
      throw new Error('preço deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }
  } finally {
    cleanup(ids);
  }
  console.log('OK listing social tests');
}

run();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/listingSocial.test.js`

Expected: FAIL (`Cannot find module './listingSocial'`).

- [ ] **Step 3: Add empty collections in `backend/src/db.js`**

Inside `EMPTY`, after `actionNotifications: []`:

```js
  listingLikes: [],
  listingComments: [],
  listingCommentLikes: [],
  listingNotifications: [],
```

- [ ] **Step 4: Implement `backend/src/listingSocial.js`**

Copy the Em Ação pattern. Use `publishedListing(id)` (status `published` only). Comment timeAgo compact (`3min`, `2h`, `1d`). Do not notify when `actor.id === owner.id`. If reply target has `parentId`, nest on the root. Deleting a root comment also deletes replies and their likes.

```js
const db = require('./db');
const { safeUser, isAdminRole } = require('./middleware');
const { timeAgo } = require('./helpers');
const { looksLikePrice, looksLikeContact } = require('./action');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function commentTimeAgo(iso) { /* same as action.commentTimeAgo */ }

function publishedListing(id) {
  const listing = db.findById('listings', id);
  if (!listing || listing.status !== 'published') throw httpError(404, 'Anúncio não encontrado.');
  return listing;
}

function serializeComment(c, viewerId) { /* listingId, parentId, author, likeCount, liked */ }

function socialOf(listingId, viewerId) {
  const likes = db.findWhere('listingLikes', (l) => l.listingId === listingId);
  const comments = db.findWhere('listingComments', (c) => c.listingId === listingId);
  return {
    likeCount: likes.length,
    commentCount: comments.length,
    liked: viewerId ? likes.some((l) => l.userId === viewerId) : false,
  };
}

function notifyOwner(listing, type, actor, text) {
  if (!listing || !actor || listing.userId === actor.id) return null;
  return db.insert('listingNotifications', {
    userId: listing.userId,
    type,
    listingId: listing.id,
    actorId: actor.id,
    text: String(text || '').slice(0, 240),
    read: false,
    createdAt: new Date().toISOString(),
  });
}

function toggleLike(user, listingId) { /* insert/remove listingLikes; notify type like */ }
function listComments(listingId, viewerId) { /* sort createdAt asc */ }
function addComment(user, listingId, raw, parentId) {
  const text = String(raw || '').trim().slice(0, 240);
  if (text.length < 1) throw httpError(400, 'Escreva um comentário.');
  if (looksLikePrice(text)) throw httpError(400, 'Não informe preço no comentário.');
  if (looksLikeContact(text)) throw httpError(400, 'Não informe telefone, e-mail ou WhatsApp no comentário.');
  /* parentId nests on root; notify owner comment; notify reply author type reply if not owner and not self */
}
function toggleCommentLike(user, listingId, commentId) { /* notify comment author type comment_like if not self */ }
function deleteComment(user, listingId, commentId) {
  /* owner of listing OR comment author OR admin; cascade replies + likes */
}
function listNotifications(user) { /* newest 80; include actor, timeAgo, unread */ }
function markNotificationsRead(user) { /* set read true */ }

module.exports = {
  socialOf,
  toggleLike,
  listComments,
  addComment,
  toggleCommentLike,
  deleteComment,
  listNotifications,
  markNotificationsRead,
};
```

Keep function bodies aligned with `backend/src/action.js` lines 102–458, swapping collection names (`actionPost*` → `listing*`, `postId` → `listingId`, `publishedPost` → `publishedListing`).

- [ ] **Step 5: Patch `serializeListing` in `backend/src/helpers.js`**

After `const rating = listingRating(...)` add:

```js
const social = require('./listingSocial').socialOf(l.id, opts.userId);
```

On `base`, after `favoritesCount`:

```js
    likeCount: social.likeCount,
    commentCount: social.commentCount,
    liked: social.liked,
```

Do **not** require `listingSocial` at the top of `helpers.js` if that creates a cycle (`listingSocial` already requires `helpers` for `timeAgo`). Use inline `require('./listingSocial').socialOf` inside the function, or move `timeAgo` require in listingSocial to a lazy call. Preferred: in `listingSocial.js` require only `db` + middleware + action; duplicate a 10-line `timeAgo` compact helper locally and a full `timeAgo` copy for notices, **or** require `./helpers` only inside `listNotifications`. Avoid circular init.

Safest: put `socialOf` in `listingSocial.js` and in `serializeListing` do:

```js
function listingSocialOf(listingId, viewerId) {
  const likes = db.findWhere('listingLikes', (x) => x.listingId === listingId);
  const comments = db.findWhere('listingComments', (c) => c.listingId === listingId);
  return {
    likeCount: likes.length,
    commentCount: comments.length,
    liked: viewerId ? likes.some((x) => x.userId === viewerId) : false,
  };
}
```

Keep this tiny helper in `helpers.js` (no extra require). Export nothing extra. `listingSocial.js` can export its own `socialOf` that does the same, or just not export it.

- [ ] **Step 6: Run tests**

Run: `cd /workspace/backend && node src/listingSocial.test.js`

Expected: `OK listing social tests`

Also run: `cd /workspace/backend && node src/action.test.js`

Expected: `OK action tests`

---

### Task 2: Rotas HTTP

**Files:**
- Modify: `backend/src/routes/listings.js`

**Interfaces:**
- Consumes: `listingSocial` functions from Task 1
- Produces HTTP:
  - `GET /api/listings/notices` authRequired → `{ items, unread }`
  - `POST /api/listings/notices/read` authRequired → `{ ok: true }`
  - `POST /api/listings/:id/like` authRequired → serialized listing
  - `GET /api/listings/:id/comments` authOptional → `{ items }`
  - `POST /api/listings/:id/comments` authRequired body `{ text, parentId? }` → 201 comment
  - `POST /api/listings/:id/comments/:commentId/like` authRequired → comment
  - `DELETE /api/listings/:id/comments/:commentId` authRequired → `{ ok, id }`

- [ ] **Step 1: Insert routes BEFORE `router.get('/:id', ...)`** (today around line 298)

At top of file, add:

```js
const listingSocial = require('../listingSocial');
```

After `router.get('/premium-days', ...)` (and any other static paths), add:

```js
router.get('/notices', authRequired, (req, res) => {
  res.json(listingSocial.listNotifications(req.user));
});

router.post('/notices/read', authRequired, (req, res) => {
  res.json(listingSocial.markNotificationsRead(req.user));
});

router.post('/:id/like', authRequired, (req, res) => {
  try {
    res.json(listingSocial.toggleLike(req.user, req.params.id));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
  }
});

router.get('/:id/comments', authOptional, (req, res) => {
  try {
    res.json({ items: listingSocial.listComments(req.params.id, req.user && req.user.id) });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
  }
});

router.post('/:id/comments', authRequired, (req, res) => {
  try {
    const b = req.body || {};
    const comment = listingSocial.addComment(req.user, req.params.id, b.text, b.parentId);
    res.status(201).json(comment);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
  }
});

router.post('/:id/comments/:commentId/like', authRequired, (req, res) => {
  try {
    res.json(listingSocial.toggleCommentLike(req.user, req.params.id, req.params.commentId));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
  }
});

router.delete('/:id/comments/:commentId', authRequired, (req, res) => {
  try {
    res.json(listingSocial.deleteComment(req.user, req.params.id, req.params.commentId));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
  }
});
```

Do not place these after `router.get('/:id')`. `notices` would 404 as listing id.

- [ ] **Step 2: Smoke the module still loads**

Run: `cd /workspace/backend && node -e "require('./src/routes/listings'); console.log('ok')"`

Expected: `ok`

---

### Task 3: Folha de comentários compartilhada

**Files:**
- Create: `frontend/src/CommentsSheet.jsx`
- Modify: `frontend/src/pages/Action.jsx` (usar o compartilhado)

**Interfaces:**
- Consumes: `api`, `Ico`, `useNavigate`
- Produces: `<CommentsSheet subject={ { id, author } } user={user} base={'/api/listings/' + id} loginNext="/buscar" onClose={fn} onChange={fn} />`
  - `base` without trailing slash
  - `subject.author` used for owner check (`user.id === subject.author.id`)
  - `onChange(nextSubject)` with updated `commentCount`

- [ ] **Step 1: Move the current CommentsSheet**

Copy `COMMENT_EMOJIS`, `nestComments` and `CommentsSheet` from `frontend/src/pages/Action.jsx` (from the `COMMENT_EMOJIS` const through the end of `CommentsSheet`) into `frontend/src/CommentsSheet.jsx`.

Replace hardcoded `/api/acao/` + `post.id` with `base`:

- GET `base + '/comments'`
- POST `base + '/comments'`
- POST `base + '/comments/' + id + '/like'`
- DELETE `base + '/comments/' + id`
- `nav('/entrar?next=' + loginNext)`
- Owner: `user && subject.author && user.id === subject.author.id`
- `onChange({ ...subject, commentCount: n })`

Export `CommentsSheet`. Keep the same CSS classes (`acao-sheet*`, `acao-cmt*`).

- [ ] **Step 2: Wire Action.jsx**

Remove local `CommentsSheet` / helpers. Import:

```js
import { CommentsSheet } from '../CommentsSheet';
```

Usage:

```jsx
<CommentsSheet
  subject={{ id: openPost.id, author: openPost.author, commentCount: openPost.commentCount }}
  user={user}
  base={'/api/acao/' + openPost.id}
  loginNext="/em-acao"
  onClose={() => setOpenPost(null)}
  onChange={patchPost}
/>
```

`patchPost` already replaces by `id`; ensure `onChange` still receives an object with `id`.

- [ ] **Step 3: Visual check**

No automated frontend test. Confirm Action.jsx still compiles (no leftover `CommentsSheet` function).

---

### Task 4: Ícones + card de feed + CSS

**Files:**
- Modify: `frontend/src/icons.jsx`
- Modify: `frontend/src/components.jsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `ListingCard` style fields, `priceText`, `PhotoGallery`, `Ico`, `api`
- Produces:
  - `Ico name="grid"` (LayoutGrid), `Ico name="rows"` (Rows3)
  - `export function ListingFeedCard({ item, user, onChange, onOpenComments, onReport })`

- [ ] **Step 1: Icons**

In `frontend/src/icons.jsx` add lucide `LayoutGrid, Rows3` to the import and:

```js
  grid: LayoutGrid,
  rows: Rows3,
```

- [ ] **Step 2: `ListingFeedCard` in `frontend/src/components.jsx`**

Place after `ListingCard`. Structure mirrors `ActionPostCard`:

```jsx
export function ListingFeedCard({ item, user, onChange, onOpenComments, onReport }) {
  if (!item) return null;
  const seller = item.seller;
  const liked = !!item.liked;
  const [menu, setMenu] = useState(false);
  const [openCap, setOpenCap] = useState(false);
  const nav = useNavigate();
  const title = String(item.title || '');
  const longCap = title.length > 110;
  const shown = openCap || !longCap ? title : title.slice(0, 110).trim();

  async function like() {
    if (!user) { nav('/entrar?next=/buscar'); return; }
    try {
      const next = await api('/api/listings/' + item.id + '/like', { method: 'POST' });
      onChange && onChange(next);
    } catch {}
  }

  return (
    <article className="acao-ig">
      <header className="acao-ig-head">
        {seller ? (
          <Link to={'/usuario/' + seller.id} className="acao-ig-user">
            <span className="acao-ig-ring">
              <span className="avatar sm" style={{ background: seller.avatarColor }}>{(seller.name || '?').slice(0, 1)}</span>
            </span>
            <span>
              <strong>{seller.name}</strong>
              <em>{item.city || seller.city || 'Corinto'}</em>
            </span>
          </Link>
        ) : <span>Anunciante</span>}
        {onReport && (
          <button type="button" className="acao-ig-more" onClick={() => setMenu((v) => !v)} aria-label="Mais opções">
            <Ico name="more" size={22} />
          </button>
        )}
        {menu && (
          <div className="acao-ig-menu">
            <button type="button" onClick={() => { setMenu(false); onReport(item); }}>Denunciar</button>
          </div>
        )}
      </header>
      {item.images && item.images.length > 0 && (
        <PhotoGallery images={item.images} alt={item.title} size="feed" onDoubleTap={like} />
      )}
      <div className="acao-ig-actions">
        <button type="button" className={'acao-ig-btn' + (liked ? ' on' : '')} onClick={like} aria-pressed={liked} aria-label={liked ? 'Descurtir' : 'Curtir'}>
          <Ico name="heart" size={26} stroke={1.7} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="acao-ig-btn" onClick={() => onOpenComments && onOpenComments(item)} aria-label="Comentar">
          <Ico name="chat" size={26} stroke={1.7} />
        </button>
      </div>
      {!!item.likeCount && <p className="acao-ig-likes">{item.likeCount === 1 ? '1 curtida' : item.likeCount + ' curtidas'}</p>}
      <p className="acao-ig-cap">
        {seller && <Link to={'/usuario/' + seller.id}>{seller.name}</Link>}
        {' '}{shown}{longCap && !openCap ? '... ' : ' '}
        {longCap && !openCap && (
          <button type="button" className="acao-ig-more-text" onClick={() => setOpenCap(true)}>mais</button>
        )}
      </p>
      <p className="acao-ig-price">{priceText(item)}</p>
      <Link to={'/anuncio/' + item.id} className="acao-ig-view-ad">Ver anúncio</Link>
      {!!item.commentCount && (
        <button type="button" className="acao-ig-view" onClick={() => onOpenComments && onOpenComments(item)}>
          Ver {item.commentCount === 1 ? '1 comentário' : 'todos os ' + item.commentCount + ' comentários'}
        </button>
      )}
      <p className="acao-ig-time">{item.timeAgo}</p>
      <button type="button" className="acao-ig-add" onClick={() => onOpenComments && onOpenComments(item)}>
        Adicione um comentário...
      </button>
    </article>
  );
}
```

Need `useState` (already imported), `useNavigate` (already imported), `api` and `priceText` from `./api` — add `api` to the existing api import in `components.jsx`.

- [ ] **Step 3: CSS**

Append near other `.acao-ig*` rules:

```css
.acao-ig-price {
  padding: 0 14px;
  font-size: 18px;
  font-weight: 800;
  color: var(--brand);
}
.acao-ig-view-ad {
  display: block;
  margin: 8px 14px 4px;
  text-align: center;
  background: var(--ink);
  color: var(--on-ink);
  border-radius: 999px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
}
.search-view-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0;
}
.search-view-toggle button {
  width: 40px; height: 40px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--muted);
}
.search-view-toggle button.on { color: var(--ink); }
```

Reuse `.acao-bell` already in `styles.css` for the sino.

---

### Task 5: Página Buscar (toggle, feed, avisos, rota)

**Files:**
- Modify: `frontend/src/pages/Search.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components.jsx` only if extra exports needed (`CityChip` already exported)

**Interfaces:**
- Consumes: `ListingFeedCard`, `CommentsSheet`, `Ico`, `api('/api/listings/notices')`
- Produces: `/buscar` dual view; `/buscar/avisos`

- [ ] **Step 1: Search.jsx state**

```js
const VIEW_KEY = 'catira.searchView';
function readView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'feed' ? 'feed' : 'grid';
  } catch {
    return 'grid';
  }
}
```

State: `view` (init `readView()`), `openItem` (comments), `reportFor`, `unread`.

On view change:

```js
function setViewMode(next) {
  setView(next);
  try { localStorage.setItem(VIEW_KEY, next); } catch {}
}
```

Load unread when `user && view === 'feed'`:

```js
api('/api/listings/notices').then((d) => setUnread(d.unread || 0)).catch(() => setUnread(0));
```

- [ ] **Step 2: Top bar**

```jsx
<Top
  title="Buscar"
  back
  right={
    <>
      <div className="search-view-toggle">
        <button type="button" className={view === 'grid' ? 'on' : ''} aria-label="Mosaico" aria-pressed={view === 'grid'} onClick={() => setViewMode('grid')}>
          <Ico name="grid" size={22} />
        </button>
        <button type="button" className={view === 'feed' ? 'on' : ''} aria-label="Feed" aria-pressed={view === 'feed'} onClick={() => setViewMode('feed')}>
          <Ico name="rows" size={22} />
        </button>
      </div>
      {view === 'feed' && (
        <Link to={user ? '/buscar/avisos' : '/entrar?next=/buscar/avisos'} className="acao-bell" aria-label="Avisos">
          <Ico name="bell" size={22} />
          {!!unread && <span>{unread > 9 ? '9+' : unread}</span>}
        </Link>
      )}
      <CityChip />
    </>
  }
/>
```

Import `Link`, `Ico`, `useAuth`, `ListingFeedCard`, `CityChip`, `CommentsSheet`.

Keep `SearchBox`, chips, filters, empty state, load more unchanged.

Results:

```jsx
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
```

`patchItem` maps `items` by `id`.

Comments:

```jsx
{openItem && (
  <CommentsSheet
    subject={{ id: openItem.id, author: openItem.seller, commentCount: openItem.commentCount }}
    user={user}
    base={'/api/listings/' + openItem.id}
    loginNext="/buscar"
    onClose={() => setOpenItem(null)}
    onChange={(next) => patchItem({ ...openItem, commentCount: next.commentCount })}
  />
)}
```

Report modal: copy the one in `Listing.jsx` / Action — `POST /api/reports` with `{ listingId, reason, description }` (existing social route). Reasons: golpe, falso, inadequado, enganoso, outro.

- [ ] **Step 3: `SearchNotices` export in the same file**

```jsx
export function SearchNotices() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user) return;
    api('/api/listings/notices').then((d) => setItems(d.items || [])).catch(() => {});
    api('/api/listings/notices/read', { method: 'POST' }).catch(() => {});
  }, [user]);
  if (!user) return <NeedAuth next="/buscar/avisos" />;
  return (
    <>
      <Top back title="Avisos" />
      <div className="page">
        <h1>Avisos dos anúncios</h1>
        {!items.length && <Empty title="Nenhum aviso" text="Quando alguém curtir ou comentar seu anúncio, aparece aqui." to="/buscar" cta="Ver busca" />}
        {items.map((n) => (
          <Link key={n.id} to="/buscar" className={'list-item acao-notice' + (n.read ? '' : ' unread')}>
            <span className="avatar sm" style={{ background: n.actor && n.actor.avatarColor }}>{((n.actor && n.actor.name) || '?').slice(0, 1)}</span>
            <div>
              <strong>{n.text}</strong>
              <p className="hint">{n.timeAgo}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
```

Import `NeedAuth` from `components` (already used in Action.jsx).

- [ ] **Step 4: Route**

In `frontend/src/App.jsx`:

```js
import Search, { SearchNotices } from './pages/Search';
```

Add **before** `path="*"`:

```jsx
<Route path="/buscar/avisos" element={<SearchNotices />} />
```

Keep `<Route path="/buscar" element={<Search />} />`.

---

### Task 6: Verificar e preview

**Files:** none new

- [ ] **Step 1: Backend tests**

Run: `cd /workspace/backend && node src/listingSocial.test.js && node src/action.test.js`

Expected: both OK.

- [ ] **Step 2: Restart preview**

Kill the current `start.sh` background terminal, then `bash /workspace/start.sh` via background terminal. Confirm Vite 5173 + API 3001. `request_preview` port 5173.

- [ ] **Step 3: Manual checklist**

- `/buscar` mosaico igual, ícones grade/lista no topo.
- Lista: um anúncio por vez, foto 1:1, preço, Ver anúncio.
- Like (toque e duplo toque), folha de comentários, Post, emojis, Responder.
- Recarregar a página mantém o modo feed.
- Sino só no feed; `/buscar/avisos` lista avisos.
- Conta demo: `joao@email.com` / `123456` e `maria@email.com` se existir.

---

## Spec coverage

| Spec | Task |
| Toggle ícones + localStorage | 5 |
| Mosaico intacto | 5 |
| Feed IG + preço + Ver anúncio | 4, 5 |
| Like/comentário/reply/delete | 1, 2, 3, 5 |
| Sino só no feed + `/buscar/avisos` | 5 |
| serializeListing social fields | 1 |
| Notices routes before `/:id` | 2 |
| Testes sociais | 1, 6 |

## Type consistency

- `listingId` (not `postId`) in listing collections.
- Comment `author` via `safeUser`; listing card uses `item.seller`.
- `CommentsSheet` `subject.author` = `openPost.author` (ação) or `item.seller` (busca).
- Storage key `catira.searchView`.
