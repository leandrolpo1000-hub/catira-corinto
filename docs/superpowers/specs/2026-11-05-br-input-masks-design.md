# Máscaras brasileiras nos campos de digitação

Data: 2026-11-05
Status: arquitetura aprovada em conversa (abordagem A: helpers no `onChange`)

## Objetivo

Todo campo de digitação do Catira cuja informação tem formato brasileiro mostra esse formato **enquanto a pessoa digita**. A API continua recebendo o que já recebe hoje (dígitos, número, ISO). Sem biblioteca nova.

## Fora de escopo

- Validar dígito verificador de CPF/CNPJ.
- Busca de CEP (ViaCEP/Correios).
- Reescrever Appmax, fluxo Pix, VIP, listing-fee Pix, `commercialReady`.
- Cliente enviar preço no checkout.
- Máscara em e-mail, senha, nome, rua, bairro, complemento, busca livre, código de 6 dígitos, URLs, chaves de API, IDs, percentuais, horas/minutos, estoque, inteiros administrativos.
- Commit até o usuário pedir.

## Decisões travadas

- Escopo: **todo o app** (público e admin).
- Mecânica: **máscara ao digitar** (`onChange` + helper), não só placeholder.
- Datas: texto `dd/mm/aaaa` (troca `type="date"`).
- Abordagem A: módulo `frontend/src/masks.js` + `digitsOnly` / `parseBRL` já existentes. Sem `MaskedInput` genérico. Sem `react-imask`.
- Estado da tela guarda o valor **mascarado**. No POST, tira a máscara.
- Valor antigo sem máscara (telefone no perfil) é formatado na carga (`useEffect` / init do form).
- Cartão Appmax: formulário continua **não controlado** (o JS da Appmax lê `name=`). Número: só dígitos, `maxLength={16}`, placeholder `0000 0000 0000 0000` (sem espaços no valor — tokenização). Validade: um campo `MM/AA` (máscara) que preenche `exp-month` / `exp-year` hidden, **ou** os dois campos atuais com `maxLength` 2 e 4 e placeholder `MM` / `AA` (não `AAAA`). CVV: só dígitos, `maxLength={4}`. Sem `value` React nesses inputs.

## Helpers (`frontend/src/masks.js`)

Importa `digitsOnly` de `api.js`. Não duplica `formatBRLInput` / `parseBRL` (continuam em `api.js`).

| Função | Máscara | Limite de dígitos |
|---|---|---|
| `formatPhoneBr(value)` | `(38) 9999-9999` (10) ou `(38) 99999-9999` (11) | 11 |
| `formatCep(value)` | `39200-000` | 8 |
| `formatCpf(value)` | `000.000.000-00` | 11 |
| `formatCnpj(value)` | `00.000.000/0001-00` | 14 |
| `formatCpfCnpj(value)` | CPF até 11 dígitos; CNPJ depois | 14 |
| `formatUf(value)` | `MG` | 2 letras A–Z |
| `formatBrDate(value)` | `dd/mm/aaaa` | 8 |
| `parseBrDate(value)` | `"25/12/2026"` → `"2026-12-25"`; inválida → `''` | — |
| `formatCardNumber(value)` | `ACCT-000003` | 16 (19 se quiser, mas Catira/Appmax = 16) |
| `formatCardExpiry(value)` | `MM/AA` | 4 |
| `formatCvv(value)` | só dígitos | 4 |

`digitsOnly` já existe em `api.js`. Reexportar de `masks.js` se as telas preferirem um import só.

Telefone: com 10 dígitos usa o bloco 4+4 (`(38) 3333-3333`); no 11º dígito vira 5+4 (`(38) 99999-9999`). DDD sem `+55` no campo (Brasil implícito).

UF: `toUpperCase`, só A–Z, `slice(0, 2)`.

Data: não aceita letra; barras entram automaticamente (`25122026` → `25/12/2026`). `parseBrDate` rejeita dia/mês impossível (retorna `''`); o submit atual já trata required.

Dinheiro: campos que já usam `formatBRLInput` ficam. Os que ainda são `type="number"` / `step="0.01"` para **reais** passam para o mesmo helper (texto + `inputMode="numeric"` + placeholder `0,00`). Inteiros (horas, usos, %) **não**.

## Mapa de telas

