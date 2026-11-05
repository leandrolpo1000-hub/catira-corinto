# Catira — auditoria de desempenho (Fase 1)

**Data:** 2026-11-05
**Escopo:** somente leitura. Nenhum código, índice, schema ou dado foi alterado.
**Cenário citado:** lentidão com 100 usuários e 100 produtos (`ensureHeavyDemo` em `backend/src/seed.js`).
**Método:** inspeção de rotas, helpers, frontend e schema SQLite. Sem EXPLAIN de SQL relacional — o motor de leitura não usa SQL nas requisições.

---

## 1. Diagnóstico geral

O Catira é um processo Node único (`backend/src/server.js`, porta 3001) com **document store em memória** persistido no SQLite via `node:sqlite` `DatabaseSync`.

Evidência (`backend/src/db.js:102-135`, `161-171`, `261-277`):

- Uma tabela `records(table_name, id, json)` com `PRIMARY KEY (table_name, id)`.
- Boot: `SELECT table_name, json FROM records` carrega **todas** as linhas, `JSON.parse`, arrays em `cache`.
- `db.all` / `findById` / `findWhere` percorrem esses arrays. `findById` é `.find` linear.
- Não há pool, Postgres, Redis, Maps por id, nem `CREATE INDEX` além da PK.
- Tabelas protegidas (`orders`, `orderItems`, `orderEvents`, `checkoutSessions`, `userAddresses`) fazem `structuredClone` de **todas** as linhas em cada `all()`.

Consequência: na carga 100×100 o SQLite **não** é o gargalo. O custo é **CPU no event loop**: dezenas de varreduras O(n) por item serializado, listas admin sem paginação, e no frontend imagens originais + bundle único + fetch de tudo no `/admin`.

A vitrine pública **já pagina** o JSON (`page`/`limit`, máximo 48) depois de filtrar o conjunto publicado inteiro. Home já limita 8/6/5. Search/Catiras/Ação já têm “Ver mais”. O que falta é paginação nas rotas administrativas, favoritos, anúncios do usuário, chat, lance, ranking (cálculo completo) e um `serializeListing` que não varra 8–12 coleções por card.

Appmax, Pix EMV, VIP, `commercialReady` e import Mercado Livre **não** estão no caminho quente da vitrine. Não devem ser reescritos para “melhorar indicador”.

---

## 2. Os dez maiores gargalos (com evidência)

### 1. `serializeListing` — N+1 em memória em todo card

**Arquivo:** `backend/src/helpers.js:75-150`
**Problema:** cada anúncio dispara varreduras independentes:

| Chamada | Função | Coleção |
|---|---|---|
| `official.officialMetaOf(l)` | oficiais | `officialProducts` |
| `db.findById('users', l.userId)` | usuário | `users` |
| `categoryOf(l.categoryId)` | categoria | `categories` |
| `imagesOf(l.id)` | `helpers.js:20-24` | `listingImages` |
| `listingRating(l.id)` | `helpers.js:30-37` | `listingReviews` |
| `listingSocialOf(l.id)` | `helpers.js:65-67` | `listingLikes` + `listingComments` |
| `listingPayment(l.id)` **duas vezes** | `helpers.js:110-111`, `219-227` | `payments` |
| `db.count('favorites', …)` | `helpers.js:125` | `favorites` |
| `safeUser(user)` | `middleware.js:78` | `listings` de novo (`listingsCount`) |

Oficiais pulam rating/social (`helpers.js:82-87`) — correto. Demais cards pagam ~8–12 scans.

**Impacto:** GET `/api/listings` (Home 4 seções + Search 24 itens) multiplica isso. 100 anúncios × 10 scans ≈ milhares de `.filter`/`.find` por página. Com 100 concorrentes no mesmo event loop, a API fica CPU-bound.

**Solução (Fase 5, após aprovação):** índices em memória (`Map` id → registro; `Map` listingId → imagens/likes/reviews); `listingPayment` uma vez; `listingsCount` pré-agregado ou omitido na lista.

**Risco:** mudar o shape do JSON quebra cards. Preservar campos de `serializeListing`.

### 2. GET `/api/listings` filtra o catálogo inteiro antes do `slice`

**Arquivo:** `backend/src/routes/listings.js:200-246`
**Problema:** `db.findWhere('listings', published)` + `applyFilters`. Com `q=`, cada candidato faz `findById('categories')` e `findById('users')` (`listings.js:114-126`). Paginação só no JSON (`slice` nas linhas 235-238). Página 1 ainda chama `findSellers` (`listings.js:245`, `251-274`) — outro scan de listings + users.

