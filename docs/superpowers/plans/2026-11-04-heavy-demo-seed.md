# Heavy Demo Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Idempotent boot seed that fills the marketplace with 100 published listings (4 photos each), 100 demo users plus 10 catireiros, across 34 MG cities, without Appmax orders or a DB wipe.

**Architecture:** `ensureHeavyDemo()` in `backend/src/seed.js`, called at the end of `ensureExtras()`. Catalog, names, Unsplash queries, and listing types are deterministic tables. Photos download once into `backend/uploads/demo/` (gitignored); tests stub the downloader. Marker `source: 'demo-heavy'` plus emails `demo.user.NNN@catira.local` / `demo.dealer.NN@catira.local` make re-runs a no-op.

**Tech Stack:** Node commonjs, bcryptjs, `node:https` for Unsplash, SQLite document store (`db.js`), `assert` tests via `node src/seed.heavy.test.js`.

## Global Constraints

- Do not wipe SQLite / `db.json`. João, Maria, Pedro, Ana, master, officials, samples, Intelligence demo stay.
- No Appmax orders, card charges, purchase Pix, or webhooks. Listing fee = internal Pix demo (`PIX-DEMO-HEAVY-…`).
- `commercialReady` stays false. Client never sends price.
- Do not change VIP, `Pay.jsx`, listing-fee Pix real flow, sample officials, Teste Pix R$ 10.
- Do not add Intelligence events for this lote (`ensureDemoEvents` unchanged).
- Do not commit unless the user asks. Skip every Commit step.
- Do not fix Vosk (`transcribeLocal.test.js`) or Maria chat seed.
- Do not commit JPEGs. `backend/uploads/` is already gitignored.
- Catireiro = `role === 'user'` + `dealerApplications.status === 'approved'` + `dealerProfiles.status === 'active'`.
- Tests must not hit the network. Use `CATIRA_DEMO_PHOTOS=stub` (or injected `fetchPhoto`).
- Hash bcrypt once per `ensureHeavyDemo` call and reuse (`123456`).
- Skip Commit steps in every task.

---

### Task 1: 34 cities + catalog constants + photo helper stub

**Files:**
- Modify: `backend/src/seed.js` (`CITY_NAMES`, new constants + `ensureDemoPhoto`, export)
- Create: `backend/src/seed.heavy.test.js`
- Modify: `backend/package.json` (`test` script: add `node src/seed.heavy.test.js` after `intelligence.test.js`)

**Interfaces:**
- Consumes: existing `citySlug`, `CITIES`, `CATEGORIES`, `db`, `bcrypt`
- Produces:
  - `CITY_NAMES` length 34 (5 new names at the end)
  - `DEMO_FIRST_NAMES` array (string, length >= 20)
  - `DEMO_LAST_NAMES` array (string, length >= 15)
  - `HEAVY_CATALOG` array length 100: `{ slug, title, description, subcategory, price, photoQueries: [string, string, string, string] }`
  - `ensureDemoPhoto(fileName, query)` → `{ url: string, local: boolean }`
  - `demoUserEmail(n)` → `demo.user.001@catira.local` (n is 1-based, padded 3)
  - `demoDealerEmail(n)` → `demo.dealer.01@catira.local` (n is 1-based, padded 2)
  - `ensureHeavyDemo()` exported but may still be a no-op until Task 2/3

- [ ] **Step 1: Write the failing test**

Create `backend/src/seed.heavy.test.js`:

```javascript
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CATIRA_DEMO_PHOTOS = 'stub';
process.env.CATIRA_SQLITE_PATH = path.join(os.tmpdir(), 'catira-heavy-' + process.pid + '.sqlite');
process.env.CATIRA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'catira-heavy-data-'));

const db = require('./db');
const { CATEGORIES } = require('./categories');
const seed = require('./seed');

assert.strictEqual(seed.CITY_NAMES.length, 34, '34 cidades');
['Dores do Indaiá', 'Luz', 'Bom Despacho', 'Quartel Geral', 'Cedro do Abaeté'].forEach((name) => {
  assert.ok(seed.CITY_NAMES.includes(name), name);
});
assert.strictEqual(seed.CITIES.length, 34);
assert.ok(seed.CITIES.every((c) => c.state === 'MG'));
assert.strictEqual(seed.CITIES.find((c) => c.name === 'Dores do Indaiá').id, 'dores-do-indaia');
assert.strictEqual(seed.CITIES.find((c) => c.name === 'Cedro do Abaeté').id, 'cedro-do-abaete');

assert.strictEqual(seed.demoUserEmail(1), 'demo.user.001@catira.local');
assert.strictEqual(seed.demoUserEmail(100), 'demo.user.100@catira.local');
assert.strictEqual(seed.demoDealerEmail(1), 'demo.dealer.01@catira.local');
assert.strictEqual(seed.demoDealerEmail(10), 'demo.dealer.10@catira.local');

assert.ok(Array.isArray(seed.HEAVY_CATALOG));
assert.strictEqual(seed.HEAVY_CATALOG.length, 100);
CATEGORIES.forEach((c) => {
  const rows = seed.HEAVY_CATALOG.filter((r) => r.slug === c.slug);
  assert.strictEqual(rows.length, 10, c.slug + ' tem 10 produtos');
});
seed.HEAVY_CATALOG.forEach((row, i) => {
  assert.ok(row.title && row.description && row.subcategory);
  assert.ok(Number.isFinite(row.price) && row.price > 0);
  assert.ok(Array.isArray(row.photoQueries) && row.photoQueries.length === 4, '4 queries foto #' + i);
});

const photo = seed.ensureDemoPhoto('demo-test-stub.jpg', 'motorcycle');
assert.ok(photo.url);
assert.strictEqual(photo.local, false, 'stub não baixa arquivo');
assert.ok(photo.url.startsWith('/api/placeholder/'));

console.log('seed.heavy constants ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node src/seed.heavy.test.js`

