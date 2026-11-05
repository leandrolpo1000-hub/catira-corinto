# Catira Intelligence — inteligência interna (MVP)

Data: 2026-11-04
Status: arquitetura aprovada em conversa (abordagem B: Dashboard expandido)

## Objetivo

Inteligência de mercado exclusiva do **master**, alimentada por eventos reais do marketplace. Coleta e indicadores internos ligados. Monetização, planos cobrados, API comercial e acesso de comerciante **desligados** e bloqueados no backend.

## Fora de escopo

- Cobrança, checkout de assinatura, Stripe/Appmax para planos.
- Liberar comerciante, API comercial ou relatórios pagos.
- Reescrever marketplace, Appmax, Pix/cartão de pedido, taxa Pix de anúncio.
- Alterar `commercialReady` (continua `false`).
- `GET /api/orders` lista e `/api/checkout/sessions` continuam 403.
- Dados fictícios em produção. Migração destrutiva. Commit sem pedido do usuário.

## Decisões travadas

- Superfície: chip **Catira Intelligence** no lugar de **Dashboard**. Só master. Sem rota `/admin/intelligence`.
- Coleta: serviço central `trackEvent()` em `backend/src/intelligence.js`. Handlers existentes só chamam; não gravam evento sozinhos.
- Persistência: novas coleções no SQLite `records` (`intelligenceEvents`, `intelligenceDaily`). Sem tabela SQL nova. Sem tocar em `orders` protegidos.
- Identidade: `HMAC-SHA256(secret, userId)` se logado; senão HMAC do session id. Nunca userId cru, email, telefone, CPF, IP, nome.
- Secret: `CATIRA_INTEL_HMAC_SECRET` ou, se vazio, `resolveJwtSecret()`.
- Admin/master/platform: não entram nos indicadores de consumo (evento nem grava, ou grava `excluded: true` e o painel ignora). Testes/seed admin idem.
- Flags comerciais default **false**. Desligar comercial não para coleta nem apaga histórico.
- `sold` de anúncio (seller declara) **não** é venda comprovada. Venda Intelligence = `orders.status === 'paid'` (pago) e `completed` (concluída), separados.
- Receita atual do dash (taxa Pix de anúncio) permanece no bloco operacional; GMV de pedido Appmax é outro indicador.
- Frontend nunca declara pagamento/venda.
- Abordagem B: leitura no `GET /api/admin/dashboard` (master). Sem `/api/admin/intelligence` de rankings. Settings em `GET|PUT /api/admin/intelligence/settings`.

## Flags (`settings` id `intelligence`)

| chave | default | efeito |
|---|---|---|
| `intelligenceEnabled` | true | se false, `trackEvent` no-op |
| `internalAnalyticsEnabled` | true | se false, dash não devolve rankings Intelligence (stats operacionais continuam) |
| `commercialIntelligenceEnabled` | false | comercial 403 |
| `merchantIntelligenceAccessEnabled` | false | comerciante 403 |
| `intelligenceSubscriptionsEnabled` | false | sem assinatura |
| `intelligenceApiEnabled` | false | API comercial 403 |

Só master lê/grava. PUT parcial. Nunca apaga eventos.

Planos (schema só, sem cobrança): `plans.start|pro|business|enterprise` com `modules: []` e `limits: {}`.

## Eventos

Tipos: `search`, `view`, `favorite`, `share`, `contact`, `contact_whatsapp`, `proposal`, `checkout`, `order_created`, `payment_confirmed`, `sale_completed`.

Um evento de busca: `type: search` + `resultCount`. Vazio = `resultCount === 0` (não duplicar `search_empty`).

Carrinho: não existe. Não inventar evento `cart`.

Documento bruto (sem PII):

```
id, type, createdAt, actorHash,
listingId, productId, categoryId, cityId, city,
query, resultCount, orderId, proposalId,
priceCents, paymentMethod, source
```

`intelligenceDaily`: `{ id, day, type, cityId, categoryId, listingId, query, count }` incrementado no mesmo `trackEvent`. Uniques no painel = distinct `actorHash` nos brutos do período.

### Pontos de coleta (não duplicar)

| tipo | onde |
|---|---|
| `search` | `GET /api/listings` se `q`/`search` não vazio, **depois** de filtrar, com `resultCount` |
| `view` | `GET /api/listings/:id` se `published` (além do contador `listings.views`, que não muda de regra) |
| `favorite` | `POST /api/favorites/:id` só no **insert** (não no remove) |
| `share` | `POST /api/listings/:id/share` novo, auth opcional |
| `contact` | `POST /api/interest` sucesso |
| `contact_whatsapp` | `GET /api/whatsapp/:listingId` sucesso |
| `proposal` | criação de `tradeProposals` |
| `order_created` | `createOrder` sucesso |
| `checkout` | `preparePixCharge` ou `prepareCardCharge` sucesso (tentativa de pagamento) |
| `payment_confirmed` | `handleAppmaxWebhook` quando transita para `paid` (não no payload cru) |
| `sale_completed` | `transition(..., 'completed')` |

`POST /api/analytics/events` **não** existe. Share ganha rota própria.

