# Heavy demo seed — 100 anúncios, 34 cidades, catireiros

Data: 2026-11-04
Status: arquitetura aprovada em conversa (abordagem A: `ensureHeavyDemo` no boot)

## Objetivo

Encher o marketplace de demonstração: 100 anúncios publicados com 4 fotos reais cada, cobrindo as 10 categorias, 100 usuários comuns + 10 catireiros, espalhados em 34 cidades. Serve para Home, busca, Admin e Intelligence parecerem um mercado real, sem pedidos Appmax e sem apagar o banco.

## Fora de escopo

- Wipe / reset destrutivo do SQLite ou `db.json`.
- Pedidos Appmax, cartão, Pix de compra, webhooks, GMV.
- Alterar `commercialReady`, VIP, `Pay.jsx`, taxa Pix de anúncio real, oficiais sample, Teste Pix R$ 10.
- Eventos Intelligence extras para este lote (o `ensureDemoEvents` atual permanece).
- Commit / push até o usuário pedir.
- Fase C.
- Corrigir Vosk (`transcribeLocal.test.js`) ou o chat da Maria.
- Commitar JPEGs no git.

## Decisões travadas

- Superfície: `ensureHeavyDemo()` em `backend/src/seed.js`, chamada no fim de `ensureExtras()` (depois de cidades/categorias/auction/action/chat, antes de Intelligence no `server.js`).
- Idempotente: se já existem as 100 contas `demo.user.NNN@catira.local` **e** 100 listings com `source: 'demo-heavy'`, retorna sem gravar.
- Sem wipe. João, Maria, Pedro, Ana, master, oficiais, samples, Intelligence demo e chats atuais ficam.
- Catireiro = `role === 'user'` + `dealerApplications.status === 'approved'` + `dealerProfiles.status === 'active'`.
- Fotos: Unsplash (HTTPS, sem API key), cache local em `backend/uploads/demo/` (já coberto por `backend/uploads/` no `.gitignore`). URL pública `/uploads/demo/{file}.jpg`.
- Pagamento de anúncio: `payments` Pix demo interno (`PIX-DEMO-HEAVY-…`), igual ao seed atual. Sem Appmax.
- 5 cidades novas (eixo centro-oeste): Dores do Indaiá, Luz, Bom Despacho, Quartel Geral, Cedro do Abaeté. As 29 atuais permanecem.
- Contas novas: 100 comuns + 10 catireiros (além do seed atual).
- Anúncios: 10 por categoria. Donos: cada um dos 10 catireiros publica 4 (40); 60 dos 100 usuários comuns publicam 1 cada.
- `commercialReady` permanece `false`. Cliente nunca envia preço.

## Cidades (34)

`CITY_NAMES` em `seed.js` passa a ter 34 nomes. `CITIES` e `ensureCities()` já inserem o que faltar.

As 29 atuais:

Corinto, Curvelo, Três Marias, Felixlândia, Abaeté, Martinho Campos, Morro da Garça, Santo Hipólito, Monjolos, Augusto de Lima, Inimutaba, Presidente Juscelino, Lassance, Buenópolis, Joaquim Felício, Gouveia, Várzea da Palma, Diamantina, Paraopeba, Santana de Pirapama, Morada Nova de Minas, Pompéu, Cordisburgo, Jequitaí, Datas, Presidente Kubitschek, São Gonçalo do Abaeté, Paineiras, Biquinhas.

As 5 novas:

Dores do Indaiá, Luz, Bom Despacho, Quartel Geral, Cedro do Abaeté.

Slug via `citySlug` existente (`dores-do-indaia`, `luz`, `bom-despacho`, `quartel-geral`, `cedro-do-abaete`). Estado `MG`.

Usuários e anúncios deste lote rotacionam `city`/`cityId` nas 34, não só Corinto.

## Contas

Senha de todas as contas novas: `123456` (mesmo hash bcrypt do seed atual). Status `active`. `phoneVerified: true`. `role: 'user'`.

### 100 usuários comuns