**Impacto:** Home dispara 4 GETs desse tipo (`frontend/src/pages/Home.jsx:146-153`). Search 24 itens ainda serializa só o slice, mas o filtro passou por todos.

**Solução:** índice por `status`; haystack de busca pré-computado; `findSellers` só se `q` tiver ≥2 caracteres (já é o caso) e com Map de contagem.

**Risco:** ordem de boost/destaque/oficiais deve permanecer.

### 3. Admin carrega o mundo no mount

**Backend:** `GET /api/admin/users` (`admin.js:206-224`) — `db.all('users')` + `db.count('listings')` **por usuário**.
`GET /api/admin/listings` (`admin.js:247-255`) — todos os anúncios + `serializeListing`.
Idem publications, payments, reviews, reports, orders, ação — sem `page`/`limit`.

**Frontend:** `frontend/src/pages/Admin.jsx:109-145` dispara 11 GETs de lista para qualquer admin, +5 configs se master, + dashboard. Independente da aba. Tabelas fazem `.map` do array inteiro.

**Impacto:** um F5 em `/admin` na carga 100×100 é o burst mais caro do sistema (CPU backend + JSON + React). Escala linear sem teto.

**Solução:** paginar 20 no backend; buscar só a aba visível; não refetch 4 listas após um confirm de pagamento (`Admin.jsx:896-902`).

**Risco:** filtros client-side atuais (`Admin.jsx:162-210`) precisam virar query params.

### 4. Dashboard + Intelligence varrem todos os eventos

