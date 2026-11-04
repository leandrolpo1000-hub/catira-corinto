# Checkout Pix Catira — Fase B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development only after the user confirms this plan. Do not start B until that confirmation. No commit, merge, push or PR unless the user asks.

**Goal:** Tirar o form de compra da ficha e abrir um checkout Catira (revisão → endereço → Pix Appmax real → QR → confirmação se `paid`), um item, quantidade 1.

**Architecture:** Sem pedido até “Continuar para pagamento”. Revisão e entrega usam `GET /api/listings/:id` e estado React. O clique cria/reusa via `POST /api/orders` (endereço no body). Depois `GET /api/orders/:id` e `POST /api/orders/:id/pix`. Sem PATCH de endereço, sem lista `GET /api/orders`, sem checkout session, sem cartão.

**Tech Stack:** React + Vite, Express, domínio `orders.js` existente, Appmax JS só para IP, testes `node src/*.test.js` e `node --test frontend/src/*.test.mjs`.

## Global Constraints

- Um produto por pedido. Quantidade fixa 1. Sem stepper.
- Somente Pix. Sem `AppmaxCardForm`, sem parcelas, sem cartões salvos.
- Sem carrinho multi-item. Sem Minhas compras, rastreio, cancelar, reembolso.
- `commercialReady` continua `false`. Não liberar outros produtos. `buyEnabled` inalterado.
- Não alterar o client Appmax. Não misturar `Pay.jsx` / VIP / taxa de anúncio.
- Cliente não manda preço. Frete 0 verdadeiro (não “Frete grátis” de marketplace).
- `GET /api/orders` (lista) e `/api/checkout/sessions` continuam 403.
- Identidade Catira (creme / laranja / branco). UX de etapas do ML, não amarelo/azul.
- Sem commit até o usuário pedir. Sem secrets.

---

## Rotas HTTP existentes (nenhuma rota nova de API)

| Método | Path | Uso na Fase B |
|---|---|---|
| GET | `/api/listings/:id` | Revisão: título, foto, preço, `officialOffers`, `buyEnabled` |
| GET | `/api/config` | `appmax.scriptUrl`, `externalId` (já no `useConfig`) |
| POST | `/api/orders` | Só no “Continuar para pagamento”. Body `{ offerId, quantity: 1, address }` |
| GET | `/api/orders/:id` | Dono: pagamento, QR, poll, confirmação |
| POST | `/api/orders/:id/pix` | Body `{ documentNumber, ip }`. Idempotente se já tem EMV |

Não usar: `GET /api/orders`, `POST /api/checkout/sessions`, `prepareCardCharge`, `quoteInstallments` HTTP.

## Rotas de UI

| Path | Tela | Pedido existe? |
|---|---|---|
| `/anuncio/:id` | Comprar no Catira (sem form) | não |
| `/checkout?listing=:id&offer=:offerId` | Revisão (“Meu carrinho”) | não |
| `/checkout/entrega?listing=:id&offer=:offerId` | Endereço | não |
| `/checkout/:orderId/pagamento` | Pix + CPF + resumo | sim |
| `/checkout/:orderId/pix` | QR / copia-e-cola / poll | sim |
| `/checkout/:orderId/ok` | Confirmado **somente** se `status === 'paid'` | sim |

Sem login: `/entrar?next=` com o path completo (query inclusa).

## Fluxo

1. Ficha: se `!user` → login; se `buyEnabled` → `/checkout?listing=&offer=`.
2. Revisão: 1 item, qtd 1, subtotal/frete/total do servidor (preço da oferta). Continuar → entrega.
3. Entereço (validador atual, **inclui telefone** — o domínio exige). Continuar para pagamento → `POST /api/orders`.
4. `orderId` → `/checkout/:orderId/pagamento`.
5. CPF + IP Appmax JS → `POST .../pix` → `/checkout/:orderId/pix`.
6. Poll `GET .../:id` a cada 8s. `paid` → `/ok`. `expired`/`failed` ficam no Pix.

Refresh em `/checkout?listing=` refaz o form. Depois do POST, a fonte de verdade é o pedido.

## Backend (mínimo)

1. **`serializeBuyerOrder`** — acrescentar campos do próprio pedido, sem Appmax ids, sem `userId`:
   - `createdAt`, `listingId`, `freightCents`, `discountCents`, `unitPriceCents`, `paymentMethod`
2. **Reuso de pedido aberto** — hoje `findOpenOrder` devolve o draft **sem** aplicar o endereço novo. Sem PATCH HTTP: se o aberto for `draft`/`awaiting_payment` **e** não tiver `pixEmv`, gravar o endereço do POST via `patchOrder` já existente e devolver o mesmo id. Se já houver Pix/Appmax, não mudar endereço.
3. **Não** abrir lista, **não** mudar `catiraOfferOf`, transições, webhook, `preparePixCharge`, Appmax client.

## Arquivos

**Criar**

- `frontend/src/pages/Checkout.jsx` — revisão, entrega, pagamento, Pix, ok
- `frontend/src/checkout.test.mjs` — asserts de fonte (rotas, Pix, sem cartão, sem lista)

**Alterar**

- `frontend/src/pages/Listing.jsx` — só botão Comprar; remover form, Pix, Appmax JS, estados de compra
- `frontend/src/App.jsx` — rotas `/checkout`, `/checkout/entrega`, `/checkout/:orderId/pagamento|pix|ok`
- `frontend/src/components.jsx` — `Layout`: esconder tab bar em `/checkout` (CTA fixo)
- `frontend/src/styles.css` — tokens atuais; sticky CTA; steps; Pix
- `frontend/src/catiraOffer.test.mjs` — ficha **não** chama `/api/orders` nem `/pix`
- `frontend/src/appmaxCard.test.mjs` — `data-appmax-customer` no checkout, não na ficha; App.jsx **tem** checkout
- `backend/src/orders.js` — serialize + endereço no reuso sem Pix
- `backend/src/orders.test.js` — serialize e reuso de endereço; lista 403 permanece