Expected: FAIL — `CITY_NAMES.length` is 29, `demoUserEmail` / `HEAVY_CATALOG` / `ensureDemoPhoto` undefined.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/seed.js`:

1. Append to `CITY_NAMES` (after `'Biquinhas'`):

```javascript
  'Dores do Indaiá',
  'Luz',
  'Bom Despacho',
  'Quartel Geral',
  'Cedro do Abaeté',
```

`CITIES` already maps `CITY_NAMES`; no other city code change.

2. Add helpers and catalog **after** `CITIES` / `daysFrom`, **before** `seedIfEmpty`:

```javascript
function demoUserEmail(n) {
  return 'demo.user.' + String(n).padStart(3, '0') + '@catira.local';
}

function demoDealerEmail(n) {
  return 'demo.dealer.' + String(n).padStart(2, '0') + '@catira.local';
}

const DEMO_FIRST_NAMES = [
  'Lucas', 'Fernanda', 'Rafael', 'Camila', 'Bruno', 'Juliana', 'Thiago', 'Patrícia',
  'Gustavo', 'Aline', 'Felipe', 'Larissa', 'Rodrigo', 'Tatiane', 'Diego', 'Vanessa',
  'Marcelo', 'Priscila', 'Eduardo', 'Renata', 'Leandro', 'Sabrina', 'André', 'Carla',
];

const DEMO_LAST_NAMES = [
  'Oliveira', 'Santos', 'Almeida', 'Costa', 'Rodrigues', 'Carvalho', 'Pereira',
  'Nascimento', 'Barbosa', 'Rocha', 'Mendes', 'Araujo', 'Castro', 'Fernandes', 'Moreira',
];