| campo | valor |
|---|---|
| email | `demo.user.001@catira.local` … `demo.user.100@catira.local` |
| name | nome brasileiro gerado (lista fixa de prenomes + sobrenomes, índice estável) |
| phone | `3899` + 7 dígitos derivados do índice (único) |
| city / cityId | `CITIES[i % 34]` |

Não criam `dealerApplications` nem `dealerProfiles`.

### 10 catireiros

| campo | valor |
|---|---|
| email | `demo.dealer.01@catira.local` … `demo.dealer.10@catira.local` |
| name | nome brasileiro distinto da lista de users |
| phone | `3888` + 7 dígitos derivados do índice (único, sem colidir com users) |
| city / cityId | `CITIES[i % 34]` |

Para cada um, nesta ordem:

1. `users` insert.
2. `dealerApplications`: `status: 'approved'`, `termsAcceptedAt` agora, `categories` = 2 slugs canônicos (ids atuais), `regions` = cidade do dealer + 1 vizinha, `reviewedBy` = master id se existir.
3. `dealerProfiles`: `status: 'active'`, `founder: false`, mesmos `categories`/`regions`/`city`/`phone`, `approvedAt` agora.

João/Maria/Pedro/Ana/master **não** são promovidos a catireiro neste lote.

## Anúncios (100)

Marcador: `source: 'demo-heavy'` no documento do listing (campo novo, ignorado pelo serialize se o frontend não ler).

Distribuição:

- 10 categorias canônicas (`CATEGORIES` em `categories.js`).
- 10 anúncios por slug.
- 40 anúncios: 4 por catireiro (os 10 dealers).
- 60 anúncios: 1 por usuário comum, usando `demo.user.001` … `demo.user.060`.
- `demo.user.061` … `100` existem e não anunciam neste lote.

Campos por listing:

- `status: 'published'`
- `listingType`: 70 `venda`, 15 `venda_troca`, 10 `troca`, 5 `procuro` (índice estável, não aleatório em runtime)
- `condition`: `usado` / `seminovo` / `novo` rotacionados
- `price`: faixa realista por categoria (tabela abaixo), inteiro BRL
- `city` / `cityId`: cidade do dono
- `views`: 3–80 derivados do índice
- `featured: false`, `vip: false`
- `createdAt` / `publishedAt` / `paidAt`: últimos 25 dias, espaçados
- `expiresAt`: `publishedAt + LISTING_DAYS`
- `acceptsTrade` / `acceptsCash` coerentes com `listingType`

Títulos e descrições: catálogo fixo de 10 produtos por categoria (100 linhas), em português, estilo classificado do interior de MG. Sem emoji no título.

### Faixa de preço (BRL)

| slug | min | max |
|---|---|---|
| veiculos | 800 | 28000 |
| tecnologia | 80 | 3500 |
| casa-moveis | 40 | 1800 |
| moda | 25 | 400 |
| ferramentas | 30 | 900 |
| agro | 50 | 2500 |
| animais | 40 | 1200 |
| lazer | 30 | 1500 |
| imoveis | 15000 | 180000 |
| servicos | 40 | 600 |

`procuro` usa a mesma faixa como teto que o anunciante pagaria.

### Pagamento interno

Um `payments` por listing:

- `amount: LISTING_FEE` (5)
- `status: 'paid'`, `method: 'pix'`, `kind: 'listing'`
- `transactionId: 'PIX-DEMO-HEAVY-' + listing.id.slice(0, 8).toUpperCase()`
- Sem `appmaxOrderId`, sem `pixEmv` de compra.

## Fotos (400)

Cada listing tem exatamente 4 `listingImages` (`order` 0–3): frente, lado, detalhe, contexto.

### Download

Helper `ensureDemoPhoto(fileName, query)`:

1. Destino `backend/uploads/demo/{fileName}`.
2. Se o arquivo já existe e tamanho > 1 KB, reusa.
3. Senão GET HTTPS Unsplash Source, timeout 8s, follow redirect, gravar JPEG.
4. URL canônica de download: `https://images.unsplash.com/photo-…` **não**. Usar `https://source.unsplash.com/800x600/?{encodeURIComponent(query)}` (um query por foto). Se Source falhar (410/redirect loop), fallback `https://images.unsplash.com/featured/800x600/?{query}`.
5. Header `User-Agent: CatiraDemoSeed/1.0`.
6. Se o download falhar: não quebra o seed; grava `listingImages` com URL `/api/placeholder/{listingId}/{idx}?c=…&t=…` (SVG atual) só naquela foto.

