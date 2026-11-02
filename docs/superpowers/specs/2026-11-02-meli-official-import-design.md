# Fase 2B: importar ficha Mercado Livre como produto oficial

Data: 2026-11-02
Status: aprovado em conversa (aguardando revisão do arquivo antes do plano)

## Objetivo

Ligar a conta vendedora do Mercado Livre ao admin Catira, importar um anúncio MLB como produto oficial em rascunho e sincronizar de forma periódica a ficha (título, descrição, fotos) e a oferta externa. O preço comercial Catira continua decisão humana: o rascunho não entra na vitrine até o admin precificar e publicar.

## Fora de escopo

- Publicar, editar ou pausar anúncios no Mercado Livre (somente GET + OAuth).
- Webhook/notificações ML, lista da loja, User Products, variações por SKU.
- Pedidos, envios, perguntas, ads, faturamento, promoções.
- Shopee, Amazon, checkout interno Catira, gateway, scraping.
- Copiar imagens ML para `/uploads`.
- Usar variáveis do Agent (`MCAI_LLM_*`, `OPENAI_API_KEY`) ou imprimir Client Secret / tokens.

## Decisões travadas

- Caminho A: import pontual por URL/ID + poll. Sem webhook.
- Import cria rascunho: `published=false`, sem `manualPrice` e sem `costPrice`.
- Sync seguinte **sempre** reescreve título, descrição e fotos da ficha **e** a oferta ML.
- Sync **nunca** altera `manualPrice`, `costPrice`, margem, cobertura, `published`.
- Categoria Catira: mapeada no import; sync **não** reescreve (o admin pode ajustar).
- Mesmo `MLB…` de novo: reaproveita o produto já ligado (`meliItemId`), não duplica.
- Uma oferta `mercadolivre` por produto oficial (chave atual `productId` + `provider`).
- Fotos: até 8 `pictures[].secure_url` https; hotlink, sem download local.
- Estoque real só com token do dono; sem token, não gravar faixa pública como `stock`.
- Preço da oferta: `GET /items/{id}/sale_price?context=channel_marketplace`, não o campo `price` de `/items` (em descontinuação).

## Arquitetura

Módulo novo `backend/src/meli.js` (CommonJS), isolado de `official.js`:

- OAuth authorization_code + refresh.
- Cliente HTTP GET para `api.mercadolibre.com`.
- Parse de permalink/ID.
- Mapeamento item ML → payload de produto + oferta.
- Sem POST/PUT em `/items`.

`official.js` ganha:

- `meliItemId` no produto.
- `externalId` e `meliUserId` na oferta.
- `importFromMeli(itemId, actor)` e `syncMeliProduct(productId, actor)` reusando `createProduct` / `updateProduct` / `upsertOffer`, com as regras de rascunho e overwrite da ficha.

Rotas admin em `backend/src/routes/admin.js` (já `adminRequired`):

- `GET /api/admin/official/meli/status`
- `GET /api/admin/official/meli/connect` → URL de autorização
- `GET /api/admin/official/meli/callback` → troca code, redireciona ao admin
- `POST /api/admin/official/meli/disconnect`
- `POST /api/admin/official/meli/import` body `{ url }`
- `POST /api/admin/official/products/:id/meli/sync`

Poll: timer no processo Node (15 min) percorre produtos com `meliItemId`, um de cada vez, com backoff em 429. Sem fila extra. Sem callback público.

UI só em `frontend/src/pages/AdminOfficial.jsx`.

## Credenciais e OAuth

Env do **projeto** (nunca lidas do ambiente Agent, nunca logadas, nunca no frontend):

- `USER_MELI_CLIENT_ID`
- `USER_MELI_CLIENT_SECRET`
- `USER_MELI_REDIRECT_URI` (HTTPS, idêntica ao DevCenter)

Scopes: `read` + `offline_access`. Sem `write`.

Permissões DevCenter: Usuários (default) + Publicação e sincronização em **somente leitura**.

Fluxo:

1. Admin clica Conectar.
2. Redirect `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=…&redirect_uri=…&state=…`
3. Callback troca `code` em `POST https://api.mercadolibre.com/oauth/token`.
4. Persiste em `meliAuth` (uma linha): `meliUserId`, `accessToken`, `refreshToken`, `expiresAt`, `scope`, `updatedAt`.
5. Access token no header `Authorization: Bearer …`.
6. Access vale 6h. Refresh é de uso único: um refresh por vez; gravar o novo par e descartar o antigo.
7. Grant só da conta **administrador** ML (operador → recusar com mensagem clara).