const PHOTO_QUERIES = {
  veiculos: [
    ['motorcycle,honda', 'motorcycle,side', 'motorcycle,wheel', 'motorcycle,garage'],
    ['pickup,truck', 'pickup,side', 'pickup,interior', 'pickup,rural'],
    ['bicycle,mountain', 'bicycle,side', 'bicycle,gear', 'bicycle,trail'],
    ['scooter,moto', 'scooter,side', 'scooter,dashboard', 'scooter,street'],
    ['car,sedan', 'car,side', 'car,interior', 'car,parked'],
    ['tractor,farm', 'tractor,side', 'tractor,wheel', 'tractor,field'],
    ['motorcycle,yamaha', 'motorcycle,tank', 'motorcycle,seat', 'motorcycle,road'],
    ['van,utility', 'van,side', 'van,cargo', 'van,workshop'],
    ['bicycle,caloi', 'bicycle,frame', 'bicycle,pedal', 'bicycle,city'],
    ['motorcycle,cg', 'motorcycle,engine', 'motorcycle,helmet', 'motorcycle,dirt'],
  ],
  tecnologia: [
    ['smartphone,iphone', 'smartphone,back', 'smartphone,screen', 'smartphone,desk'],
    ['laptop,notebook', 'laptop,keyboard', 'laptop,side', 'laptop,office'],
    ['television,smart', 'television,screen', 'television,stand', 'television,living'],
    ['headphones,wireless', 'headphones,ear', 'headphones,case', 'headphones,desk'],
    ['tablet,android', 'tablet,screen', 'tablet,back', 'tablet,sofa'],
    ['camera,dslr', 'camera,lens', 'camera,side', 'camera,table'],
    ['game,console', 'game,controller', 'game,box', 'game,tv'],
    ['printer,office', 'printer,front', 'printer,paper', 'printer,desk'],
    ['smartwatch,wearable', 'smartwatch,face', 'smartwatch,band', 'smartwatch,wrist'],
    ['speaker,bluetooth', 'speaker,front', 'speaker,side', 'speaker,room'],
  ],
  'casa-moveis': [
    ['sofa,living', 'sofa,side', 'sofa,cushion', 'sofa,room'],
    ['refrigerator,kitchen', 'refrigerator,open', 'refrigerator,side', 'refrigerator,home'],
    ['bed,wood', 'bed,side', 'bed,mattress', 'bed,bedroom'],
    ['table,dining', 'table,top', 'table,legs', 'table,kitchen'],
    ['wardrobe,closet', 'wardrobe,open', 'wardrobe,door', 'wardrobe,bedroom'],
    ['fan,ceiling', 'fan,blades', 'fan,switch', 'fan,room'],
    ['stove,gas', 'stove,burner', 'stove,oven', 'stove,kitchen'],
    ['washer,laundry', 'washer,front', 'washer,drum', 'washer,room'],
    ['chair,wood', 'chair,seat', 'chair,back', 'chair,dining'],
    ['lamp,desk', 'lamp,shade', 'lamp,base', 'lamp,night'],
  ],
  moda: [
    ['sneakers,shoes', 'sneakers,side', 'sneakers,sole', 'sneakers,floor'],
    ['jacket,leather', 'jacket,collar', 'jacket,back', 'jacket,hanger'],
    ['watch,wrist', 'watch,face', 'watch,band', 'watch,table'],
    ['handbag,leather', 'handbag,handle', 'handbag,inside', 'handbag,chair'],
    ['jeans,denim', 'jeans,pocket', 'jeans,fold', 'jeans,rack'],
    ['hat,cap', 'hat,front', 'hat,side', 'hat,table'],
    ['boots,work', 'boots,side', 'boots,sole', 'boots,floor'],
    ['dress,casual', 'dress,fabric', 'dress,hanger', 'dress,mirror'],
    ['belt,leather', 'belt,buckle', 'belt,strap', 'belt,table'],
    ['sunglasses,style', 'sunglasses,lens', 'sunglasses,arm', 'sunglasses,case'],
  ],
  ferramentas: [
    ['drill,power', 'drill,side', 'drill,bit', 'drill,toolbox'],
    ['toolbox,metal', 'toolbox,open', 'toolbox,tools', 'toolbox,garage'],
    ['welder,machine', 'welder,front', 'welder,cable', 'welder,workshop'],
    ['saw,circular', 'saw,blade', 'saw,handle', 'saw,wood'],
    ['wrench,set', 'wrench,close', 'wrench,case', 'wrench,bench'],
    ['compressor,air', 'compressor,tank', 'compressor,hose', 'compressor,shop'],
    ['ladder,aluminum', 'ladder,side', 'ladder,step', 'ladder,wall'],
    ['grinder,angle', 'grinder,disc', 'grinder,handle', 'grinder,bench'],
    ['hammer,claw', 'hammer,head', 'hammer,handle', 'hammer,nails'],
    ['level,spirit', 'level,vial', 'level,side', 'level,wall'],
  ],
  agro: [
    ['chainsaw,forest', 'chainsaw,bar', 'chainsaw,engine', 'chainsaw,wood'],
    ['sprayer,farm', 'sprayer,tank', 'sprayer,nozzle', 'sprayer,field'],
    ['fence,rural', 'fence,wire', 'fence,post', 'fence,pasture'],
    ['irrigation,hose', 'irrigation,sprinkler', 'irrigation,pipe', 'irrigation,crop'],
    ['wheelbarrow,garden', 'wheelbarrow,side', 'wheelbarrow,wheel', 'wheelbarrow,yard'],
    ['seed,bag', 'seed,grain', 'seed,sack', 'seed,barn'],
    ['hoe,tool', 'hoe,blade', 'hoe,handle', 'hoe,soil'],
    ['pump,water', 'pump,front', 'pump,hose', 'pump,tank'],
    ['saddle,horse', 'saddle,leather', 'saddle,side', 'saddle,stable'],
    ['beehive,honey', 'beehive,box', 'beehive,frame', 'beehive,field'],
  ],
  animais: [
    ['chicken,coop', 'chicken,feather', 'chicken,yard', 'chicken,rural'],
    ['dog,pet', 'dog,face', 'dog,side', 'dog,yard'],
    ['horse,farm', 'horse,mane', 'horse,saddle', 'horse,pasture'],
    ['cow,cattle', 'cow,face', 'cow,side', 'cow,field'],
    ['cat,pet', 'cat,face', 'cat,fur', 'cat,home'],
    ['goat,farm', 'goat,face', 'goat,side', 'goat,pen'],
    ['fish,aquarium', 'fish,tank', 'fish,water', 'fish,home'],
    ['bird,cage', 'bird,feather', 'bird,perch', 'bird,room'],
    ['pig,farm', 'pig,snout', 'pig,side', 'pig,pen'],
    ['rabbit,pet', 'rabbit,ear', 'rabbit,fur', 'rabbit,hutch'],
  ],
  lazer: [
    ['guitar,acoustic', 'guitar,neck', 'guitar,body', 'guitar,room'],
    ['soccer,ball', 'soccer,leather', 'soccer,grass', 'soccer,field'],
    ['fishing,rod', 'fishing,reel', 'fishing,lure', 'fishing,river'],
    ['tent,camping', 'tent,inside', 'tent,pole', 'tent,forest'],
    ['bicycle,sport', 'bicycle,wheel', 'bicycle,handle', 'bicycle,park'],
    ['dumbbell,gym', 'dumbbell,weight', 'dumbbell,rack', 'dumbbell,floor'],
    ['boardgame,table', 'boardgame,box', 'boardgame,pieces', 'boardgame,home'],
    ['kayak,river', 'kayak,paddle', 'kayak,side', 'kayak,water'],
    ['skateboard,deck', 'skateboard,wheels', 'skateboard,side', 'skateboard,street'],
    ['book,stack', 'book,cover', 'book,pages', 'book,shelf'],
  ],
  imoveis: [
    ['house,rural', 'house,facade', 'house,yard', 'house,street'],
    ['apartment,building', 'apartment,room', 'apartment,kitchen', 'apartment,view'],
    ['land,plot', 'land,fence', 'land,grass', 'land,road'],
    ['kitnet,room', 'kitnet,kitchen', 'kitnet,bath', 'kitnet,door'],
    ['warehouse,shed', 'warehouse,interior', 'warehouse,gate', 'warehouse,yard'],
    ['farm,house', 'farm,porch', 'farm,field', 'farm,gate'],
    ['store,front', 'store,interior', 'store,counter', 'store,street'],
    ['garage,empty', 'garage,door', 'garage,floor', 'garage,house'],
    ['cottage,brick', 'cottage,window', 'cottage,roof', 'cottage,garden'],
    ['lot,urban', 'lot,corner', 'lot,soil', 'lot,neighborhood'],
  ],
  servicos: [
    ['mechanic,workshop', 'mechanic,tools', 'mechanic,car', 'mechanic,garage'],
    ['sewing,machine', 'sewing,fabric', 'sewing,thread', 'sewing,table'],
    ['painting,wall', 'painting,brush', 'painting,bucket', 'painting,room'],
    ['cleaning,service', 'cleaning,bucket', 'cleaning,mop', 'cleaning,floor'],
    ['barber,shop', 'barber,chair', 'barber,tools', 'barber,mirror'],
    ['delivery,box', 'delivery,motorcycle', 'delivery,package', 'delivery,street'],
    ['electrician,wires', 'electrician,panel', 'electrician,tool', 'electrician,wall'],
    ['mason,brick', 'mason,trowel', 'mason,wall', 'mason,site'],
    ['tutor,desk', 'tutor,book', 'tutor,notebook', 'tutor,room'],
    ['catering,food', 'catering,tray', 'catering,kitchen', 'catering,table'],
  ],
};

