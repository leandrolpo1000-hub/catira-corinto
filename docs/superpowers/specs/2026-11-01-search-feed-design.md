# Buscar: mosaico + feed Instagram

Data: 2026-11-01
Status: aprovado (aguardando revisão do usuário antes do plano)

## Objetivo

Na aba Buscar, manter o mosaico atual (grade de cards) e acrescentar um modo feed no formato Instagram, com like, comentário e avisos para o anunciante. A troca é por ícones no topo.

## Fora de escopo

- Não altera Início, Catiras nem a página do anúncio além de expor os novos campos sociais se já serializados.
- Não mistura avisos de anúncio com `/em-acao/avisos`.
- Não remove filtros, busca por voz, banner nem paginação.

## Comportamento

### Toggle no topo

- Em `/buscar`, à direita do título (antes da cidade/tema), dois ícones: grade (mosaico) e lista (feed).
- Padrão: mosaico.
- A escolha fica em `localStorage` (`catira.searchView` = `grid` | `feed`).
- Filtros, query e “Ver mais” são os mesmos nos dois modos.
- Sino de avisos só aparece no modo feed.

### Mosaico

- Igual ao atual: `.grid` + `ListingCard` (foto, badges, título, preço, cidade, Ver anúncio).

### Feed (anúncio em formato IG)

Um anúncio por vez, visual alinhado a `.acao-ig`:

1. Header: anel + nome do vendedor + cidade; menu ⋯ denuncia (reusa o fluxo já existente do anúncio, se o usuário estiver logado).
2. Foto 1:1 (`PhotoGallery` `size="feed"`). Toque duplo curte.
3. Ações: coração e comentário.
4. N curtidas.
5. Nome do vendedor + título (cortar ~110 chars com “mais”).
6. Preço em laranja (`priceText`), como no mosaico.
7. Botão/link Ver anúncio → `/anuncio/:id`.
8. “Ver N comentários”, hora (`timeAgo`), “Adicione um comentário…”.

Não replica áudio do Em Ação. Não esconde o rodapé (só `/em-acao` faz isso).

### Folha de comentários

Mesmo padrão da folha do Em Ação: lista, Responder, coração no comentário, “Ver respostas”, barra de emojis, avatar + “Adicione um comentário…” + Post. Dono do anúncio e autor do comentário podem excluir.

### Avisos

- Rota `/buscar/avisos`.
- Sino no topo do modo feed, com badge de não lidos.
- Lista: avatar do ator, texto, hora; marcar todos como lidos ao abrir.
- Sem login: sino leva a `/entrar?next=/buscar/avisos`.
- Tipos: like no anúncio, comentário, resposta, like no comentário.
- Não notifica o próprio autor da ação.

## Dados

Coleções novas em `db.js`:

- `listingLikes` `{ listingId, userId, createdAt }`
- `listingComments` `{ listingId, userId, parentId, text, createdAt }`
- `listingCommentLikes` `{ commentId, userId, createdAt }`
- `listingNotifications` `{ userId, type, listingId, actorId, text, read, createdAt }`

`serializeListing` passa a incluir `likeCount`, `commentCount`, `liked` (viewer).

Regras iguais às do Em Ação: login para like/comentar; texto 1–240; bloquear preço e contato no comentário; resposta aninha no comentário raiz; excluir comentário remove likes e respostas.

## APIs

- `POST /api/listings/:id/like`
- `GET /api/listings/:id/comments` (auth opcional)
- `POST /api/listings/:id/comments` body `{ text, parentId? }`
- `POST /api/listings/:id/comments/:commentId/like`
- `DELETE /api/listings/:id/comments/:commentId`
- `GET /api/listings/notices`
- `POST /api/listings/notices/read`

Rotas de notices antes de `/:id` para não colidir.

## UI / arquivos

- `frontend/src/pages/Search.jsx`: toggle, mosaico/feed, sino, `CommentsSheet` (extrair ou reusar a do Action).
- `frontend/src/components.jsx`: `Top` aceita os ícones à direita; `ListingFeedCard` (ou card local em Search).
- `frontend/src/App.jsx`: rota `/buscar/avisos`.
- `frontend/src/icons.jsx`: ícones de grade e lista (LayoutGrid / Rows3 ou equivalente Lucide já no projeto).
- `frontend/src/styles.css`: reuso de `.acao-ig*` / `.acao-sheet*` + ajustes de preço/Ver anúncio no feed.
- `backend/src/db.js`, `helpers.js`, `routes/listings.js`: social + serialize.
- Preferir extrair lógica social compartilhada com `action.js` só se não inflar o diff; duplicar o padrão do Em Ação é aceitável nesta entrega.

## Testes

Estender testes de listings (ou arquivo novo `listings.social.test.js`) cobrindo:

- like toggle e contagem
- comentário, reply (`parentId`), like no comentário
- exclusão pelo autor do comentário e pelo dono do anúncio
- bloqueio de preço/contato
- notificação não enviada ao próprio usuário
- serialize na listagem inclui `liked` / counts para o viewer

## Critério de pronto

- Em `/buscar`, mosaico intacto; ícones grade/lista no topo.
- Feed mostra anúncio 1:1 com preço, Ver anúncio, like e comentários.
- Sino no feed abre `/buscar/avisos` com badge.
- Preferência de vista persiste após recarregar.
- Testes sociais passam.
