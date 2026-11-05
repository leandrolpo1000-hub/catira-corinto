# 5 oficiais de exemplo + checkout Pix ou cartão

Data: 2026-11-04
Status: aprovado em conversa

## Objetivo

Criar **5 produtos oficiais de exemplo** em Corinto, compráveis pelo Catira, e abrir no checkout **Pix ou cartão de crédito** (não os dois no mesmo pedido). Cobrança Appmax é **real**, no mesmo ambiente já usado pelo Teste Pix R$ 10.

## Fora de escopo

- Minhas compras, rastreio, cancelar, reembolso.
- Carrinho multi-item, quantidade diferente de 1, cupom, retirada.
- `commercialReady: true` em qualquer oferta Catira.
- Cartões salvos, alterar client Appmax, misturar `Pay.jsx` / VIP / taxa de anúncio.
- Lista `GET /api/orders` e `/api/checkout/sessions` (continuam 403).
- Frete cobrado (continua R$ 0,00 verdadeiro).
- Fotos reais de produto (placeholder / sem imagem nesta fase, a menos que já exista upload admin).
- Commit/push só quando o usuário pedir.

## Decisões travadas

- Quem compra: usuário **logado**. Anônimo: `/entrar?next=`.
- O quê: 5 oficiais novos, além do Teste Pix R$ 10 (esse permanece).
- Como nascem: `ensureSampleOfficialProducts()` no boot, **idempotente** por título. Quem já tem o título não duplica; oferta Catira é upsert com `buyEnabled: true`.
- Pagamento no checkout: **Pix ou cartão**. Escolha na tela `/checkout/:orderId/pagamento`.
- Pedido com Pix já gerado (`pixEmv`) **não** aceita cartão (409 já existente). Pedido com cartão/`appmaxPaymentId` **não** troca para Pix.
- Confirmação: só `status === 'paid'` via webhook + `GET /v1/orders/{id}` Appmax. Front não confirma.
- Cliente não manda preço. Total sai do snapshot do pedido.
- `commercialReady` continua `false`. Compra usa `buyEnabled`.
- Identidade Catira (creme / laranja / branco). Sem visual Mercado Livre.

## Catalogo (5 oficiais)

Todos: Corinto / `corinto`, `pricingRule: fixed`, `published: true`, `condition: novo`, entrega `{ mode: 'cities', cityIds: ['corinto'] }`, oferta Catira `status: active`, `enabled: true`, `buyEnabled: true`, `commercialReady: false`, estoque 10.

| Título | Categoria (slug) | Preço | Descrição curta |
|---|---|---|---|
| Fone Bluetooth Catira | tecnologia | 49 | Fone sem fio de exemplo Catira. |
| Kit chaves 40 peças | ferramentas | 79 | Jogo de chaves de exemplo Catira. |
| Luminária LED de mesa | casa-moveis | 39 | Luminária de mesa de exemplo Catira. |
| Boné trucker Corinto | moda | 35 | Boné de exemplo Catira. |
| Pulverizador 5 L | agro | 89 | Pulverizador de exemplo Catira. |

Categoria resolvida por slug ativo; se o slug faltar, primeira categoria ativa (mesmo fallback do Teste Pix). Sem imagens nesta fase.

Idempotência: `db.findOne('officialProducts', (p) => p.title === TITLE)`. Se existir, só garante a oferta Catira.

Boot (`server.js`): após `ensureTestPixProduct()`, chamar `ensureSampleOfficialProducts()`. Falha isolada não derruba o servidor (mesmo `try/catch` do Teste Pix).

## API pública (logado)

Rotas já abertas (não mudam o contrato, só passam a servir os 5):

| Método | Rota | Efeito |
|---|---|---|
| POST | `/api/orders` | Cria/reusa pedido se `buyEnabled`. Body `{ offerId, quantity: 1, address }`. |
| GET | `/api/orders/:id` | Dono. Inclui campos Fase B (`createdAt`, `listingId`, totais, `paymentMethod`). |
| POST | `/api/orders/:id/pix` | Gera Pix. Body `{ documentNumber, ip }`. |

Rotas **novas**:

| Método | Rota | Efeito |
|---|---|---|
| GET | `/api/orders/:id/installments` | Dono. `quoteInstallments`. Query `installments` opcional (default do domínio). Sem preço no query. |
| POST | `/api/orders/:id/card` | Dono. `prepareCardCharge`. Body `{ token, documentNumber, ip, holderName?, installments? }`. Sem PAN/CVV no body. |

Continua 403: `GET /api/orders`, `POST/GET /api/checkout/sessions`.

Erros de cartão (já no domínio): 400 token/CPF/IP/parcelas; 409 pedido pago, status inválido, ou pedido que já tem Pix EMV.

## Checkout UI

Fluxo Fase B até pagamento. Em `/pagamento`:

1. Resumo do pedido (GET).
2. Escolha **Pix** ou **Cartão**.
3. Pix: CPF + IP Appmax JS → `POST .../pix` → `/pix` (QR, poll 8s, `/ok` só se `paid`).
4. Cartão: `AppmaxCardForm` visível; IP + token via Appmax JS; CPF; parcelas 1 se quote falhar/vazio; `POST .../card` → se já `paid`, `/ok`; senão tela de aguardo com o mesmo poll 8s (status pendente não mente “confirmado”).
5. Sem `data-appmax-checkout` na ficha. Sem cartão na revisão/entrega.

CTA: “Pagar e finalizar”. Steps Carrinho → Entrega → Pagamento. Tab bar continua oculta em `/checkout`.

## Backend mínimo

- `official.js`: lista constante dos 5 + `ensureSampleOfficialProducts()`; export; boot.
- `routes/orders.js`: `GET /:id/installments`, `POST /:id/card` com `asOwner`, `serializeBuyerOrder`.
- Não alterar client Appmax. Não abrir lista. Não PATCH de endereço.

## Testes

**Backend**

- `official.test.js`: `ensureSampleOfficialProducts()` cria 5 títulos, oferta Catira `buyEnabled`, `commercialReady === false`, segunda chamada não duplica.
- `orders.card.test.js` (HTTP se faltar): dono `POST /card` 200 com mock; sem token 400; pedido com `pixEmv` 409; outro usuário 404.
- `GET /installments` dono 200; lista `GET /api/orders` 403.

**Frontend** (`node --test src/*.test.mjs`)

- Checkout tem Pix **e** `AppmaxCardForm` / `data-appmax-checkout` na tela de pagamento.
- Sem `prepareCardCharge` na ficha; ficha continua só “Comprar no Catira”.
- Sem `/minhas-compras`. `/ok` só se `paid`.

**Build:** `npm run build` no frontend.

## Riscos

- Cobrança **real** nos 5 (R$ 35–89), não só R$ 10.
- Quote de parcelas depende da Appmax; fallback 1x à vista.
- Pedido aberto com Pix trava cartão até fase de cancelamento (fora desta entrega).
- Sem foto: ficha/checkout usam placeholder já existente.

## Estimativa

Seed idempotente + rotas card/installments + Checkout cartão + testes + build: uma sessão. Sem commit até o usuário pedir.