const TITLES = {
  veiculos: [
    ['Honda CG 150 Fan', 'Moto', 9800],
    ['Saveiro 2012 cabine simples', 'Carros', 26500],
    ['Bicicleta Caloi aro 29', 'Ciclismo', 920],
    ['Honda Biz 125', 'Motos', 7200],
    ['Gol 1.0 2010', 'Carros', 18800],
    ['Microtrator tobata', 'Máquinas', 14500],
    ['Yamaha Factor 125', 'Motos', 8100],
    ['Kombi furgão 2008', 'Utilitários', 22000],
    ['Monark barra circular', 'Ciclismo', 380],
    ['Honda NXR 160 Bros', 'Motos', 12900],
  ],
  tecnologia: [
    ['iPhone 11 64GB', 'iPhone', 1450],
    ['Notebook Lenovo i5', 'Informática', 1680],
    ['Smart TV 43 Samsung', 'TVs', 980],
    ['Fone JBL Tune', 'Áudio', 180],
    ['Tablet Samsung A8', 'Tablets', 720],
    ['Câmera Canon T6', 'Câmeras', 1100],
    ['Xbox One 500GB', 'Consoles', 890],
    ['Impressora HP Ink Tank', 'Informática', 420],
    ['Relógio Amazfit', 'Wearables', 260],
    ['Caixa JBL Go', 'Áudio', 140],
  ],
  'casa-moveis': [
    ['Sofá 3 lugares suede', 'Sofás', 690],
    ['Geladeira Consul frost free', 'Eletro', 980],
    ['Cama box casal', 'Camas', 540],
    ['Mesa 6 cadeiras', 'Mesas', 480],
    ['Guarda-roupa 6 portas', 'Armários', 820],
    ['Ventilador de teto', 'Eletro', 160],
    ['Fogão 5 bocas', 'Eletro', 540],
    ['Máquina de lavar 11kg', 'Eletro', 780],
    ['Jogo de cadeiras madeira', 'Cadeiras', 320],
    ['Abajur de mesa', 'Iluminação', 70],
  ],
  moda: [
    ['Tênis Olympikus n° 41', 'Calçados', 90],
    ['Jaqueta de couro M', 'Roupas', 220],
    ['Relógio Casio', 'Acessórios', 180],
    ['Bolsa de couro', 'Bolsas', 130],
    ['Calça jeans 42', 'Roupas', 80],
    ['Boné trucker', 'Acessórios', 35],
    ['Bota de trabalho 40', 'Calçados', 160],
    ['Vestido midi', 'Roupas', 75],
    ['Cinto de couro', 'Acessórios', 45],
    ['Óculos escuros', 'Acessórios', 55],
  ],
  ferramentas: [
    ['Furadeira de impacto 650W', 'Furadeiras', 280],
    ['Caixa de ferramentas completa', 'Manuais', 190],
    ['Máquina de solda 180A', 'Solda', 720],
    ['Serra circular 7.1/4', 'Serras', 340],
    ['Jogo de chaves combinadas', 'Manuais', 85],
    ['Compressor 50 litros', 'Ar', 890],
    ['Escada alumínio 6 degraus', 'Escadas', 210],
    ['Esmerilhadeira 4.1/2', 'Elétricas', 230],
    ['Martelo unha 27mm', 'Manuais', 35],
    ['Nível de alumínio 60cm', 'Medição', 40],
  ],
  agro: [
    ['Motosserra 50cc', 'Roçadeiras', 890],
    ['Pulverizador 20 litros', 'Pulverização', 160],
    ['Tela de alambrado 50m', 'Cercas', 420],
    ['Aspersor de irrigação', 'Irrigação', 95],
    ['Carrinho de mão reforçado', 'Jardinagem', 180],
    ['Saco de milho 60kg', 'Grãos', 85],
    ['Enxada e cavadeira', 'Manuais', 55],
    ['Bomba d\'água 1cv', 'Bombas', 480],
    ['Sela de cavalo', 'Equinos', 650],
    ['Caixa de abelha completa', 'Apicultura', 220],
  ],
  animais: [
    ['Galinha caipira (par)', 'Aves', 60],
    ['Filhote de vira-lata', 'Cães', 80],
    ['Égua mansa', 'Equinos', 1800],
    ['Bezerro desmamado', 'Bovinos', 2200],
    ['Gato persa adulto', 'Gatos', 250],
    ['Cabra leiteira', 'Caprinos', 480],
    ['Aquário 60 litros', 'Peixes', 180],
    ['Calopsita com gaiola', 'Aves', 220],
    ['Leitão caipira', 'Suínos', 320],
    ['Casal de coelhos', 'Pequenos', 90],
  ],
  lazer: [
    ['Violão Giannini', 'Música', 280],
    ['Bola de campo Penalty', 'Futebol', 55],
    ['Vara de pesca 2,10m', 'Pesca', 90],
    ['Barraca 4 pessoas', 'Camping', 240],
    ['Patins inline 40', 'Esportes', 160],
    ['Kit halter 10kg', 'Musculação', 140],
    ['Jogo Banco Imobiliário', 'Jogos', 45],
    ['Caiaque individual', 'Náutico', 890],
    ['Skate street', 'Esportes', 180],
    ['Lote de livros didáticos', 'Livros', 40],
  ],
  imoveis: [
    ['Casa 2 quartos no Centro', 'Casas', 95000],
    ['Apartamento 1 quarto', 'Apartamentos', 78000],
    ['Terreno 300m²', 'Terrenos', 35000],
    ['Kitnet mobiliada', 'Kitnets', 42000],
    ['Galpão 80m²', 'Comercial', 65000],
    ['Chácara 1 hectare', 'Rurais', 120000],
    ['Ponto comercial rua principal', 'Comercial', 88000],
    ['Garagem coberta', 'Vagas', 18000],
    ['Casa de fundo alvenaria', 'Casas', 62000],
    ['Lote em condomínio', 'Terrenos', 28000],
  ],
  servicos: [
    ['Mecânico em domicílio', 'Reparos', 120],
    ['Costureira sob medida', 'Confecção', 80],
    ['Pintura residencial', 'Reforma', 200],
    ['Diária de limpeza', 'Doméstico', 140],
    ['Corte e barba', 'Beleza', 40],
    ['Entrega na cidade', 'Fretes', 50],
    ['Eletricista residencial', 'Reparos', 150],
    ['Pedreiro para muro', 'Reforma', 250],
    ['Aula particular de matemática', 'Aulas', 60],
    ['Marmitex no almoço', 'Alimentação', 18],
  ],
};