Sem env configurado: APIs ML respondem 503 `{ error: 'Mercado Livre não configurado.' }`. A UI mostra aviso, sem botão OAuth.

Desconectar apaga `meliAuth`. Produtos e ofertas permanecem; sync/import passam a falhar até reconectar.

## Dados

Coleção nova em `db.js`:

```
meliAuth: [{
  meliUserId,
  accessToken,
  refreshToken,
  expiresAt,
  scope,
  updatedAt
}]
```

Campos novos:

- `officialProducts.meliItemId` — string `MLB…` ou vazio.
- `officialProductOffers.externalId` — mesmo id.
- `officialProductOffers.meliUserId` — dono do anúncio.

Reimport: `findOne('officialProducts', p => p.meliItemId === itemId)`.

Rascunho de import:

- `published: false`
- `available: false`
- `manualPrice: null`
- `costPrice: 0`
- `marginValue: 0`
- `price: 0` até o admin precificar (`createProduct` hoje exige preço > 0; o import precisa de um caminho que **não** chame essa exigência, ou aceite rascunho sem preço comercial).
- listing materializado `paused` (já é o comportamento de `syncListing` quando `published === false`).

## Mapeamento ML → Catira

Parse de entrada (import):

- Aceita `MLB` + 8–12 dígitos, com ou sem hífen (`MLB1828680414`, `MLB-1828680414`).
- Permalink `produto.mercadolivre.com.br/MLB-…` ou `mercadolivre.com.br/…`.
- Recusa javascript:, data:, localhost, userinfo na URL (`isSafeHttpUrl` / `normalizeOfferUrl`).

Item (`GET /items/{id}`):

| ML | Destino | Quando |
|---|---|---|
| `id` | `meliItemId` / `externalId` | import e sync |
| `title` | `officialProducts.title` (140) | import e sync |
| `GET …/description` `plain_text` | `description` (4000) | import e sync |
| `pictures[].secure_url` (máx. 8) | `images[]` | import e sync |
| `condition` / `ITEM_CONDITION` | `novo` \| `usado` \| `seminovo` | import e sync |
| `domain_id` / `category_id` | categoria Catira | **só import** |
| `permalink` | oferta `url` | import e sync |
| `sale_price.amount` | oferta `price` | import e sync |
| `sale_price.regular_amount` | oferta `previousPrice` | import e sync |
| `available_quantity` | oferta `stock` | só com token do dono |
| `status` | oferta `status` | import e sync |

`status` ML:

- `active` → oferta `active`, `source: process`, `enabled: true`
- `paused` / `closed` / `under_review` → oferta `suspended`
- 404 → oferta `suspended` se o produto já existe; import novo → 400

Categoria no import (primeiro match de `domain_id` / path da categoria ML):

- veículos, motos, bikes → `veiculos`
- celulares, informática, games, eletrônicos → `tecnologia`
- casa, móveis, eletrodomésticos → `casa-moveis`
- moda, roupas, calçados → `moda`
- ferramentas → `ferramentas`
- agro, campo → `agro`
- animais, pets → `animais`
- esportes, lazer, livros, infantil → `lazer`
- imóveis → `imoveis`
- resto → `servicos`

Condição: `new` → `novo`; `used` → `usado`; recondicionado/não especificado → `seminovo`.

Oferta gerada:

- `provider: 'mercadolivre'`
- `source: 'process'`
- `lastSyncAt` / `lastCheckedAt` = agora
- URL = permalink https

Vitrine pública: inalterada. Rascunho sem preço comercial não publica listing. “Onde comprar” só oferta externa viva com URL segura. Preço do card Catira continua `computePrice` (manual vence custo+margem).

## APIs admin

Todas exigem admin logado.

`GET /api/admin/official/meli/status`

```
{
  configured: boolean,
  connected: boolean,
  meliUserId: number | null,
  expiresAt: string | null,
  tokenExpired: boolean
}
```

Sem tokens no JSON.

`GET /api/admin/official/meli/connect` → `{ url }` (URL de autorização). 503 se não configurado.

