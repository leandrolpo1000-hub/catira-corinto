# Fase 2C: importar anúncio de terceiro (catálogo ML)

Data: 2026-11-02
Status: aprovado em conversa

## Objetivo

O Import da aba Oficial passa a aceitar anúncio de **qualquer vendedor**, não só da conta OAuth. A ficha Catira (título, fotos, descrição, condição) e a oferta “Comprar no Mercado Livre” saem do anúncio/catálogo público. O preço comercial Catira continua humano: rascunho `published=false`, sem `manualPrice`/`costPrice`.

## Fora de escopo

- Scraping de HTML do Mercado Livre.
- `GET /sites/MLB/search` (403 neste app).
- User Products `MLBU…` / `/up/`.
- POST/PUT em `/items`, webhook, pedidos, Shopee/Amazon.
- Copiar imagens para `/uploads`.
- Listar a loja do vendedor terceiro.
- Mudar Home/Busca além do que 1/2A/2B já fazem.

## Decisões travadas

- Caminho A: o mesmo botão Import; fallback catálogo quando `/items/{id}` devolve 403.
- Parse: `wid=` = anúncio; `/p/MLB…` = catálogo; `MLBU` continua recusado.
- Anúncio próprio (200 em `/items`): ficha do item; `sale_price` e estoque só se `seller_id` = conta conectada.
- Anúncio de terceiro (403 em `/items`): exige `/p/MLB…` na URL. Sem isso, recusa. Com catálogo: `GET /products/{id}` + `GET /products/{id}/items`. Oferta = `wid` se existir, senão o de menor `price`. Sem estoque. Preço da oferta = `price` / `original_price` do item de catálogo.
- MLB clássico sem `/p/` e `/items` 403: recusa (“Cole a página /p/”). Não há lookup catálogo←item (search por id volta 0).
- Descrição de terceiro: `GET /items/{id}/description` (200 mesmo com `/items` 403).
- OAuth continua obrigatório. Sem scraping.
- Produto: `meliItemId` (MLB do anúncio) + `meliCatalogId` (`MLB…` do `/p/`).
- Mesmo `meliItemId` reaproveita o produto; uma oferta `mercadolivre` por produto.
- Sync: se `meliCatalogId` existir, usa o caminho catálogo (preferindo o `meliItemId` salvo como `wid`); senão `/items`.
- Sync **sempre** reescreve título, descrição, fotos, condição e a oferta ML.
- Sync **nunca** altera `manualPrice`, `costPrice`, margem, cobertura, `published`, categoria.
- Categoria Catira só no import (`domain_id`).
- Fotos: até 8 URLs https (`pictures[].secure_url` no item; `pictures[].url` no catálogo, forçando https).
- Permalink da oferta de terceiro: `permalink` do produto catálogo + `?wid={itemId}`.
- 429: backoff; não marca `stale` nessa rodada.

## Por que o fallback existe

Com o token da conta conectada:

| Endpoint | Próprio | Terceiro |
|---|---|---|
| `GET /items/{id}` | 200 | 403 `access_denied` |
| `GET /items/{id}/sale_price` | 200 | 403 |
| `GET /items/{id}/description` | 200 | 200 |
| `GET /products/{catalogId}` | 200 | 200 |
| `GET /products/{catalogId}/items` | 200 | 200 (`item_id`, `seller_id`, `price`, `original_price`, `condition`) |
| `GET /sites/MLB/search` | 403 | 403 |

Não dá para “abrir” `/items` de terceiro. Dá para montar ficha+oferta pelo catálogo.

## Fluxo de import

1. Parse da URL/código.
   - Catálogo `/up/MLBU…` → 400 (já existente).
   - `wid=MLB…` (query ou hash) → `meliItemId`.
   - Path `/p/MLB…` → `meliCatalogId`. Sem `wid`, ainda não há anúncio.
   - Permalink clássico / código `MLB` + dígitos → `meliItemId`. `/p/` sem `wid` e sem dígitos de anúncio → só catálogo.
2. Se há `meliItemId`, `GET /items/{id}`.
3. **200:** mapear como 2B. `sale_price` + `available_quantity` só se `seller_id` = `meliAuth.meliUserId`. Senão oferta sem estoque; preço da oferta pelo `sale_price` se 200, senão omitir/zero até o admin. Não recusar por `seller_id` diferente.
4. **403:** se não há `meliCatalogId`, 400 “Essa URL é de anúncio de terceiro. Cole a página do produto (/p/MLB…)”.
5. **Catálogo:** `GET /products/{meliCatalogId}` + `GET /products/{meliCatalogId}/items`.
   - Escolher item: `meliItemId`/`wid` se estiver na lista; senão `min(price)`.
   - Sem resultados → 400 “Catálogo sem anúncios ativos.”
   - Descrição: `GET /items/{chosen}/description`; 404 → texto vazio.
   - Ficha: `name` → título; fotos do produto; `condition` do item escolhido; `domain_id` → categoria (só import).
   - Oferta: `price` / `original_price`; `meliUserId` = `seller_id` do item (terceiro permitido); `stock` vazio; `url` = permalink catálogo + `?wid=`.
6. 404 em `/items` no import novo → 400 “Anúncio não encontrado”.
7. Persistência: `official.importMappedMeli` igual ao 2B, gravando também `meliCatalogId`.

## Fluxo de sync / poll

- Produto com `meliCatalogId`: repetir o caminho catálogo; manter o `meliItemId` salvo se ainda estiver em `/products/{id}/items`; senão cair para o de menor preço e atualizar `meliItemId`.
- Produto só com `meliItemId`: `GET /items/{id}`. 403 → oferta `stale` (não inventar catálogo). 404 → suspender oferta.
- Poll 15 min serial, inalterado.

## Dados

- `officialProducts.meliCatalogId` — string `MLB…` do `/p/` ou vazio.
- `officialProducts.meliItemId` — anúncio escolhido (já existe).
- `officialProductOffers.externalId` — mesmo anúncio.
- `officialProductOffers.meliUserId` — vendedor do anúncio (pode ≠ conta OAuth).

## UI

Mesmo campo Import. Hint: aceita anúncio próprio, página `/p/` e `wid=`. Recusa `/up/MLBU` e MLB clássico de terceiro sem `/p/`. Erros inline já usados.

## Testes

`meli.test.js` + `official.test.js`. HTTP injetável, **zero rede**.

- Parse: `wid` vence `/p/`; `/p/` sem `wid` não vira item id; `MLBU` recusa.
- `/items` 200 próprio: inalterado (rascunho + oferta + estoque).
- `/items` 200 de outro `seller_id`: importa; sem estoque.
- `/items` 403 sem catálogo: 400 pedindo `/p/`.
- `/items` 403 com `/p/`: ficha do produto catálogo + oferta do `wid` ou menor preço; `meliCatalogId` gravado; `stock` vazio.
- Reimport do mesmo `meliItemId` não duplica.
- Sync catálogo reescreve ficha/oferta e não toca `manualPrice`/`published`.
- 429 no catálogo: backoff, não `stale`.

## Critério de pronto

- Admin cola a URL de `/p/…?wid=MLB…` de terceiro e vê rascunho + oferta ML (preço do catálogo, sem estoque).
- Anúncio próprio continua com ficha `/items` e `sale_price`.
- MLB clássico de terceiro sem `/p/` explica que precisa da página do produto.
- Sync/poll preserva preço comercial Catira.
- Token/secret nunca saem na API nem no log.