### Dedup / qualidade

| tipo | chave | janela |
|---|---|---|
| view | actorHash + listingId | 30 min |
| search | actorHash + query normalizada + city | 5 min |
| share | actorHash + listingId | 60 min |
| contact / contact_whatsapp | actorHash + listingId + type | 60 min |
| favorite | só no insert (natural) | — |
| order_created / checkout / payment_confirmed / sale_completed | orderId + type | eterno |
| proposal | proposalId | eterno |

Bot: User-Agent casa `/bot|crawler|spider|curl|wget|python-requests|headless/i` → não grava. Sem UA em chamada server-to-server (webhook pago) → grava.

Sessão anônima: header `X-Catira-Session` (UUID em `localStorage catira_sid`). Sem header e sem login → ainda grava view/search com actorHash HMAC de `'anon:' + dia` **somente se** não for bot; uniques anônimos sem sessão ficam grosseiros. Preferir o header no `api()`.

## Indicadores (bloco `intelligence` no dashboard)

Filtros: `period` (7d/30d/month/year/all), `city`, `category`. `status` de anúncio **não** filtra eventos Intelligence.

Sempre rotulados à parte dos stats operacionais:

- buscas, buscas vazias, views (eventos válidos), uniques de view
- favoritos, shares, contacts (interest + whatsapp), proposals
- checkouts, pedidos criados, pagamentos confirmados (`paid`), vendas concluídas (`completed`)
- rankings: queries, vazias, listings por view/favorite/share/contact, categorias, cidades
- vendidos comprovados: pedidos `paid`/`completed` (nunca `listings.status === 'sold'`)
- oferta vs procura: por categoria, `demand = searches+views+contacts`, `supply = listings published`
- faixas de preço dos **pedidos pagos** (0–50, 50–100, 100–200, 200–500, 500+)
- série diária: searches, views, orders, paid
- oportunidades: categoria com demanda e oferta 0; query vazia repetida (≥3 no período); produto muito visto e 0 contact/pedido

Mínimo de amostragem comercial (quando um dia comercial ligar): não expor N < 5 atores. Nesta entrega o comercial está off, então o painel interno master **pode** ver N baixo.

## API

| método | rota | auth | efeito |
|---|---|---|---|
| GET | `/api/admin/dashboard` | master | stats atuais + `intelligence` se flag interna on |
| GET | `/api/admin/intelligence/settings` | master | flags + plans |
| PUT | `/api/admin/intelligence/settings` | master | merge flags |
| POST | `/api/listings/:id/share` | opcional | 204 + track share se published |
| GET | `/api/merchant/intelligence` | auth | **403** `INTELLIGENCE_COMMERCIAL_DISABLED` |
| GET | `/api/intelligence/commercial` | auth | **403** idem |

Não-master em dashboard/settings: 403 (já é `masterRequired`).

## UI

- Master chips: `['dash', 'Catira Intelligence']` no lugar de Dashboard.
- Subchips: Visão geral, Produtos, Pesquisas, Categorias, Demanda e oferta, Geografia, Preços, Tendências, Oportunidades, Configurações.
- Visão geral: KPIs operacionais atuais (usuários, anúncios, receita taxa, `sold` **como “Marcados vendidos”**) + KPIs Intelligence.
- Configurações: toggles das 6 flags. Texto: comercial off não apaga dados. Planos visíveis como “em breve”, não editáveis nesta fase.
- Paleta cream/laranja existente (`.admin-grid`, `.stat`, `.bars`, `.chips`). Sem lib de gráfico nova.
- Intermediador: chip some (já some o dash).

`api()` envia `X-Catira-Session`.

## Testes obrigatórios

Arquivo `backend/src/intelligence.test.js` (+ asserts pontuais nos testes de orders/listings se o hook quebrar contrato):

- track grava bruto + daily
- dedupe view 30 min
- busca vazia incrementa empty, não duplica tipo
- favorite só no insert
- admin/master não infla consumo
- HMAC: mesmo userId → mesmo hash; hash ≠ userId
- evento sem email/telefone/ip/userId
- payment_confirmed só após transição `paid` (não no webhook cru)
- `listings.status sold` não entra em `paymentsConfirmed` / `salesCompleted`
- flags: coleta off → no-op; comercial off → 403 merchant; interna off → `intelligence.enabled false`
- settings persistem PUT
- dashboard 403 para user comum e para role admin (não master)
- Appmax/checkout/`commercialReady`/403 de lista de pedidos **intocados**

Frontend: `frontend/src/intelligence.test.mjs` (string): chip `Catira Intelligence`, subchip Configurações, `X-Catira-Session`, não declara `paid` no cliente.

Build: `npm run build` no frontend. Backend: `npm test` + o novo arquivo no script `test`.

## Compatibilidade

Não mudar: `appmax.js`, payloads de webhook, `preparePixCharge`/`prepareCardCharge` além de chamar `trackEvent` no sucesso, snapshots de pedido, `denyPublic`, `buyEnabled`, `official.syncListing`, PIX de anúncio, testes Vosk pré-existentes.