**Arquivos:** `backend/src/routes/admin.js:64-91` (`db.all` users/listings/payments/reports`); `backend/src/intelligence.js:452-476` (`db.all('intelligenceEvents')` + vários `.filter` por tipo). `intelligenceDaily` é escrito (`bumpDaily`) e **não lido** por `buildDashboard`.

**Frontend:** `period=all` existe em `AdminIntelligence.jsx`. Dashboard refetch a cada filtro (`Admin.jsx:147-150`).

**Impacto:** cada abertura do painel master reconstrói rankings/séries do zero. Demo já injeta eventos (`ensureDemoEvents` no boot, `server.js:40`).

**Solução:** usar `intelligenceDaily` para séries; limitar período default a 7d; não oferecer `all` sem teto; paginar rankings.

**Risco:** números do dashboard devem bater com o recorte atual. Preservar Inteligência (regra inegociável).

### 5. `rankedSellers` / `sellerScore` — N+1 aninhado

**Arquivo:** `backend/src/helpers.js:350-399`
Por usuário: todos os listings daquele user; por listing: `db.count('favorites')` + `listingRating` (scan de reviews). `rankOf` recalcula o ranking **inteiro** para achar uma posição (`helpers.js:397-399`).
Usado em GET `/api/ranking` e GET `/api/users/:id`.

**Impacto:** Home pede `limit=5` (`Home.jsx:153`) mas o backend pontua todos os vendedores antes do slice. Perfil público serializa todos os anúncios da pessoa sem paginar (`social.js` GET `/api/users/:id`).

**Solução:** score incremental no user ou cache curto invalidado em publish/sold/favorite; `rankOf` por Map.

**Risco:** fórmula de ranking é regra de produto — não alterar pesos sem autorização.

### 6. Imagens originais na vitrine, sem lazy

**Arquivos:** `frontend/src/components.jsx:458-464` (`ListingCard`: `<img src={img}>` = `item.images[0].url`); `styles.css` `.thumb { height: 124px }` — display ~124px, arquivo original. Sem `loading="lazy"`, `width`/`height`, `srcset`.
Home ~20 cards + Search 24 + banner + `BrandLogo` carrega light **e** dark.

**Impacto:** na carga 100 produtos (seed baixa Unsplash ou stub), o LCP da Home/Search é rede+decode, não a API. 100 usuários simultâneos saturam banda e o event loop do static `/uploads`.

**Solução:** miniatura no upload (já existe `compressImage.js` no create); campo `thumbUrl`; `loading="lazy"` abaixo da dobra; dimensões no `<img>`.

**Risco:** PDPs ainda precisam da original. Não servir thumb no zoom.

### 7. Bundle único ~598 KB sem code splitting

**Arquivo:** `frontend/src/App.jsx:1-22` importa Admin, Checkout, Auction, Intelligence, Lance de forma síncrona. Vite sem `manualChunks`. `dist/assets/index-*.js` medido ~599–612 KB.

**Impacto:** visitante da Home paga parse de todo o admin. LCP e TBT pioram no mobile, independente do SQLite.

**Solução:** `React.lazy` por rota (Admin, Auction, Checkout, Lance). Sem biblioteca nova.

**Risco:** Suspense precisa de fallback; rotas atuais não podem mudar de path.

### 8. Chatty global: `/api/config` + notices a cada navegação

**Arquivos:** `frontend/src/config.jsx:31-70` — `useEffect(..., [loc.pathname])` refetch de config em **toda** troca de rota.
`frontend/src/components.jsx:30-46` — 2–3 GETs de notices a cada pathname se logado.

**Impacto:** 100 usuários navegando geram ruído constante. Config quase não muda.

**Solução:** buscar config uma vez por sessão (TTL 60s); notices com intervalo ou só no Layout mount + foco.

**Risco:** banner/taxas desatualizados por no máximo o TTL — aceitável.

### 9. GET listing grava view + evento de inteligência

**Arquivo:** `backend/src/routes/listings.js:471-486`
`db.update` incrementa `views`, depois `intelligence.trackEvent('view')` que chama `dedupeHit` — scan linear de `intelligenceEvents` (`intelligence.js:301-321`).

**Impacto:** 100 aberturas simultâneas de PDP = 100 upserts SQLite + 100 scans de eventos no mesmo processo. Amplificação de escrita no GET mais público depois da lista.

**Solução:** buffer de views (flush a cada N segundos); índice/hash de dedupe; não bloquear a resposta no persist do evento.

**Risco:** contagem de views e dashboard de Intelligence devem permanecer consistentes (atraso de segundos ok; perda não).

### 10. Listas autenticadas sem paginação (favoritos, mine, chat, lance)

| Rota | Arquivo | Evidência |
|---|---|---|
| GET `/api/listings/mine` | `listings.js:297+` | `items` sem slice |
| GET `/api/favorites` | `social.js:81-87` | serialize cada listing |
| GET `/api/conversations` | `social.js:237-263` | serializeListing + unread (scan messages) |
| GET `/api/conversations/:id` | `social.js` | **todas** as mensagens × reactions |
| GET `/api/lance/hub` | `lance.js` | `{ items, total: items.length }` |
| GET `/api/users/:id` | `social.js` | todos os published do user |

Frontend: `More.jsx`, `LanceHub.jsx` fazem `.map` sem janela.

**Impacto:** na demo 100 anúncios, um power user com muitos mine/favs já despeja dezenas de `serializeListing`. Chat cresce sem teto.

**Solução:** paginar 20 (favoritos/mine) e 15 (notices); chat cursor por `createdAt`; hub 20.

**Risco:** “Ver mais” precisa existir onde hoje a lista é única.

---

## 3. Arquivos envolvidos

| Camada | Arquivos |
|---|---|
| Store | `backend/src/db.js` |
| Serialização | `backend/src/helpers.js`, `backend/src/middleware.js` |
| Vitrine | `backend/src/routes/listings.js` |
| Admin | `backend/src/routes/admin.js`, `frontend/src/pages/Admin.jsx`, `AdminIntelligence.jsx`, `AdminAuctions.jsx`, `AdminLance.jsx`, `AdminOfficial.jsx` |
| Inteligência | `backend/src/intelligence.js` |
| Social/chat | `backend/src/routes/social.js`, `frontend/src/pages/More.jsx` |
| Lance | `backend/src/routes/lance.js`, `frontend/src/pages/LanceHub.jsx` |
| Auth | `backend/src/middleware.js`, `frontend/src/auth.jsx` |
| Home/Search | `frontend/src/pages/Home.jsx`, `Search.jsx`, `frontend/src/components.jsx`, `frontend/src/config.jsx` |
| App shell | `frontend/src/App.jsx`, `frontend/vite.config.js` |
| Seed 100×100 | `backend/src/seed.js` (`ensureHeavyDemo`) |
| Pedidos | `backend/src/orders.js` — `GET /api/orders` já 403; admin orders sem paginar |
| ML | `backend/src/meli.js` — import no request admin, sync 15 min off-path |

Não mexer sem necessidade comprovada: `appmax.js`, Pix EMV, `Pay.jsx`, VIP, `commercialReady`.

---

## 4. Consultas SQL problemáticas

Não há SQL de domínio. As únicas statements de produção (`db.js:123-135`):

```
INSERT ... ON CONFLICT DO UPDATE   -- persistência por linha (ok)
DELETE FROM records WHERE table_name=? AND id=?
SELECT table_name, json FROM records   -- dump completo no boot
SELECT COUNT(*) FROM records
SELECT/INSERT meta
DELETE FROM records                    -- rewrite-all em persist()/reset()
```

**Não existe** `SELECT *` de anúncios, `JOIN`, `WHERE json_extract`, `LIMIT`/`OFFSET` SQL, `EXPLAIN QUERY PLAN` útil para a API.

O equivalente a “consulta lenta” é:

```js
db.findWhere('listings', (l) => l.status === 'published')  // full scan
db.findById('users', id)                                    // .find no array
serializeListing(l)                                         // 8–12 scans
```

`PRAGMA journal_mode=WAL` e `busy_timeout=5000` já estão (`db.js:106-108`). Pool não se aplica a `DatabaseSync` de um processo.

---

## 5. Tabelas / acessos que precisam de índice

Índices SQL em JSON **não** aceleram o caminho atual, porque a leitura não passa pelo SQLite.

Prioridade: **índices em memória** no `cache` (Map), depois — só com plano aprovado — schema relacional.

| Acesso | Onde | Índice recomendado (memória primeiro) |
|---|---|---|
| listing por id | quase tudo | `Map` (hoje PK SQLite **não usada** em request) |
| listings `status=published` | GET `/api/listings` | lista/índice por status |
| listings por `userId` | mine, sellerScore, users/:id | `userId → [listingIds]` |
| `listingImages` por `listingId` | `imagesOf` | `listingId → images` |
| likes/comments/reviews/favorites por `listingId` | serializeListing | idem |
| payments por `listingId` | `listingPayment` | idem |
| users por `email` | login | Map email |
| orders por `appmaxOrderId` | webhook | Map (volume baixo hoje) |
| intelligenceEvents dedupe | `dedupeHit` | chave `(type, actorHash, listingId)` recente |
| messages por `conversationId` | chat | `conversationId → messages` |

Não criar índices “por precaução”. Só os justificados pelas rotas acima.

---

## 6. Componentes frontend que precisam de otimização

| Componente | Problema | Evidência |
|---|---|---|
| `Admin.jsx` | 11–16 GETs no mount; tabelas sem janela | `:109-145` |
| `ListingCard` / `ListingRow` | img original, sem lazy | `components.jsx:458-464` |
| `Home.jsx` | 6 GETs paralelos + poll 20s leilão | `:146-163` |
| `Search.jsx` | `apply()` no `onChange` de preço → refetch a cada tecla | `:195-196` |
| `ConfigProvider` | refetch `/api/config` por pathname | `config.jsx:70` |
| `Layout` | notices por pathname | `components.jsx:30-46` |
| `App.jsx` | imports eager | `:1-22` |
| `More.jsx` Favorites/Mine/Chat | listas sem limite | maps locais |
| `LanceHub.jsx` | hub/mine/seller sem limite | |
| `AdminAuctions` / `AdminLance` / `AdminOfficial` | listas admin sem page | |
| Checkout | poll 8s — aceitável; cart e delivery refetch o listing | |

Já ok: Search/Catiras/Ação paginados; Home com `limit`; `loading="lazy"` só em Auction card e chat image; compressão no **upload** (`compressImage.js`).

Não introduzir React.memo/useCallback sem medição. Não introduzir lib de virtualização até a lista visível passar de ~200 linhas (admin).

Skeleton: hoje é texto `"Carregando..."`. Estrutura da Home pode pintar antes dos 6 GETs.

---

## 7. Plano de implementação priorizado (não executar agora)

Ordem pensada para o cenário 100×100 e para não tocar pagamento/ML.

1. **Medir baseline** no ambiente documentado (P50/P95 de `GET /api/listings`, `GET /api/admin/listings`, Home LCP, contagem de scans por request se possível). Sem isso, “melhorou” é chute.
2. **Maps por id + índices listingId** em `db.js` / helpers — maior ganho de CPU por linha, sem mudar API.
3. **Paginar admin** (20) e deixar o frontend pedir só a aba ativa.
4. **Thumbnails + lazy** na vitrine (não originais no card).
5. **Code splitting** das rotas pesadas.
6. **Parar refetch de config/notices por pathname**; debounce do preço na Search.
7. **Paginar mine/favorites/conversations/lance/users/:id**.
8. **Ranking/score**: cache curto ou agregado; não recalcular o mundo para `limit=5`.
9. **Views + intelligence**: não persistir no meio do GET; usar daily já escrito.
10. **Laboratório sintético + carga** (Fases 3–4 do pedido) **depois** dos itens 2–4, para comparar.

Fora desta ordem, de propósito: Appmax, webhook, Pix, VIP, import ML, `commercialReady`.

---

## 8. Riscos de regressão

| Mudança | Risco |
|---|---|
| Paginar admin | telas que assumem `items.length === total` |
| Maps no `db` | mutação in-place vs clone das tabelas protegidas |
| Tirar scans de `serializeListing` | campos `favoritesCount`, `paymentStatus`, `seller.listingsCount` somem ou ficam stale |
| Cache de ranking | pontuação diverge após venda/favorito |
| Buffer de views | dashboard Intelligence atrasado |
| Thumbnails | PDP/zoom com imagem errada; oficiais/ML URLs externas |
| Lazy config | banner/taxas velhos por um TTL |
| Debounce Search | teste que espera refetch síncrono no onChange |
| Code split | flash de Suspense; testes de grep de imports |

Regras a preservar: `GET /api/orders` 403; client não envia preço; oficiais fora das seções editoriais Home; Inteligência interna no dashboard; Appmax card `name=` intacto.

---

## 9. Estratégia de testes

**Já existe (usar, não substituir):**

- `frontend`: `node --test src/*.test.mjs` (masks, checkout, appmaxCard, catiraOffer, intelligence, officialProduct, searchLayout) + `npm run build`
- Backend: `listings` search tests, `intelligence.test.js`, `seed.heavy.test.js` (100 users / 100 listings), orders/appmax tests

**Não usar como gate desta auditoria:** `npm test` completo — Vosk pré-existente quebra; `chat.test.js` Maria ausente no DB persistido.

**Quando implementar (Fase 5):**

- Testes de contrato: `GET /api/listings` ainda devolve `total`, `page`, `limit`, `items`.
- Admin: `page`/`limit` default 20; `total` separado.
- `serializeListing`: mesmos campos em fixture de 1 listing.
- Search: debounce não quebra `searchLayout.test.mjs`.
- Seed 100×100 permanece idempotente e identificável (`demo.user.*`, `demo-heavy`).

**Carga (Fase 4, ambiente isolado):** 10/25/50/100 VUs. Medir API vs LCP separado. Metas pedidas (P95 leitura simples &lt; 300 ms, complexa &lt; 700 ms, LCP &lt; 2,5 s) só valem no ambiente documentado.

---

## 10. Estimativa de impacto esperado

Sem medição de wall-clock nesta Fase 1 (proibido alterar/rodar carga destrutiva). Ordem de grandeza qualitativa na carga 100×100:

| Intervenção | Efeito esperado |
|---|---|
| Maps + índices listingId | maior redução de CPU por GET de lista; P95 de `/api/listings` deve cair de “varreduras × items” para “filtro + serialize barato” |
| Paginar admin + fetch por aba | elimina o pior burst; admin deixa de ser O(todos os registros) no browser |
| Thumbs + lazy | maior ganho de LCP percebido na Home/Search (hoje bound em imagem, não em JSON de 24 cards) |
| Code split | menor JS na primeira visita (hoje ~600 KB um chunk) |
| Config/notices TTL | menos QPS inútil; pouco efeito em um único page load |
| Ranking cache | Home `limit=5` deixa de pontuar 100 vendedores |
| Buffer de views | menos writes no GET PDP sob concorrência |

**Veredito honesto 100×100:** arrays de 100 linhas são pequenos; um único browser pode parecer “ok”. A lentidão relatada combina (a) **vitrine com fotos cheias**, (b) **Home = 6 APIs + serializeListing caro**, (c) **admin/dashboard se alguém abriu o painel**, (d) **um único event loop** para API + static + ticks de leilão (5s) e lance (15s). Não é “falta um LIMIT no SQL”. É o modelo documento + N+1 em JS + frontend que pede demais.

Não iniciar implementação até autorização explícita.
