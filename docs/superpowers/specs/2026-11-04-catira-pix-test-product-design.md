# Compra Pix só no produto Teste R$ 10

Data: 2026-11-04
Status: aprovado em conversa

## Objetivo

Abrir a compra pelo Catira **somente** no produto oficial **Teste Pix R$ 10**, para qualquer usuário logado, **só Pix**, na Appmax **produção** (cobrança real de R$ 10). O restante do catálogo Catira continua fechado.

## Fora de escopo

- Cartão (`AppmaxCardForm` na ficha, tokenização de cartão, `prepareCardCharge` público).
- Liberar `commercialReady` global ou qualquer outra oferta Catira.
- Frete cobrado, fornecedor, reembolso, VIP/`pix.js` (taxa de anúncio).
- Checkout de sessão como único caminho (`/api/checkout/sessions` permanece 403).
- Commit, publish, domínio novo.

## Decisões travadas

- Quem compra: qualquer usuário **logado**. Anônimo: redireciona para `/entrar`.
- O quê: um produto oficial novo, título **Teste Pix R$ 10**, preço Catira **10.00**, estoque **10**, publicado.
- Como trava o resto: flag **`buyEnabled`** só nessa oferta Catira. Não usar `commercialReady` (continua `false` em toda oferta Catira).
- Pagamento: só Pix. Cartão nesta fase: 400/403.
- Cobrança: Appmax produção, fluxo já existente (`createCustomer` → `createOrder` → `createPixPayment`). Valor do pedido sai do servidor (`toCents(offer.price)` = 1000). Cliente não manda preço.
- Webhook: o já cadastrado. Confirmação continua sendo `GET /v1/orders/{id}` na Appmax, não o evento cru.
- Endereço: obrigatório no `POST /api/orders` (mesmo validador de hoje). Frete **0**.
- IP do pagador: Appmax JS só para `onIp`. Sem formulário de cartão.
- Idempotência: pedido aberto (`draft` / `awaiting_payment`) do mesmo usuário + oferta é reutilizado. Pix já gerado não gera segunda cobrança.
- Persistência da flag: campo `buyEnabled` (boolean) em `officialProductOffers`. Admin/master pode gravar; o produto de teste nasce com `true`.
- Sem login: 401 nas rotas de pedido. Oferta sem flag: 403 com a mensagem atual (“A compra pelo Catira ainda não está disponível nesta fase.”).

## Produto de teste

Criação **idempotente** no backend (se já existir oferta Catira com `buyEnabled`, não duplicar):

- Título: `Teste Pix R$ 10`
- Descrição: `Produto de teste da compra Pix pelo Catira. Cobrança real de R$ 10.`
- Categoria: a primeira categoria ativa do banco
- Cidade: Corinto / `corinto`
- `manualPrice`: 10
- `published`: true
- Oferta Catira: `provider: catira`, `price: 10`, `stock: 10`, `status: active`, `enabled: true`, `buyEnabled: true`, `commercialReady: false`

Anúncio oficial visível no feed/ficha como os demais oficiais.

## API pública (logado)

| Método | Rota | Quem | Efeito |
|---|---|---|---|
| POST | `/api/orders` | dono logado | Cria (ou reusa) pedido da oferta se `buyEnabled`. Body: `{ offerId, quantity, address }`. Quantity default 1. |
| GET | `/api/orders/:id` | dono do pedido | Pedido + Pix (EMV/QR) se já gerado. Sem dados de cartão. |
| POST | `/api/orders/:id/pix` | dono | `preparePixCharge`. Body: `{ documentNumber, ip }`. CPF/CNPJ + IP obrigatórios. |
| POST/GET | `/api/checkout/sessions` | qualquer | **403** (não muda). |
| GET | `/api/orders` (lista) | qualquer | **403** (não muda). |
| POST | cartão | — | Sem rota pública. |

Pedido de outra oferta Catira (`buyEnabled` falso/ausente): 403, não grava.

GET de pedido de outro usuário: 404 (não vaza existência).

Resposta do GET/POST pedido (comprador): `id`, `status`, `totalCents`, `quantity`, `productSnapshot.title`, `address`, `pixEmv`, `pixQrcode`, `pixExpirationDate`. Sem `clientSecret`, sem token Appmax, sem `userId` de terceiros.

## Flag e ficha

`serializeOffer` público, oferta Catira:

- `buyEnabled`: `true` só se a linha tiver `buyEnabled === true` e preço > 0
- `commercialReady`: sempre `false`
- `commercialAvailability`: `'available'` se `buyEnabled`, senão `'preparing'`

`sanitizeOfferInput` **deixa** de recusar `buyEnabled: true`. Continua recusando `commercialReady: true`.

Ficha (`Listing.jsx`): se `catiraOffer.buyEnabled`, botão **Comprar no Catira** (R$ 10). Sem flag: bloco “em preparação” de hoje. Sem `AppmaxCardForm`.

Fluxo na ficha:

1. Sem login → `/entrar?next=…`
2. Formulário: endereço (destinatário, telefone, CEP, rua, número, bairro, cidade, UF) + CPF/CNPJ
3. Carrega Appmax JS (`/api/config.appmax.scriptUrl` + `externalId`) e guarda o IP
4. `POST /api/orders` → `POST /api/orders/:id/pix`
5. Mostra QR (`pixQrcode` se houver) e copia-e-cola (`pixEmv`)
6. Texto: aguardando pagamento. Webhook marca `paid`. Sem poll obrigatório nesta fase.

## Backend de pedido

**`createOrder` e `createCheckoutSession` exigem `buyEnabled === true`.** Testes de Pix/webhook/homolog/domínio passam a marcar a flag na oferta de fixture. A rota HTTP de checkout session continua **403** mesmo com flag; o consumidor só usa `POST /api/orders` + `POST /api/orders/:id/pix`.

## Erros

| Caso | HTTP | Mensagem |
|---|---|---|
| Sem token | 401 | padrão de auth |
| Oferta sem `buyEnabled` | 403 | `A compra pelo Catira ainda não está disponível nesta fase.` |
| Oferta externa / sem preço | 400 | já existente |
| Sem endereço completo | 400 | já existente |
| Sem CPF/IP no Pix | 400 | já existente |
| Cartão no público | 403 ou rota inexistente | — |
| Appmax 401/5xx no Pix | 502/504 | falha Appmax; pedido pode ficar `draft` sem EMV |
| Pedido pago + novo Pix | 409 | já existente |

## Testes

- Oferta Catira sem `buyEnabled`: `POST /api/orders` 403; ficha sem botão Comprar.
- Oferta com `buyEnabled`: logado cria pedido HTTP 200; total 1000 centavos; `commercialReady` false.
- `POST /api/orders/:id/pix` com Appmax mock devolve EMV; segundo POST é idempotente.
- Cartão público continua fechado.
- `buyEnabled: true` no sanitize **não** lança 400; `commercialReady: true` continua 400.
- Produto de teste idempotente: segunda execução não duplica.
- Webhook de Pix pago no pedido de teste continua confirmando via GET remoto (teste já existente, oferta com flag).

## Dados

`officialProductOffers.buyEnabled`: boolean, default `false`. SQLite já aceita campo extra no JSON da linha; sem migration de tabela.

## Não fazer

- Ligar Comprar em Home/atalhos globais.
- Abrir lista `GET /api/orders` para o consumidor.
- Enviar `external-id` nas chamadas server-to-server.
- Colar secret no chat ou no frontend.