## Mudança de `serializeBuyerOrder`

```js
return {
  id: order.id,
  status: order.status,
  totalCents: order.totalCents,
  quantity: order.quantity,
  unitPriceCents: order.unitPriceCents,
  freightCents: order.freightCents || 0,
  discountCents: order.discountCents || 0,
  paymentMethod: order.paymentMethod || null,
  listingId: order.listingId || null,
  createdAt: order.createdAt || null,
  productSnapshot: { title: snap.title || '' },
  address: order.address || null,
  pixEmv: order.pixEmv || null,
  pixQrcode: order.pixQrcode || null,
  pixExpirationDate: order.pixExpirationDate || null,
  commercialReady: false,
};
```

## Reuso com endereço (dentro de `createOrderTx`, no lugar do `if (open) return getOrder(open.id)`)

```js
const open = findOpenOrder(userId, offerId);
if (open) {
  const address = validateAddress(input.address);
  if (!open.pixEmv && !open.appmaxOrderId) {
    patchOrder(open.id, { address });
  }
  return getOrder(open.id);
}
```

`quantityOf` / preço do snapshot **não** mudam no reuso.

## Ficha (Comprar)

```js
onClick={() => {
  if (!user) {
    nav('/entrar?next=' + encodeURIComponent('/checkout?listing=' + item.id + '&offer=' + catiraOffer.id));
    return;
  }
  nav('/checkout?listing=' + item.id + '&offer=' + catiraOffer.id);
}}
```

Sem `loadAppmaxScript` na ficha. Sem `catira-buy-form`. Bloco “em preparação” inalterado.

## Checkout — regras de UI

- `NeedAuth` em todas as telas.
- Revisão: foto `listing.images[0]`, título, “Catira oficial”, qtd **1** texto (não input), `money(catiraOffer.price)`, resumo Produtos / Frete R$ 0,00 / Total. Texto de frete: “Frete R$ 0,00 nesta fase.” Não cupom, não retirada.
- Se oferta sumir ou `!buyEnabled`: erro e link à ficha. Não POST.
- Entrega: mesmos campos do validador (`recipientName`, `phone`, `cep`, `street`, `number`, `complement`, `district`, `city`, `state`, `cityId` default do listing).
- Pagamento: só Pix; total de `GET /api/orders/:id`; CPF; `<form data-appmax-customer hidden />`; sem IP → “Aguarde a verificação da Appmax (IP).”
- Pix: QR (`data:` ou base64), textarea EMV, Copiar, expiração se houver, estados aguardando / pago / expirado / falhou. Poll 8s, parar em terminal. Não confirmar pelo front.
- `/ok`: se status ≠ `paid`, `Navigate` para `/checkout/:id/pix`. Copy: “Seu pagamento foi confirmado! Agora estamos preparando os próximos passos para que seu pedido chegue até você.” Botões: Ver o pedido (fica no ok/resumo) e Voltar ao anúncio (`/anuncio/:listingId`). **Sem** Minhas compras.
- Steps visuais: Carrinho → Entrega → Pagamento. CTA laranja, rodapé fixo no mobile.

## Testes

**Backend** (`node src/orders.test.js` no `backend/`):

- `serializeBuyerOrder` / HTTP 200 traz `createdAt`, `listingId`, `freightCents === 0`, `commercialReady === false`, sem `userId`, sem `appmaxOrderId`.
- 2º `POST /api/orders` mesmo user+oferta, endereço diferente, **sem** Pix: mesmo `id`, `address` novo.
- Com `pixEmv` já gravado: 2º POST não troca endereço.
- `GET /api/orders` 403; checkout session 403; oferta sem `buyEnabled` 403.
- Suite: `npm test` no backend (script atual).

**Frontend** (`node --test src/*.test.mjs` no `frontend/`):

- `catiraOffer.test.mjs`: `Comprar no Catira` + `buyEnabled`; `listing.includes('/api/orders') === false`; `listing.includes('/pix') === false`; `AppmaxCardForm` false; `'/checkout?listing='` true.
- `appmaxCard.test.mjs`: ficha sem `data-appmax-customer` e sem `data-appmax-checkout`; `app.includes('/checkout') === true`; checkout tem `data-appmax-customer` e não tem `AppmaxCardForm` / `data-appmax-checkout`.
- `checkout.test.mjs`: um item; qtd 1; `Pagar e finalizar`; `Pague com Pix`; poll `'/api/orders/'`; sem `prepareCardCharge`, cupom, retirada, `/minhas-compras`, `commercialReady: true`.

**Build:** `npm run build` no `frontend/`.

## Fora da Fase B

Minhas compras, rastreio, cancel/reembolso, cartão, parcelas, cupom, multi-item, `commercialReady`, Appmax client, lista GET, PATCH HTTP, `Pay.jsx`.

## Riscos residuais

- Pedido aberto **com** Pix: endereço do POST é ignorado (Appmax já recebeu). UI do pagamento mostra o endereço do GET.
- Poll 8s: confirmação só depois do webhook + GET Appmax (já existente). Sem Sandbox/HTTPS extra nesta fase.
- `GET /ok` direto sem `paid` redireciona ao Pix — não mente “confirmado”.
- Foto na revisão vem do listing, não do snapshot.

## Estimativa

Listing + rotas + Checkout.jsx + CSS + serialize/reuso + testes + build: uma sessão. Sem commit.

---

Aguardar confirmação expressa deste plano antes de qualquer diff de implementação.