const HEAVY_CATALOG = [];
CATEGORIES.forEach((c) => {
  const titles = TITLES[c.slug];
  const queries = PHOTO_QUERIES[c.slug];
  titles.forEach((row, i) => {
    HEAVY_CATALOG.push({
      slug: c.slug,
      title: row[0],
      subcategory: row[1],
      price: row[2],
      description:
        row[0] + ' em bom estado, combinamos em ' +
        (i % 2 === 0 ? 'Corinto e região' : 'a cidade do anúncio') +
        '. Retirada ou entrega a combinar. ' +
        (i % 3 === 0 ? 'Documentação em dia.' : i % 3 === 1 ? 'Pouco uso, bem cuidado.' : 'Preço negociável à vista.'),
      photoQueries: queries[i],
    });
  });
});

function demoUploadsDir() {
  return path.join(__dirname, '..', 'uploads', 'demo');
}

function ensureDemoPhoto(fileName, query) {
  if (process.env.CATIRA_DEMO_PHOTOS === 'stub') {
    return {
      url: '/api/placeholder/demo/0?c=' + encodeURIComponent('#E85D04') + '&t=' + encodeURIComponent(String(query || 'CATIRA').slice(0, 28)),
      local: false,
    };
  }
  const dir = demoUploadsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, fileName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    return { url: '/uploads/demo/' + fileName, local: true };
  }
  return downloadUnsplash(dest, query, fileName);
}

