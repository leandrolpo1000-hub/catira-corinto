# Admin master: credenciais Appmax Sandbox

Data: 2026-11-04
Status: aprovado em conversa

## Objetivo

O admin master preenche Client ID, Client Secret e External ID da Appmax Sandbox pela aba **Appmax** do painel Catira. O Catira gera o token do webhook, grava no SQLite e tenta o login OAuth na Sandbox. Assim o usuário leigo não precisa editar `.env` nem `config.js`.

## Fora de escopo

- Checkout público, Comprar, `commercialReady`, 2E, reembolso, fornecedor, frete, VIP/`pix.js`.
- Montar `AppmaxCardForm` na ficha.
- Criar cliente, pedido ou cobrança na Appmax.
- Ambiente production/`prod`.
- Editar `config.js` ou gravar `.env`.
- Commit, publish, domínio HTTPS público.
- Rotacionar token por botão extra.
- Qualquer admin que não seja master.

## Decisões travadas

- Só **master** (igual PIX/e-mail). Outro papel: 403.
- Aba nova **Appmax**, não misturar com PIX.
- Persistência: `settings` id `appmax` no SQLite. Nada em arquivo de código.
- Merge em runtime, **por chave**: `process.env` não vazio ganha; senão o valor do banco.
- Ambiente fixo **sandbox**. O formulário não tem campo de ambiente. `USER_APPMAX_ENV=production`/`prod` continua `describeConfig.env=invalid`.
- Token do webhook: o Catira gera na primeira gravação (se ainda não houver no banco e não houver env). Imprevisível (`crypto.randomBytes`). Master não cola token.
- Ao salvar: grava primeiro; depois tenta só `getAccessToken()` com as credenciais **efetivas** (env se existir, senão o recém-salvo). OAuth client_credentials na Sandbox. Sem `/v1/customers`, `/v1/orders`, pagamentos.
- Login falhou: chaves **já ficam salvas**; a resposta traz o erro da Appmax (texto, sem secret). Master corrige e salva de novo.
- Sem os três (Client ID, Secret efetivo, External ID): 400, não grava.
- PUT com Secret vazio ou mascarado (`•`/`*`): mantém o Secret já salvo.
- GET master **nunca** devolve Client Secret cru. Devolve `clientSecretSet` + `clientSecretHint` (mesmo padrão do Resend: 3 + `••••` + 4; curto demais → `••••`).
- GET master **devolve** Client ID e External ID em claro (para conferir/editar).
- GET/PUT master **devolve** `webhookUrl` com o token **efetivo** (env se existir, senão o do banco), só para o master copiar no painel Appmax. Não há campo editável de token. Formato: `https://SEU-DOMINIO/api/appmax/webhooks/<TOKEN>`. Sem domínio público configurado, o prefixo fica o literal `https://SEU-DOMINIO`.
- `webhookToken` cru **não** vai como campo separado no JSON. O token só aparece dentro de `webhookUrl`.
- Quem consome Appmax (`credentialsOf`, `publicConfig`, `describeConfig`, rota de webhook) passa a ler o **merge** env+banco, não só `process.env`.

## Por que o banco e não o `.env`

Neste ambiente o usuário não consegue editar variáveis nem arquivos. O padrão PIX/e-mail/assistente já grava em `settings`. Env, se um dia existir, continua tendo prioridade, então hospedagem real não quebra.

## Tela

Aba **Appmax** visível só se `isMaster`.

Textos em português simples:

- Client ID
- Client Secret (tipo senha; placeholder = hint se já salvo; vazio = manter)
- External ID

Sem campo de token, sem campo de ambiente.

Depois do GET/PUT com sucesso:

- Presença: Client ID / Secret / External ID / webhook: salvo ou faltando
- `webhookUrl` para colar no painel Merchant Sandbox
- Resultado do teste, só no PUT: `authTest.ok === true` → “Login na Sandbox ok”; senão a mensagem de erro

## API

`GET /api/admin/appmax` e `PUT /api/admin/appmax`, ambos `masterRequired`.

### GET (exemplo de forma)

```json
{
  "clientId": "",
  "clientSecretSet": false,
  "clientSecretHint": "",
  "externalId": "",
  "webhookConfigured": false,
  "webhookUrl": "",
  "env": "sandbox",
  "source": {
    "clientId": "absent",
    "clientSecret": "absent",
    "externalId": "absent",
    "webhookToken": "absent"
  }
}
```

`source.*`: `env` | `settings` | `absent` (o que o runtime está usando).

### PUT body

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "externalId": "..."
}
```

Resposta = mesmo formato do GET + `authTest: { ok: true }` ou `authTest: { ok: false, error: "..." }`. HTTP 200 se gravou, mesmo com login falho. HTTP 400 só se faltar dado obrigatório.

## Runtime

Novo leitor único (ex.: em `appmax.js`): para cada chave `USER_APPMAX_*`, se `process.env[key]` trimmed não vazio, usa env; senão o campo correspondente em `settings.appmax`.

A rota `POST /api/appmax/webhooks/:token` compara o path com o token **efetivo** (merge), não só env.

`publicConfig().externalId` e `describeConfig()` usam o mesmo merge. Presença-only em `describeConfig` não muda: nunca vaza valor.

## Dados

Linha `settings`:

- `id`: `appmax`
- `clientId`, `clientSecret`, `externalId`, `webhookToken` (strings)

Backup SQLite já inclui `settings`. Sem tabela nova.

## Erros

| Caso | HTTP | Efeito |
|---|---|---|
| Não autenticado | 401 | — |
| Autenticado, não master | 403 | — |
| Falta Client ID, Secret efetivo ou External ID | 400 | Não grava |
| Login Sandbox falhou | 200 | Gravou; `authTest.ok=false` |
| Login Sandbox ok | 200 | Gravou; `authTest.ok=true` |

Mensagens de auth: as já usadas em `getAccessToken` (401, timeout, resposta inválida). Sem secret no JSON nem no log da resposta.

## Testes

Arquivo novo no backend (espelhando mail/admin), com Appmax **falsa** (fetch mock):

- GET/PUT 403 se não master; 401 sem login
- PUT sem os três → 400; banco inalterado
- PUT válido gera `webhookToken` e devolve `webhookUrl` contendo o token; GET seguinte não traz `clientSecret` nem campo `webhookToken`
- PUT com secret vazio/mascarado preserva o secret
- Env preenchido ganha do banco no merge (`source.*.env`)
- Login mock 200 → `authTest.ok`
- Login mock 401 → 200 HTTP, `authTest.ok=false`, registro salvo
- Webhook POST com token do banco (env vazio) → 200; token errado → 404

Sem chamada de rede real nos testes.

## Não muda

- 403 em `POST/GET /api/orders` e `/api/checkout/sessions` para o público
- Pedidos admin somente leitura
- `AppmaxCardForm` desligado da ficha
- PIX de anúncio/VIP