| Tela | Campos | Helper |
|---|---|---|
| `Auth.jsx` cadastro | Telefone / WhatsApp | `formatPhoneBr` |
| `Profile.jsx` | Telefone | `formatPhoneBr` |
| `LanceHub.jsx` pedido catireiro | Telefone | `formatPhoneBr` |
| `Checkout.jsx` entrega | Telefone, CEP, Estado | phone, cep, uf |
| `Checkout.jsx` pagamento | CPF/CNPJ | `formatCpfCnpj` |
| `AppmaxCardForm.jsx` | número, validade, CVV | ver decisão Appmax acima |
| `Create.jsx` / `IntelligentCreate.jsx` / `Search.jsx` / `Listing.jsx` extra / `Auction.jsx` lance inicial | dinheiro | já `formatBRLInput` |
| `Admin.jsx` taxas R$ | dinheiro | já `formatBRLInput` |
| `Admin.jsx` chave Pix | conforme `pixKeyType`: phone / cpf / cnpj; e-mail e random sem máscara | phone, cpf, cnpj |
| `AdminOfficial.jsx` / `AdminLance.jsx` preços R$ | dinheiro | já `formatBRLInput` |
| `AdminAuctions.jsx` | datas `type="date"` → texto BR; campos R$ `type="number"` → `formatBRLInput` | `formatBrDate` + BRL |
| `Pay.jsx` cupom | sem máscara (código) | — |

`inputMode`: tel para telefone; numeric para CEP, CPF/CNPJ, dinheiro, cartão, data, CVV. `autoComplete` existente se mantém (`tel`, `postal-code`, `cc-number`). Placeholder = exemplo da máscara.

## Envio à API

- Telefone, CEP, CPF, CNPJ, cartão: `digitsOnly(mascarado)` no payload.
- UF: duas letras.
- Data: `parseBrDate` → `yyyy-mm-dd` se o backend hoje recebe ISO (leilão). Se algum endpoint já aceita o string livre, não mudar o contrato — só a UI.
- Dinheiro: `parseBRL` como hoje.
- Checkout endereço: CEP/telefone mascarados na tela; POST com dígitos (conferir `validateAddress` no backend — se hoje aceita `39200-000` ou só `39200000`, o cliente envia o que o validador já exige).

Não alterar rotas, `commercialReady`, nem serialização de pedido.

## Erros

Máscara ≠ validação. Submit continua com required / tamanho atuais. Sem toast extra de “CPF inválido”. Sem modal. Placeholder mostra o formato.

## Testes

Arquivo `frontend/src/masks.test.mjs` (`node --test`):

- telefone 10 → `(38) 3333-3333`; 11 → `(38) 99999-9999`
- CEP `39200000` → `39200-000`
- CPF 11 dígitos com pontos/hífen
- CNPJ 14 dígitos
- `formatCpfCnpj` troca no 12º dígito
- `formatBrDate('25122026')` → `25/12/2026`; `parseBrDate` → `2026-12-25`; `31/02/2026` → `''`
- `formatUf('mgx')` → `MG`
- `formatCardNumber` / `formatCardExpiry('1226')` → `12/26`
- round-trip: `digitsOnly(formatPhoneBr(digits)) === digits`
- Auth/Checkout/Profile/LanceHub source-string: importam o helper e não deixam telefone/CEP/doc crus no `onChange` (mesmo estilo dos testes atuais)

Não quebrar `checkout.test.mjs`, `catiraOffer.test.mjs`, `appmaxCard.test.mjs`.

## Arquivos

| arquivo | mudança |
|---|---|
| `frontend/src/masks.js` | helpers novos |
| `frontend/src/masks.test.mjs` | comportamento + greps de tela |
| `frontend/src/pages/Auth.jsx` | telefone |
| `frontend/src/pages/Profile.jsx` | telefone na carga e no `onChange` |
| `frontend/src/pages/LanceHub.jsx` | telefone |
| `frontend/src/pages/Checkout.jsx` | phone, cep, uf, doc |
| `frontend/src/AppmaxCardForm.jsx` | `onInput` ou placeholder+maxLength (ver Appmax) |
| `frontend/src/pages/Admin.jsx` | chave Pix por tipo |
| `frontend/src/pages/AdminAuctions.jsx` | datas BR; R$ que ainda são `type=number` |
| demais preços `type=number` em R$ | `formatBRLInput` |

`api.js` `digitsOnly` / `formatBRLInput` / `parseBRL` permanecem.

## Riscos

- Appmax JS lendo `card-number` com espaços: preferir dígitos se o token falhar.
- Backend de endereço/telefone que já persiste com pontuação: `digitsOnly` no POST pode divergir do que está no banco. Conferir `validateAddress` e o cadastro (`Auth`) — se o servidor grava o string cru, ou normalizamos no client só para display e enviamos o mesmo shape de hoje, ou enviamos dígitos se o server já faz `replace(/\D/g)`. A implementação **lê o backend primeiro** e não muda o contrato.
- `type="date"` → texto: o valor controlado hoje é ISO. Na carga, `2026-12-25` vira `25/12/2026`; no save, o inverso.

## Verificação manual

- Cadastro: telefone ganha parênteses e hífen.
- Checkout: CEP `39200-000`, UF `MG`, CPF pontuado, data leilão `dd/mm/aaaa`.
- Perfil com telefone antigo `38999999999` abre já mascarado.
- Pix admin: tipo celular mascara; tipo e-mail não.
- Classificado / busca preço continua `0,00`.
