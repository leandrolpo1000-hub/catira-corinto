# PDP Catira oficial — prazo pela cidade do aparelho

Data: 2026-11-05
Status: arquitetura aprovada em conversa (abordagem A: rota `/produto/:id`)

## Objetivo

Página específica de produto oficial Catira, no espírito da PDP do Mercado Livre (galeria, preço, um prazo, CTA comprar), com visual cream/laranja/branco. O prazo que aparece na hora é o da cidade detectada no celular. Endereço completo só depois da intenção de compra, no checkout.

## Fora de escopo

- Carrinho.
- Reescrever Appmax, `Pay.jsx`, VIP, taxa Pix de anúncio, `commercialReady` (continua `false`).
- Cliente enviar preço.
- `GET /api/orders` lista e `/api/checkout/sessions` continuam 403.
- Pedir CEP/rua/número na PDP.
- Mostrar as duas faixas (Corinto e região / Demais cidades) ao mesmo tempo na PDP.
- Geolocalização em anúncio de particular.
- Intelligence extra, seed pesado, oficiais sample além do que já existe.
- Commit até o usuário pedir.

## Decisões travadas

- Rota nova: `/produto/:id` → `OfficialProduct.jsx`. Só `item.isOfficial`.
- Classificado continua em `/anuncio/:id` (`Listing.jsx`).
- Card/feed/Home/Search de oficial aponta para `/produto/:id`.
- `/anuncio/:id` de oficial redireciona para `/produto/:id` (links antigos).
- `/produto/:id` de não-oficial redireciona para `/anuncio/:id`.
- Cidade na hora: GPS uma vez por sessão + fallback chip `useCity` + Corinto.
- Uma linha de prazo. Sem a segunda faixa. Checkout recalcula se o endereço for outra cidade.
- Endereço só no checkout, depois de **Comprar pelo Catira**.
- CTA único na PDP. Mercado Livre fica secundário (“Prefere comprar no Mercado Livre?”).
- Sem carrinho. Sem 2ª CTA de paridade com “Adicionar ao carrinho”.
- Preço só do `catiraOffer` devolvido pelo servidor.

## Cidade e prazo

### Resolução da cidade (cliente)

Ordem, parar no primeiro hit:

1. `sessionStorage.catira_geo_city` se for um nome de `CITY_NAMES`.
2. `navigator.geolocation.getCurrentPosition` (timeout 6s, `maximumAge` 30 min). Com lat/lng, escolher a cidade das 34 com menor distância haversine a um mapa estático de centroides em `frontend/src/cityCentroids.js`. Se a menor distância for > 80 km, tratar como **fora da região**.
3. Chip `useCity().city` se preenchido.
4. `'Corinto'`.

Negar GPS ou falha: pular para 3. Não mostrar modal de endereço. Não chamar Nominatim/Google (sem PII de rua para terceiro).

Persistir só o **nome da cidade** (ou o marcador `fora`) em `sessionStorage`. Não gravar lat/lng.

### Faixas (iguais ao card atual)

| zona | prazo | critério |
|---|---|---|
| região | 2 a 5 dias úteis | cidade resolvida está em `CITY_NAMES` (as 34) |
| fora | 5 a 12 dias úteis | GPS longe demais, ou cidade do chip/cadastro fora da lista |

Copy na PDP (uma linha, verde Catira):

- Região: `Chega em 2 a 5 dias úteis em {cidade}`
- Fora: `Chega em 5 a 12 dias úteis`

Hint fixo abaixo: `Prazo estimado, sujeito à confirmação do endereço na compra.`

Não listar “Corinto e região” e “Demais cidades” juntos. Não inventar dia da semana (“domingo”).

### Checkout

Fluxo atual `/checkout?listing=&offer=` permanece. Formulário de endereço **já existente** é a confirmação. Se `form.city` cair em `CITY_NAMES`, mostrar o prazo região; senão o prazo fora. Não criar etapa nova. Não alterar Pix/cartão/Appmax.

## Layout PDP (`OfficialProduct.jsx`)