Queries: mapa estável categoria × índice × slot, em inglês (Unsplash indexa melhor). Ex. `veiculos` + 0 + frente → `motorcycle,honda`; lado → `motorcycle,side`. Sem termos de marca registrada quando der para evitar.

Arquivo: `demo-{categorySlug}-{listingIndex}-{slot}.jpg` (listingIndex 0–9 por categoria).

Servir: `app.use('/uploads', express.static(...))` já existe. Nada novo no `server.js` além da chamada `ensureHeavyDemo`.

Boot: downloads só na primeira vez (cache em disco). Reinício com cache quente não bate na rede.

## Idempotência

Ordem dentro de `ensureHeavyDemo()`:

1. `ensureCities()` (já chamado antes; chamar de novo é barato).
2. Se `db.count('users', email match /^demo\.user\.\d{3}@catira\.local$/ ) >= 100` **e** `db.count('listings', source === 'demo-heavy') >= 100`, return.
3. Criar users que faltam (por email).
4. Criar dealers que faltam (por email + profile active).
5. Criar listings `demo-heavy` que faltam até 100, com 4 imagens cada.

Não atualiza título/preço/fotos de listings já gravados. Não apaga listings oficiais nem os 4–6 do seed original.

## Testes

Arquivo `backend/src/seed.heavy.test.js` (ou bloco em teste de seed existente, se houver). Isolado: DB temporário / `db.reset` do padrão atual dos testes.

Casos:

1. Primeira chamada cria 100 users demo, 10 dealers (profile active), 34 cities, 100 listings `demo-heavy`, 400 images (4 por listing), 10 listings por slug.
2. Segunda chamada: contagens iguais, nenhum id novo.
3. Nenhum listing `demo-heavy` tem `appmaxOrderId` nem `payments.method === 'card'`.
4. Cada um dos 10 `demo.dealer.NN` tem `dealerProfiles.status === 'active'` e `dealerApplications.status === 'approved'`.
5. As 5 cidades novas existem com `state: 'MG'`.

Download Unsplash: o teste **não** bate na rede. Stub do helper de foto (ou env `CATIRA_DEMO_PHOTOS=stub`) para forçar placeholder SVG no teste.

Não alterar `transcribeLocal.test.js`. Não exigir `maria@email.com` além do que o seed original já faz.

## Arquivos

| arquivo | mudança |
|---|---|
| `backend/src/seed.js` | `CITY_NAMES` +5; catálogo 100 produtos; `ensureHeavyDemo`; export |
| `backend/src/server.js` | nenhuma, se a chamada ficar só em `ensureExtras` |
| `backend/src/seed.heavy.test.js` | testes acima |
| `.gitignore` | nada (uploads já ignorado) |
| `docs/superpowers/specs/2026-11-04-heavy-demo-seed-design.md` | este arquivo |

## Verificação manual (depois do boot)

- Home / busca mostram dezenas de cards com JPEG, não só SVG.
- Filtro por cada categoria devolve ~10 do lote + o que já existia.
- Admin → usuários: filtro Catireiro mostra os 10 `demo.dealer.*`.
- 34 cidades no cadastro / filtro de cidade.
- Nenhum pedido Appmax novo. Intelligence continua só com os eventos demo atuais.

## Riscos

- Unsplash Source pode 410. Fallback `images.unsplash.com/featured` + SVG por foto evita seed morto.
- Boot frio (400 downloads) pode passar de 1–2 min. Aceitável na primeira subida; cache resolve as seguintes.
- 110 bcrypt `hashSync` no primeiro boot: lento mas uma vez só. Reusar o mesmo hash gerado uma vez no início da função.
- SQLite/JSON grande: 100 listings + 400 images cabe no `records` atual.