function downloadUnsplash(dest, query, fileName) {
  // implemented in this task as a thin https GET; Task tests stub so this is unused in CI
  const https = require('https');
  const encoded = encodeURIComponent(String(query || 'product'));
  const urls = [
    'https://source.unsplash.com/800x600/?' + encoded,
    'https://images.unsplash.com/featured/800x600/?' + encoded,
  ];
  function get(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 8000, headers: { 'User-Agent': 'CatiraDemoSeed/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('status ' + res.statusCode));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }
  // sync wrapper used by seed: write file if download works
  try {
    const { execFileSync } = require('child_process');
    const tmp = dest + '.part';
    let ok = false;
    for (const url of urls) {
      try {
        execFileSync('curl', ['-fsSL', '-A', 'CatiraDemoSeed/1.0', '--max-time', '8', '-o', tmp, url], { stdio: 'ignore' });
        if (fs.existsSync(tmp) && fs.statSync(tmp).size > 1024) {
          fs.renameSync(tmp, dest);
          ok = true;
          break;
        }
      } catch {
        /* try next url */
      }
    }
    if (ok) return { url: '/uploads/demo/' + fileName, local: true };
  } catch {
    /* fall through */
  }
  return {
    url: '/api/placeholder/demo/0?c=' + encodeURIComponent('#E85D04') + '&t=' + encodeURIComponent(String(query || 'CATIRA').slice(0, 28)),
    local: false,
  };
}

function ensureHeavyDemo() {
  return { skipped: true };
}
```

Add at top of `seed.js` (after existing requires):

```javascript
const fs = require('fs');
const path = require('path');
```

`CATEGORIES` is already imported from `./categories`.

3. Extend `module.exports` at the bottom of `seed.js`:

```javascript
module.exports = {
  seedIfEmpty,
  ensureExtras,
  ensureCities,
  ensureMaster,
  ensureHeavyDemo,
  ensureDemoPhoto,
  demoUserEmail,
  demoDealerEmail,
  HEAVY_CATALOG,
  DEMO_FIRST_NAMES,
  DEMO_LAST_NAMES,
  LISTING_FEE,
  LISTING_DAYS,
  CITIES,
  CITY_NAMES,
  CATEGORIES,
};
```

4. In `backend/package.json` `scripts.test`, insert `node src/seed.heavy.test.js && ` immediately after `node src/intelligence.test.js && `.

Do **not** call `ensureHeavyDemo` from `ensureExtras` yet (Task 3). `ensureCities` already inserts any missing `CITIES` row, so the 5 new names appear on next boot even before Task 3.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node src/seed.heavy.test.js`

Expected: `seed.heavy constants ok` and exit 0.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 2: 100 users + 10 catireiros (idempotent)

**Files:**
- Modify: `backend/src/seed.js` (`ensureHeavyDemo` users/dealers half)
- Modify: `backend/src/seed.heavy.test.js`

**Interfaces:**
- Consumes: `demoUserEmail`, `demoDealerEmail`, `DEMO_FIRST_NAMES`, `DEMO_LAST_NAMES`, `CITIES`, `ensureCities`, `ensureCategories`, `db`, `bcrypt`
- Produces: `ensureHeavyDemo()` creates missing demo users/dealers. Listings still not required to exist after this task (created in Task 3), but the function must not throw.

- [ ] **Step 1: Extend the failing test**

Append to `backend/src/seed.heavy.test.js` (keep Task 1 asserts):

```javascript
const { ensureCategories } = require('./categories');
ensureCategories();
seed.ensureCities();

const master = db.insert('users', {
  name: 'Admin Catira',
  email: 'admin@catira.com',
  phone: '38999990000',
  city: 'Corinto',
  cityId: 'corinto',
  passwordHash: 'x',
  role: 'master',
  status: 'active',
});

const first = seed.ensureHeavyDemo();
assert.ok(first);

const users = db.findWhere('users', (u) => /^demo\.user\.\d{3}@catira\.local$/.test(u.email));
const dealers = db.findWhere('users', (u) => /^demo\.dealer\.\d{2}@catira\.local$/.test(u.email));
assert.strictEqual(users.length, 100);
assert.strictEqual(dealers.length, 10);
users.forEach((u) => {
  assert.strictEqual(u.role, 'user');
  assert.strictEqual(u.status, 'active');
  assert.ok(u.passwordHash && u.passwordHash !== 'x');
  assert.ok(u.cityId);
  assert.ok(seed.CITIES.some((c) => c.id === u.cityId));
});
dealers.forEach((u) => {
  assert.strictEqual(u.role, 'user');
  const app = db.findOne('dealerApplications', (a) => a.userId === u.id);
  const profile = db.findOne('dealerProfiles', (p) => p.userId === u.id);
  assert.ok(app && app.status === 'approved');
  assert.ok(profile && profile.status === 'active');
  assert.strictEqual(profile.founder, false);
});
assert.strictEqual(db.findOne('users', (u) => u.email === 'admin@catira.com').role, 'master');

const userCount = db.count('users');
const appCount = db.count('dealerApplications');
const profileCount = db.count('dealerProfiles');
seed.ensureHeavyDemo();
assert.strictEqual(db.count('users'), userCount, 'segunda chamada não duplica users');
assert.strictEqual(db.count('dealerApplications'), appCount);
assert.strictEqual(db.count('dealerProfiles'), profileCount);

const cities = db.all('cities');
assert.ok(cities.length >= 34);
assert.ok(cities.find((c) => c.name === 'Luz' && c.state === 'MG'));

console.log('seed.heavy users ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node src/seed.heavy.test.js`

Expected: FAIL — `users.length` is 0 because `ensureHeavyDemo` still returns `{ skipped: true }`.

- [ ] **Step 3: Implement users + dealers in `ensureHeavyDemo`**

Replace the stub `ensureHeavyDemo` in `backend/src/seed.js`:

```javascript
function demoName(index) {
  const first = DEMO_FIRST_NAMES[index % DEMO_FIRST_NAMES.length];
  const last = DEMO_LAST_NAMES[Math.floor(index / DEMO_FIRST_NAMES.length) % DEMO_LAST_NAMES.length];
  return first + ' ' + last;
}

function demoPhone(prefix, index) {
  return prefix + String(1000000 + index).slice(-7);
}

function listingTypeOfIndex(i) {
  if (i < 70) return 'venda';
  if (i < 85) return 'venda_troca';
  if (i < 95) return 'troca';
  return 'procuro';
}

function conditionOfIndex(i) {
  return ['usado', 'seminovo', 'novo'][i % 3];
}

function ensureHeavyDemo() {
  ensureCities();
  ensureCategories();
  const demoUsers = db.findWhere('users', (u) => /^demo\.user\.\d{3}@catira\.local$/.test(u.email || ''));
  const heavyListings = db.findWhere('listings', (l) => l.source === 'demo-heavy');
  if (demoUsers.length >= 100 && heavyListings.length >= 100) return { skipped: true };

  const hash = bcrypt.hashSync('123456', 10);
  const now = new Date().toISOString();
  const master = db.findOne('users', (u) => u.role === 'master');
  const catRows = db.all('categories').filter((c) => c.active !== false);

  function cityOf(index) {
    return CITIES[index % CITIES.length];
  }

  const colors = ['#E85D04', '#2D6A4F', '#1D3557', '#9B2226', '#7B2D8E', '#1E3A8A'];

  for (let n = 1; n <= 100; n++) {
    const email = demoUserEmail(n);
    if (db.findOne('users', (u) => u.email === email)) continue;
    const city = cityOf(n - 1);
    db.insert('users', {
      name: demoName(n - 1),
      email,
      phone: demoPhone('3899', n),
      city: city.name,
      cityId: city.id,
      passwordHash: hash,
      role: 'user',
      status: 'active',
      phoneVerified: true,
      emailVerified: true,
      createdAt: daysAgo(30 - (n % 25)),
      ratingAvg: 4 + ((n % 10) / 10),
      ratingCount: n % 8,
      avatarColor: colors[n % colors.length],
    });
  }

  for (let n = 1; n <= 10; n++) {
    const email = demoDealerEmail(n);
    let user = db.findOne('users', (u) => u.email === email);
    const city = cityOf(n + 3);
    if (!user) {
      user = db.insert('users', {
        name: demoName(200 + n),
        email,
        phone: demoPhone('3888', n),
        city: city.name,
        cityId: city.id,
        passwordHash: hash,
        role: 'user',
        status: 'active',
        phoneVerified: true,
        emailVerified: true,
        createdAt: daysAgo(40 - n),
        ratingAvg: 4.6,
        ratingCount: 4 + n,
        avatarColor: colors[n % colors.length],
      });
    }
    let app = db.findOne('dealerApplications', (a) => a.userId === user.id);
    const catA = catRows[n % catRows.length];
    const catB = catRows[(n + 3) % catRows.length];
    const neighbor = CITIES[(n + 4) % CITIES.length];
    const categories = [catA && catA.id, catB && catB.id].filter(Boolean);
    const regions = [user.city, neighbor.name];
    if (!app) {
      app = db.insert('dealerApplications', {
        userId: user.id,
        name: user.name,
        city: user.city,
        cityId: user.cityId,
        phone: user.phone,
        categories,
        regions,
        termsAcceptedAt: now,
        termsVersion: '1',
        status: 'approved',
        createdAt: now,
        reviewedAt: now,
        reviewedBy: master ? master.id : null,
        note: 'demo-heavy',
      });
    } else if (app.status !== 'approved') {
      db.update('dealerApplications', app.id, {
        status: 'approved',
        reviewedAt: now,
        reviewedBy: master ? master.id : null,
      });
    }
    let profile = db.findOne('dealerProfiles', (p) => p.userId === user.id);
    if (!profile) {
      db.insert('dealerProfiles', {
        userId: user.id,
        applicationId: app.id,
        status: 'active',
        founder: false,
        founderAt: null,
        categories,
        regions,
        city: user.city,
        cityId: user.cityId,
        phone: user.phone,
        approvedAt: now,
        approvedBy: master ? master.id : null,
        benefitUntil: null,
        couponCode: '',
      });
    } else if (profile.status !== 'active') {
      db.update('dealerProfiles', profile.id, { status: 'active', approvedAt: now });
    }
  }

  return { skipped: false };
}
```

Listings are still Task 3. Early-return only when **both** 100 users and 100 heavy listings exist, so Task 3 can fill listings on a DB that already has users.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node src/seed.heavy.test.js`

Expected: `seed.heavy constants ok` then `seed.heavy users ok`, exit 0.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 3: 100 listings × 4 photos + wire into `ensureExtras`

**Files:**
- Modify: `backend/src/seed.js` (`ensureHeavyDemo` listings + `ensureExtras` call)
- Modify: `backend/src/seed.heavy.test.js`

**Interfaces:**
- Consumes: `HEAVY_CATALOG`, `ensureDemoPhoto`, `listingTypeOfIndex`, `conditionOfIndex`, `LISTING_FEE`, `LISTING_DAYS`, `daysAgo`, `daysFrom`
- Produces: 100 `listings` with `source: 'demo-heavy'`, 4 `listingImages` each, one `payments` Pix demo each. `ensureExtras()` calls `ensureHeavyDemo()`.

Owner mapping (locked):

- Catalog index `i` (0–99).
- Category = `HEAVY_CATALOG[i].slug` (already 10 per slug in order of `CATEGORIES`).
- If `i < 40`: owner = `demo.dealer.NN` where `NN = String(Math.floor(i / 4) + 1).padStart(2,'0')` (each dealer 4 listings).
- If `i >= 40`: owner = `demo.user.NNN` where `NNN = String(i - 39).padStart(3,'0')` (users 001–060).

- [ ] **Step 1: Extend the failing test**

Append to `backend/src/seed.heavy.test.js`:

```javascript
const listings = db.findWhere('listings', (l) => l.source === 'demo-heavy');
assert.strictEqual(listings.length, 100, '100 anúncios demo-heavy');

const { resolveCategory } = require('./categories');
CATEGORIES.forEach((c) => {
  const cat = resolveCategory(c.slug);
  const n = listings.filter((l) => l.categoryId === cat.id).length;
  assert.strictEqual(n, 10, c.slug + ' tem 10 anúncios');
});

listings.forEach((l) => {
  const imgs = db.findWhere('listingImages', (img) => img.listingId === l.id);
  assert.strictEqual(imgs.length, 4, l.title + ' tem 4 fotos');
  assert.deepStrictEqual(imgs.sort((a, b) => a.order - b.order).map((img) => img.order), [0, 1, 2, 3]);
  assert.strictEqual(l.status, 'published');
  assert.ok(['venda', 'venda_troca', 'troca', 'procuro'].includes(l.listingType));
  const pay = db.findOne('payments', (p) => p.listingId === l.id);
  assert.ok(pay);
  assert.strictEqual(pay.method, 'pix');
  assert.strictEqual(pay.status, 'paid');
  assert.ok(String(pay.transactionId).startsWith('PIX-DEMO-HEAVY-'));
  assert.ok(!l.appmaxOrderId);
  assert.ok(!pay.appmaxOrderId);
});

const typeCount = { venda: 0, venda_troca: 0, troca: 0, procuro: 0 };
listings.forEach((l) => { typeCount[l.listingType] += 1; });
assert.strictEqual(typeCount.venda, 70);
assert.strictEqual(typeCount.venda_troca, 15);
assert.strictEqual(typeCount.troca, 10);
assert.strictEqual(typeCount.procuro, 5);

const dealerOwners = new Set();
for (let n = 1; n <= 10; n++) {
  const u = db.findOne('users', (x) => x.email === seed.demoDealerEmail(n));
  const mine = listings.filter((l) => l.userId === u.id);
  assert.strictEqual(mine.length, 4, seed.demoDealerEmail(n) + ' publica 4');
  dealerOwners.add(u.id);
}
let commonCount = 0;
for (let n = 1; n <= 60; n++) {
  const u = db.findOne('users', (x) => x.email === seed.demoUserEmail(n));
  const mine = listings.filter((l) => l.userId === u.id);
  assert.strictEqual(mine.length, 1, seed.demoUserEmail(n) + ' publica 1');
  commonCount += mine.length;
}
assert.strictEqual(commonCount, 60);
for (let n = 61; n <= 100; n++) {
  const u = db.findOne('users', (x) => x.email === seed.demoUserEmail(n));
  const mine = listings.filter((l) => l.userId === u.id);
  assert.strictEqual(mine.length, 0);
}

const listingCount = db.count('listings');
const imageCount = db.count('listingImages');
const payCount = db.count('payments');
seed.ensureHeavyDemo();
assert.strictEqual(db.count('listings'), listingCount);
assert.strictEqual(db.count('listingImages'), imageCount);
assert.strictEqual(db.count('payments'), payCount);

const cardPay = db.findOne('payments', (p) => p.method === 'card' && String(p.transactionId || '').includes('HEAVY'));
assert.ok(!cardPay);

console.log('seed.heavy listings ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node src/seed.heavy.test.js`

Expected: FAIL — `listings.length` is 0.

- [ ] **Step 3: Insert listings inside `ensureHeavyDemo` and call it from `ensureExtras`**

At the end of `ensureHeavyDemo` in `backend/src/seed.js`, **before** `return { skipped: false }`, add:

```javascript
  const existingHeavy = db.findWhere('listings', (l) => l.source === 'demo-heavy');
  if (existingHeavy.length < 100) {
    const haveTitle = {};
    existingHeavy.forEach((l) => { haveTitle[l.title + '|' + l.userId] = true; });
    HEAVY_CATALOG.forEach((item, i) => {
      const ownerEmail = i < 40 ? demoDealerEmail(Math.floor(i / 4) + 1) : demoUserEmail(i - 39);
      const owner = db.findOne('users', (u) => u.email === ownerEmail);
      const cat = db.findOne('categories', (c) => c.slug === item.slug);
      if (!owner || !cat) return;
      if (haveTitle[item.title + '|' + owner.id]) return;
      const listingType = listingTypeOfIndex(i);
      const createdAt = daysAgo((i % 25) + 1);
      const listing = db.insert('listings', {
        userId: owner.id,
        title: item.title,
        description: item.description,
        categoryId: cat.id,
        subcategory: item.subcategory,
        price: item.price,
        condition: conditionOfIndex(i),
        city: owner.city,
        cityId: owner.cityId,
        neighborhood: i % 2 === 0 ? 'Centro' : 'São João',
        listingType,
        acceptsTrade: listingType === 'troca' || listingType === 'venda_troca',
        acceptsCash: listingType !== 'troca',
        tradeWishes: listingType === 'venda' ? '' : 'Aceito volta ou item da mesma categoria.',
        status: 'published',
        featured: false,
        vip: false,
        views: 3 + (i * 7) % 78,
        source: 'demo-heavy',
        createdAt,
        publishedAt: createdAt,
        expiresAt: daysFrom(createdAt, LISTING_DAYS),
        paidAt: createdAt,
      });
      item.photoQueries.forEach((q, idx) => {
        const fileName = 'demo-' + item.slug + '-' + String(i).padStart(3, '0') + '-' + idx + '.jpg';
        const photo = ensureDemoPhoto(fileName, q);
        db.insert('listingImages', {
          listingId: listing.id,
          url: photo.local ? photo.url : `/api/placeholder/${listing.id}/${idx}?c=${encodeURIComponent('#E85D04')}&t=${encodeURIComponent(item.title.slice(0, 28))}`,
          color: '#E85D04',
          label: item.title.slice(0, 28),
          emoji: item.subcategory.slice(0, 8).toUpperCase(),
          order: idx,
        });
      });
      db.insert('payments', {
        userId: owner.id,
        listingId: listing.id,
        amount: LISTING_FEE,
        status: 'paid',
        method: 'pix',
        kind: 'listing',
        transactionId: 'PIX-DEMO-HEAVY-' + listing.id.slice(0, 8).toUpperCase(),
        pixCode: '00020126580014br.gov.bcb.pix',
        createdAt,
        paidAt: createdAt,
      });
    });
  }
```

In `ensureExtras()`, after `ensureChatDemo();` and before `try { require('./lance').ensureSettings(); }`:

```javascript
  ensureHeavyDemo();
```

Do not add a second call in `server.js`.

- [ ] **Step 4: Run tests**

Run: `cd backend && node src/seed.heavy.test.js`

Expected: all three `console.log` lines, exit 0.

Run: `cd backend && node src/categories.test.js && node src/intelligence.test.js && node src/search.test.js`

Expected: exit 0. Categories still 10. Intelligence unchanged.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 4: Boot verification (photos stub, no Appmax)

**Files:**
- Modify: none unless a bug shows up in Task 3
- Verify: `backend/src/server.js` still does not call Appmax for this lote

**Interfaces:**
- Consumes: `ensureExtras` → `ensureHeavyDemo`
- Produces: evidence in test output + optional local boot with `CATIRA_DEMO_PHOTOS=stub`

- [ ] **Step 1: Guard test — no Appmax fields on heavy lote**

Already asserted in Task 3 (`!l.appmaxOrderId`, pix-only payments). Add one more block at the end of `seed.heavy.test.js`:

```javascript
const orders = db.all('orders') || [];
assert.ok(orders.every((o) => o.source !== 'demo-heavy'));
assert.strictEqual(
  db.count('payments', (p) => p.method === 'card' && String(p.transactionId || '').startsWith('PIX-DEMO-HEAVY')),
  0
);
console.log('seed.heavy no-appmax ok');
```

- [ ] **Step 2: Run full new file**

Run: `cd backend && node src/seed.heavy.test.js`

Expected: four ok lines, exit 0.

- [ ] **Step 3: Manual boot check (only if a server is already expected up)**

Do not start a long-running server unless the user asked for preview. If checking an already-running backend, restart is required so `ensureExtras` runs.

With `CATIRA_DEMO_PHOTOS=stub` (tests) photos are SVG placeholders. Real Unsplash JPEGs appear only when the env var is unset on a normal `node src/server.js` boot, cached under `backend/uploads/demo/`.

Manual checklist after a real boot (env unset):

- `GET /api/listings` returns many `published` rows including the new titles (`Honda CG 150 Fan`, `Sofá 3 lugares suede`, …).
- Admin users filter Catireiro lists 10 `demo.dealer.*`.
- City list includes Luz, Bom Despacho, Dores do Indaiá, Quartel Geral, Cedro do Abaeté.
- No new Appmax orders.

- [ ] **Step 4: Commit**

Skip. Do not commit.

---

## Spec coverage

| Spec section | Task |
|---|---|
| `ensureHeavyDemo` in `ensureExtras`, idempotent | 2, 3 |
| 34 cities, 5 new names | 1 |
| 100 users + 10 dealers, emails, password, dealer profile | 2 |
| 100 listings, 10/category, owner split 40/60 | 3 |
| listingType 70/15/10/5, Pix demo payment | 3 |
| 4 photos, Unsplash cache, stub in tests | 1, 3 |
| No Appmax, no wipe, no Intelligence extra | 3, 4 |
| Tests + package.json script | 1 |
| No commit | all Step 5 skipped |

## Placeholder scan

No TBD / implement later / similar-to-Task-N. Catalog tables, emails, owner formula, and test code are inlined.

## Type consistency

- `demoUserEmail(n)` 1-based pad 3; `demoDealerEmail(n)` 1-based pad 2 — same in tests and implementation.
- `ensureDemoPhoto(fileName, query)` → `{ url, local }`.
- `ensureHeavyDemo()` → `{ skipped: boolean }`.
- Listing marker `source: 'demo-heavy'`.
- Payment `transactionId` prefix `PIX-DEMO-HEAVY-`.