Mobile-first. Tokens Catira (cream/laranja/branco). Sem azul ML, sem badge Black Friday, sem parcelas, sem seletor de cor/RAM (não existem no dado).

Ordem:

1. Galeria full-bleed: fotos do listing, voltar, favoritar, compartilhar, `n/N`.
2. Selo `CATIRA OFICIAL`.
3. Título (`item.title`).
4. Preço do `catiraOffer.price` via `money()`. Se `previousPrice` > price, mostrar riscado.
5. Linha única de entrega + hint (acima).
6. Se `catiraOffer.buyEnabled`: botão **Comprar pelo Catira** → login se preciso → `/checkout?listing={id}&offer={offerId}`.
7. Se `!buyEnabled`: bloco “Em preparação” (copy atual).
8. Se houver `officialOffers` externos: “Prefere comprar no Mercado Livre?” + botão secundário ghost (abre `o.url`).
9. Descrição.
10. Bloco vendedor CATIRA OFICIAL (avatar C, “Produto vendido pela plataforma”).

Barra inferior sticky só com **Comprar pelo Catira** (um CTA). Sem “Adicionar ao carrinho”.

Ícones SVG/CSS já do app. Sem emoji estrutural.

## Listing enxuto e navegação

- `Listing.jsx`: se `item.isOfficial`, `Navigate` para `/produto/:id`.
- Cards (`components.jsx` AdCard / list-item, Home want-card, Search): `to={item.isOfficial ? '/produto/' + item.id : '/anuncio/' + item.id}`.
- Checkout “Voltar ao anúncio” de oficial: `/produto/:id`.
- Chat/admin de particular continuam `/anuncio/:id`.

Não duplicar o bloco `official-buy` de duas faixas. Ele some porque oficiais não renderizam mais essa UI em `Listing.jsx`.

## Arquivos

| arquivo | mudança |
|---|---|
| `frontend/src/pages/OfficialProduct.jsx` | PDP nova |
| `frontend/src/cityCentroids.js` | 34 pares lat/lng + `nearestCity(lat, lng)` |
| `frontend/src/geoCity.js` | resolve cidade da sessão (GPS → centroid → chip → Corinto) |
| `frontend/src/deliveryEta.js` | `{ label, daysLabel, zone }` a partir da cidade |
| `frontend/src/App.jsx` | rota `/produto/:id` |
| `frontend/src/pages/Listing.jsx` | redirect oficial |
| `frontend/src/components.jsx` | link do card |
| `frontend/src/pages/Checkout.jsx` | copy de prazo + voltar para `/produto` |
| `frontend/src/styles.css` | galeria PDP, linha de entrega, CTA sticky |
| `frontend/src/officialProduct.test.mjs` | zona/prazo, redirect, copy |

## Testes

- Cidade em `CITY_NAMES` → texto contém `2 a 5 dias úteis` e o nome da cidade.
- Fora / `fora` → `5 a 12 dias úteis`, sem listar as duas faixas.
- `isOfficial` no Listing dispara redirect `/produto/:id` (teste da função/helper de path, não precisa de router e2e).
- `productPath(item)` → `/produto/:id` se oficial, senão `/anuncio/:id`.
- Checkout: cidade Corinto → prazo região; cidade “Belo Horizonte” → prazo fora.
- GPS negado usa chip; chip vazio usa Corinto.
- Sem chamada de geocode HTTP.

## Verificação manual

- Abrir um oficial (sample) em `/produto/:id`: um prazo, um CTA, ML secundário.
- Negar GPS: prazo da cidade do chip.
- Comprar → checkout pede endereço; prazo atualiza se a cidade mudar.
- Classificado continua `/anuncio/:id` com chat/WhatsApp.

## Riscos

- Centroides aproximados: 80 km cobre o entorno das 34; cidade GPS em BH cai em “fora” (5–12), correto.
- iOS Safari exige HTTPS para geolocation; preview já é HTTPS.
- Primeira visita pede permissão: se recusar, fallback silencioso, sem banner de erro.