`GET /api/admin/official/meli/callback?code&state` — valida `state`, troca code, redireciona para `/admin?tab=oficial&meli=ok` ou `&meli=error`.

`POST /api/admin/official/meli/disconnect` → `{ ok: true }`.

`POST /api/admin/official/meli/import` `{ url }`

- 503 sem config; 401/400 sem grant válido.
- 400 URL/ID inválido, 404 do ML, item de outro `seller_id`.
- 201 (novo) ou 200 (reimport) `{ product, offer, listingId }`.
- Produto serializado como rascunho; oferta `source: process`.

`POST /api/admin/official/products/:id/meli/sync`

- 404 produto sem `meliItemId`.
- Atualiza ficha (título, descrição, fotos, condição) e oferta; devolve `{ product, offer }`.

Poll interno chama o mesmo `syncMeliProduct`. Falha de um item não aborta os demais.

## UI

Em Admin → Oficial, acima da lista:

1. Cartão Mercado Livre: configurado/conectado/`user_id` mascarado, Conectar, Desconectar. Token nunca visível.
2. Campo “URL ou código MLB” + Importar. Erro inline. Sucesso abre o produto rascunho.
3. Selo “Aguardando preço” se `!manualPrice && !costPrice`.
4. No editor: “Atualizar agora”, `lastSyncAt`, aviso se oferta `stale`.
5. Oferta `source: process`: preço, estoque, link e status só leitura. Suspender/Reativar continuam. Campos manuais de URL/preço desabilitados (o próximo sync sobrescreve).

Sem lista da loja, sem wizard, sem alteração em Home/Busca/Listing além do que Fase 1/2A já fazem.

## Erros

| Caso | Efeito |
|---|---|
| Sem env | 503; UI “Mercado Livre não configurado.” |
| Sem grant / `invalid_grant` | import 400; sync marca oferta `stale`; UI pede reconectar |
| Operador ML | 400 “Use a conta administrador do Mercado Livre.” |
| 404 item | import 400; sync suspende oferta existente |
| `seller_id` ≠ grant | 400 “Este anúncio não é da conta conectada.” |
| 429 | espera + jitter; não marca `stale` nessa rodada |
| Token 401 | um refresh; se falhar, `stale` + reconectar |
| URL não MLB / insegura | 400 |

Refresh concorrente: trava em memória (um refresh por processo). `db.json` não é para webhook; o poll é serial.

Logs `officialAdminLogs`: `meli_connected`, `meli_disconnected`, `meli_imported`, `meli_synced` — sem tokens no `payload`.

## Testes

Arquivo `backend/src/meli.test.js` (+ casos em `official.test.js`). Cliente HTTP injetável; fixtures JSON; **zero rede**.

Cobrir:

- Parse permalink → id canônico `MLB…`
- Map item+description+sale_price → rascunho sem preço comercial + oferta process
- Reimport do mesmo id atualiza, não duplica
- Sync reescreve título/fotos/oferta e **não** `manualPrice` / `published`
- Admin precifica depois; listing publica; sync seguinte não zera o preço comercial
- ML `paused` → oferta `suspended`; rascunho fora da busca pública
- Oferta process sem `lastSyncAt` recente some de `publicOffersOf`
- Refresh one-shot; 401 após refresh falho → `stale`
- Sem env → `configured: false`

`npm test` no backend continua a suíte atual + esta.

## Ordem de implementação (referência; o plano detalha)

1. Parse + mapeamento (fixtures).
2. Campos `meliItemId` / `externalId` + import rascunho + reimport.
3. OAuth + status/connect/callback/disconnect (secret só no servidor).
4. Sync pontual + overwrite da ficha + regras de preço comercial.
5. Poll 15 min + 429/stale.
6. UI AdminOfficial.
7. Testes dos fluxos acima, sem chamada real.

## Critério de pronto

- Admin com env e grant importa um MLB e vê rascunho oficial + oferta ML.
- Sem preço comercial o anúncio não aparece na Home/Busca.
- Depois de precificar e publicar, “Onde comprar” mostra o permalink ML se a oferta estiver viva.
- Sync (botão ou poll) atualiza ficha e oferta e preserva o preço comercial.
- Reimport do mesmo MLB não cria segundo produto.
- Token/secret nunca saem na API nem no log.
