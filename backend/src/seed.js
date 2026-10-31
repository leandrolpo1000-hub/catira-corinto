const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('./db');
const { CATEGORIES, ensureCategories } = require('./categories');

const LISTING_FEE = 5;
const LISTING_DAYS = 30;

const CITY_NAMES = [
  'Corinto',
  'Curvelo',
  'Três Marias',
  'Felixlândia',
  'Abaeté',
  'Martinho Campos',
  'Morro da Garça',
  'Santo Hipólito',
  'Monjolos',
  'Augusto de Lima',
  'Inimutaba',
  'Presidente Juscelino',
  'Lassance',
  'Buenópolis',
  'Joaquim Felício',
  'Gouveia',
  'Várzea da Palma',
  'Diamantina',
  'Paraopeba',
  'Santana de Pirapama',
  'Morada Nova de Minas',
  'Pompéu',
  'Cordisburgo',
  'Jequitaí',
  'Datas',
  'Presidente Kubitschek',
  'São Gonçalo do Abaeté',
  'Paineiras',
  'Biquinhas',
];

function citySlug(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const CITIES = CITY_NAMES.map((name) => {
  const id = citySlug(name);
  return { id, name, state: 'MG', slug: id + '-mg' };
});

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function daysFrom(iso, n) {
  return new Date(new Date(iso).getTime() + n * 86400000).toISOString();
}

function seedIfEmpty() {
  if (db.count('users') > 0) return false;

  const hash = (p) => bcrypt.hashSync(p, 10);
  const now = new Date().toISOString();

  CITIES.forEach((c) => db.insert('cities', { ...c, active: true }));

  const cats = CATEGORIES.map((c) =>
    db.insert('categories', {
      id: randomUUID(),
      slug: c.slug,
      name: c.name,
      icon: c.icon,
      order: c.order,
      parentId: null,
      active: true,
    })
  );

  const cat = (slug) => cats.find((c) => c.slug === slug);

  const admin = db.insert('users', {
    name: 'Admin Catira',
    email: 'admin@catira.com',
    phone: '38999990000',
    city: 'Corinto',
    cityId: 'corinto',
    passwordHash: hash('admin123'),
    role: 'master',
    status: 'active',
    phoneVerified: true,
    emailVerified: true,
    createdAt: daysAgo(90),
    ratingAvg: 5,
    ratingCount: 12,
    avatarColor: '#E85D04',
  });

  const joao = db.insert('users', {
    name: 'João Ferreira',
    email: 'joao@email.com',
    phone: '38988881111',
    city: 'Corinto',
    cityId: 'corinto',
    passwordHash: hash('123456'),
    role: 'user',
    status: 'active',
    phoneVerified: true,
    emailVerified: true,
    createdAt: daysAgo(40),
    ratingAvg: 4.8,
    ratingCount: 6,
    avatarColor: '#2D6A4F',
  });

  const maria = db.insert('users', {
    name: 'Maria Souza',
    email: 'maria@email.com',
    phone: '38987772222',
    city: 'Corinto',
    cityId: 'corinto',
    passwordHash: hash('123456'),
    role: 'user',
    status: 'active',
    phoneVerified: true,
    emailVerified: true,
    createdAt: daysAgo(28),
    ratingAvg: 4.9,
    ratingCount: 8,
    avatarColor: '#9B2226',
  });

  const pedro = db.insert('users', {
    name: 'Pedro Lima',
    email: 'pedro@email.com',
    phone: '38986663333',
    city: 'Curvelo',
    cityId: 'curvelo',
    passwordHash: hash('123456'),
    role: 'user',
    status: 'active',
    phoneVerified: true,
    emailVerified: false,
    createdAt: daysAgo(15),
    ratingAvg: 4.5,
    ratingCount: 3,
    avatarColor: '#1D3557',
  });

  const ana = db.insert('users', {
    name: 'Ana Paula',
    email: 'ana@email.com',
    phone: '38985554444',
    city: 'Corinto',
    cityId: 'corinto',
    passwordHash: hash('123456'),
    role: 'user',
    status: 'active',
    phoneVerified: true,
    emailVerified: true,
    createdAt: daysAgo(10),
    ratingAvg: 5,
    ratingCount: 2,
    avatarColor: '#7B2D8E',
  });

  const listingsData = [
    {
      user: joao,
      title: 'Honda CG 160 Titan',
      description:
        'CG 160 Titan 2022, única dona, revisada, IPVA pago. Pneus novos. Documentação em dia. Motivo da venda: estou comprando uma 300.',
      categoryId: cat('veiculos').id,
      subcategory: 'Motos',
      price: 13500,
      condition: 'usado',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'Centro',
      acceptsTrade: false,
      tradeWishes: '',
      days: 2,
      photos: [
        { color: '#1a1a1a', label: 'CG 160', emoji: 'MOTO' },
        { color: '#333', label: 'Lateral', emoji: 'CG' },
      ],
    },
    {
      user: maria,
      title: 'iPhone 13 128GB',
      description:
        'iPhone 13 128GB, cor meia-noite. Bateria 89%. Sem marcas, sempre usado com película e capinha. Caixa e cabo originais.',
      categoryId: cat('tecnologia').id,
      subcategory: 'iPhone',
      price: 2300,
      condition: 'seminovo',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'São João',
      acceptsTrade: true,
      tradeWishes: 'Tenho interesse em celular mais novo, moto ou dinheiro.',
      days: 1,
      photos: [
        { color: '#111827', label: 'iPhone 13', emoji: 'IPHONE' },
        { color: '#374151', label: 'Tela', emoji: '13' },
      ],
    },
    {
      user: pedro,
      title: 'Sofá 3 lugares',
      description:
        'Sofá retrátil 3 lugares, tecido suede cinza. Muito confortável. Estou mudando de casa e preciso vender rápido.',
      categoryId: cat('casa-moveis').id,
      subcategory: 'Sofás',
      price: 650,
      condition: 'usado',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'Vila Nova',
      acceptsTrade: false,
      tradeWishes: '',
      days: 3,
      photos: [{ color: '#6B7280', label: 'Sofá 3 lugares', emoji: 'SOFA' }],
    },
    {
      user: ana,
      title: 'TV 50 polegadas Smart',
      description:
        'Smart TV 50" 4K, marca TCL. Funciona perfeitamente, imagem nítida. Entrego em Corinto.',
      categoryId: cat('tecnologia').id,
      subcategory: 'TVs',
      price: 1500,
      condition: 'usado',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'Centro',
      acceptsTrade: true,
      tradeWishes: 'Aceito geladeira, notebook ou volta em dinheiro.',
      days: 0,
      photos: [{ color: '#0F172A', label: 'TV 50"', emoji: 'TV 50' }],
    },
    {
      user: joao,
      title: 'Furadeira Bosch 550W',
      description:
        'Furadeira de impacto Bosch, pouco uso. Vem com maleta e jogo de brocas. Ideal para casa.',
      categoryId: cat('ferramentas').id,
      subcategory: 'Furadeiras',
      price: 350,
      condition: 'seminovo',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'Industrial',
      acceptsTrade: false,
      tradeWishes: '',
      days: 4,
      photos: [{ color: '#1E3A8A', label: 'Furadeira Bosch', emoji: 'BOSCH' }],
    },
    {
      user: maria,
      title: 'PlayStation 4 Slim 1TB',
      description:
        'PS4 Slim 1TB com 2 controles e 6 jogos (FIFA, GTA, God of War). Funcionando 100%.',
      categoryId: cat('tecnologia').id,
      subcategory: 'Consoles',
      price: 1200,
      condition: 'usado',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'Centro',
      acceptsTrade: true,
      tradeWishes: 'Aceito Nintendo Switch ou celular.',
      days: 5,
      photos: [{ color: '#1E40AF', label: 'PS4 Slim', emoji: 'PS4' }],
    },
    {
      user: pedro,
      title: 'Bicicleta aro 29',
      description:
        'Bike aro 29, 21 marchas, freio a disco. Quadro alumínio. Revisada recentemente.',
      categoryId: cat('veiculos').id,
      subcategory: 'Ciclismo',
      price: 890,
      condition: 'usado',
      city: 'Curvelo',
      cityId: 'curvelo',
      neighborhood: 'Centro',
      acceptsTrade: true,
      tradeWishes: 'Aceito ferramentas ou voltar um valor.',
      days: 6,
      photos: [{ color: '#14532D', label: 'Bike 29', emoji: 'BIKE' }],
    },
    {
      user: ana,
      title: 'Berço com colchão',
      description:
        'Berço de madeira maciça com colchão e mosquiteiro. Estado de novo. Bebê já cresceu.',
      categoryId: cat('lazer').id,
      subcategory: 'Móveis',
      price: 280,
      condition: 'seminovo',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'São Geraldo',
      acceptsTrade: false,
      tradeWishes: '',
      days: 7,
      photos: [{ color: '#92400E', label: 'Berço', emoji: 'BERCO' }],
    },
  ];

  listingsData.forEach((item, i) => {
    const createdAt = daysAgo(item.days);
    const listing = db.insert('listings', {
      userId: item.user.id,
      title: item.title,
      description: item.description,
      categoryId: item.categoryId,
      subcategory: item.subcategory,
      price: item.price,
      condition: item.condition,
      city: item.city,
      cityId: item.cityId,
      neighborhood: item.neighborhood,
      acceptsTrade: item.acceptsTrade,
      tradeWishes: item.tradeWishes,
      status: 'published',
      featured: i === 1,
      views: 12 + i * 7,
      createdAt,
      publishedAt: createdAt,
      expiresAt: daysFrom(createdAt, LISTING_DAYS),
      paidAt: createdAt,
    });

    item.photos.forEach((p, idx) => {
      db.insert('listingImages', {
        listingId: listing.id,
        url: `/api/placeholder/${listing.id}/${idx}?c=${encodeURIComponent(p.color)}&t=${encodeURIComponent(p.label)}`,
        color: p.color,
        label: p.label,
        emoji: p.emoji,
        order: idx,
      });
    });

    db.insert('payments', {
      userId: item.user.id,
      listingId: listing.id,
      amount: LISTING_FEE,
      status: 'paid',
      method: 'pix',
      transactionId: 'PIX-DEMO-' + listing.id.slice(0, 8).toUpperCase(),
      pixCode: '00020126580014br.gov.bcb.pix',
      createdAt,
      paidAt: createdAt,
    });
  });

  db.insert('reviews', {
    reviewerId: maria.id,
    reviewedUserId: joao.id,
    listingId: db.findOne('listings', (l) => l.title.includes('Furadeira')).id,
    rating: 5,
    comment: 'Negociação tranquila. Produto igual ao anúncio.',
    createdAt: daysAgo(3),
  });

  db.insert('reviews', {
    reviewerId: joao.id,
    reviewedUserId: maria.id,
    listingId: db.findOne('listings', (l) => l.title.includes('iPhone')).id,
    rating: 5,
    comment: 'Pessoa super honesta. Recomendo.',
    createdAt: daysAgo(2),
  });

  return true;
}



function ensureMaster() {
  if (db.findOne('users', (u) => u.role === 'master')) return false;
  const admin = db.findOne('users', (u) => u.role === 'admin');
  if (!admin) return false;
  db.update('users', admin.id, { role: 'master' });
  return true;
}

function ensureCities() {
  CITIES.forEach((c) => {
    const exists = db.findOne(
      'cities',
      (x) => x.id === c.id || x.name === c.name || x.slug === c.slug
    );
    if (exists) return;
    db.insert('cities', { ...c, active: true });
  });
}

function ensureAuctionDemo() {
  if (db.count('auctions') > 0) return;
  const joao = db.findOne('users', (u) => u.email === 'joao@email.com');
  const maria = db.findOne('users', (u) => u.email === 'maria@email.com');
  const admin = db.findOne('users', (u) => u.role === 'master');
  const catBike = db.findOne('categories', (c) => c.slug === 'veiculos');
  const catTool = db.findOne('categories', (c) => c.slug === 'ferramentas');
  if (!joao || !maria || !catBike) return;

  function addPhotos(auctionId, title) {
    for (let i = 0; i < 3; i++) {
      db.insert('auctionImages', {
        auctionId,
        url: '/api/placeholder/' + auctionId + '/' + i + '?t=' + encodeURIComponent(title),
        order: i,
      });
    }
  }

  const now = Date.now();
  const bike = db.insert('auctions', {
    userId: joao.id,
    title: 'Bicicleta Caloi Aro 29',
    description: 'Bicicleta Caloi aro 29, freio a disco, revisada. Retirada em Corinto. Lance e leve.',
    categoryId: catBike.id,
    city: 'Corinto',
    cityId: 'corinto',
    startingBid: 100,
    minIncrement: 5,
    startAt: new Date(now - 2 * 3600000).toISOString(),
    endAt: new Date(now + 2 * 3600000).toISOString(),
    originalEndAt: new Date(now + 2 * 3600000).toISOString(),
    durationHours: 4,
    deliveryMethod: 'ambos',
    pickupInfo: 'Pode retirar no centro de Corinto ou combinar entrega.',
    extraInfo: '',
    sellerRules: 'Pagamento combinado após o arremate.',
    status: 'live',
    startedAt: new Date(now - 2 * 3600000).toISOString(),
    currentBid: 187,
    currentBidderId: maria.id,
    bidCount: 3,
    extensionCount: 0,
    winnerId: null,
    winnerAmount: null,
    views: 34,
    createdAt: new Date(now - 6 * 3600000).toISOString(),
  });
  addPhotos(bike.id, 'Bicicleta Caloi');
  [
    { userId: admin ? admin.id : maria.id, amount: 175, at: now - 90 * 60000 },
    { userId: admin ? admin.id : maria.id, amount: 182, at: now - 40 * 60000 },
    { userId: maria.id, amount: 187, at: now - 12 * 60000 },
  ].forEach((b) => {
    db.insert('auctionBids', { auctionId: bike.id, userId: b.userId, amount: b.amount, createdAt: new Date(b.at).toISOString() });
  });

  if (catTool) {
    const drill = db.insert('auctions', {
      userId: maria.id,
      title: 'Furadeira de Impacto 650W',
      description: 'Furadeira de impacto 650W com maleta e brocas. Usada poucas vezes, funcionando perfeitamente.',
      categoryId: catTool.id,
      city: 'Corinto',
      cityId: 'corinto',
      startingBid: 50,
      minIncrement: 5,
      startAt: new Date(now - 30 * 60000).toISOString(),
      endAt: new Date(now + 45 * 60000).toISOString(),
      originalEndAt: new Date(now + 45 * 60000).toISOString(),
      durationHours: 2,
      deliveryMethod: 'retirada',
      pickupInfo: 'Retirada no centro de Corinto.',
      extraInfo: 'Acompanha maleta e 5 brocas.',
      sellerRules: '',
      status: 'live',
      startedAt: new Date(now - 30 * 60000).toISOString(),
      currentBid: 75,
      currentBidderId: joao.id,
      bidCount: 2,
      extensionCount: 0,
      winnerId: null,
      winnerAmount: null,
      views: 18,
      createdAt: new Date(now - 3 * 3600000).toISOString(),
    });
    addPhotos(drill.id, 'Furadeira de Impacto');
    [
      { userId: joao.id, amount: 70, at: now - 20 * 60000 },
      { userId: joao.id, amount: 75, at: now - 8 * 60000 },
    ].forEach((b) => {
      db.insert('auctionBids', { auctionId: drill.id, userId: b.userId, amount: b.amount, createdAt: new Date(b.at).toISOString() });
    });
  }

  const scheduled = db.insert('auctions', {
    userId: joao.id,
    title: 'Smartphone Samsung Galaxy A54',
    description: 'Galaxy A54 128GB, tela perfeita, bateria ótima. Vou abrir os lances em breve.',
    categoryId: (db.findOne('categories', (c) => c.slug === 'tecnologia') || catBike).id,
    city: 'Corinto',
    cityId: 'corinto',
    startingBid: 500,
    minIncrement: 20,
    startAt: new Date(now + 3600000).toISOString(),
    endAt: new Date(now + 5 * 3600000).toISOString(),
    originalEndAt: new Date(now + 5 * 3600000).toISOString(),
    durationHours: 4,
    deliveryMethod: 'ambos',
    pickupInfo: 'Retirada em Corinto ou entrega combinada.',
    extraInfo: '',
    sellerRules: '',
    status: 'scheduled',
    startedAt: null,
    currentBid: null,
    currentBidderId: null,
    bidCount: 0,
    extensionCount: 0,
    winnerId: null,
    winnerAmount: null,
    views: 5,
    createdAt: new Date(now - 3600000).toISOString(),
  });
  addPhotos(scheduled.id, 'Galaxy A54');
}

function nextSundayKey() {
  const zone = 'America/Sao_Paulo';
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const noon = new Date(key + 'T15:00:00-03:00');
    const w = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(noon);
    if (w === 'Sun') return key;
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function ensureSundayDemo() {
  if (db.findOne('auctions', (a) => a.sundayEvent)) return;
  const joao = db.findOne('users', (u) => u.email === 'joao@email.com');
  const maria = db.findOne('users', (u) => u.email === 'maria@email.com');
  const admin = db.findOne('users', (u) => u.role === 'master');
  const seller = admin || joao;
  if (!seller) return;
  const cat = (slug) => db.findOne('categories', (c) => c.slug === slug) || db.findOne('categories', () => true);
  const dateKey = nextSundayKey();
  const edition = db.insert('auctionEditions', {
    number: 1,
    title: 'CATIRA LEILÃO #1',
    date: dateKey,
    notes: '',
    status: 'queued',
    createdAt: new Date().toISOString(),
  });
  function at(hm) {
    const [h, m] = String(hm).split(':');
    return new Date(dateKey + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00-03:00');
  }
  function addPhotos(auctionId, title) {
    for (let i = 0; i < 3; i++) {
      db.insert('auctionImages', {
        auctionId,
        url: '/api/placeholder/' + auctionId + '/' + i + '?t=' + encodeURIComponent(title),
        order: i,
      });
    }
  }
  const lots = [
    { title: 'Furadeira Bosch 550W', description: 'Furadeira usada, funcionando. Ideal para quem está começando no leilão.', cat: 'ferramentas', start: '10:00', mins: 5, bid: 40, inc: 5, round: 'first', featured: false, order: 1, seller: maria || seller },
    { title: 'Caixa de ferramentas', description: 'Caixa completa com chaves e soquetes. Giro rápido, lote da manhã.', cat: 'ferramentas', start: '10:10', mins: 5, bid: 25, inc: 5, round: 'first', featured: false, order: 2, seller: joao || seller },
    { title: 'Ventilador de mesa', description: 'Ventilador silencioso, pouco uso. Primeira rodada.', cat: 'casa-moveis', start: '10:20', mins: 5, bid: 30, inc: 5, round: 'first', featured: false, order: 3, seller: maria || seller },
    { title: 'Bicicleta Caloi Aro 29', description: 'Revisada, freio a disco. Lote bom para abrir a noite.', cat: 'veiculos', start: '20:00', mins: 8, bid: 180, inc: 10, round: 'main', featured: false, order: 10, seller: joao || seller },
    { title: 'Notebook Dell i5', description: '8GB RAM, SSD 256GB. Lote melhor da sequência.', cat: 'tecnologia', start: '20:10', mins: 8, bid: 450, inc: 20, round: 'main', featured: true, order: 11, seller: seller },
    { title: 'iPhone 12 128GB', description: 'Tela boa, bateria 86%. Destaque da noite.', cat: 'tecnologia', start: '20:20', mins: 10, bid: 800, inc: 30, round: 'main', featured: true, order: 12, seller: maria || seller },
    { title: 'PlayStation 5', description: 'Com um controle. Lote muito desejado.', cat: 'tecnologia', start: '20:30', mins: 10, bid: 1800, inc: 50, round: 'main', featured: true, order: 13, seller: joao || seller },
    { title: 'Geladeira Consul Frost Free', description: '110V, funcionando. Destaque para casa.', cat: 'casa-moveis', start: '20:40', mins: 10, bid: 600, inc: 25, round: 'main', featured: true, order: 14, seller: seller },
    { title: 'Honda CG 160 2020', description: 'Documentada, revisada. Lote premium.', cat: 'veiculos', start: '20:50', mins: 12, bid: 6500, inc: 100, round: 'main', featured: true, order: 15, seller: joao || seller },
    { title: 'Kit gado + cercamento', description: 'Lote especial rural. Combinação na região.', cat: 'agro', start: '21:00', mins: 12, bid: 1200, inc: 50, round: 'main', featured: true, order: 16, seller: seller },
    { title: 'Fiat Uno 2014', description: 'Completo, motor bom. Lote muito especial.', cat: 'veiculos', start: '21:15', mins: 12, bid: 14000, inc: 200, round: 'main', featured: true, order: 17, seller: maria || seller },
    { title: 'Chevrolet Onix 2018', description: 'Último e maior lote da noite. Grande final do domingo.', cat: 'veiculos', start: '21:30', mins: 15, bid: 28000, inc: 250, round: 'final', featured: true, finalLot: true, order: 20, seller: joao || seller },
  ];
  lots.forEach((lot) => {
    const startAt = at(lot.start);
    const endAt = new Date(startAt.getTime() + lot.mins * 60000);
    const who = lot.seller || seller;
    const c = cat(lot.cat);
    if (!c || !who) return;
    const row = db.insert('auctions', {
      userId: who.id,
      title: lot.title,
      description: lot.description,
      categoryId: c.id,
      city: 'Corinto',
      cityId: 'corinto',
      startingBid: lot.bid,
      minIncrement: lot.inc,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      originalEndAt: endAt.toISOString(),
      durationHours: lot.mins / 60,
      durationMinutes: lot.mins,
      deliveryMethod: 'retirada',
      pickupInfo: 'Retirada em Corinto, combinamos o horário.',
      extraInfo: '',
      sellerRules: 'Pagamento após o arremate.',
      status: startAt.getTime() <= Date.now() ? 'live' : 'scheduled',
      startedAt: startAt.getTime() <= Date.now() ? new Date().toISOString() : null,
      currentBid: null,
      currentBidderId: null,
      bidCount: 0,
      extensionCount: 0,
      winnerId: null,
      winnerAmount: null,
      views: 4,
      sundayEvent: true,
      editionId: edition.id,
      featured: !!lot.featured,
      finalLot: !!lot.finalLot,
      programOrder: lot.order,
      round: lot.round,
      createdAt: new Date().toISOString(),
    });
    addPhotos(row.id, lot.title);
  });
}

function placeholderUrl(id, idx, color, label) {
  return `/api/placeholder/${id}/${idx}?c=${encodeURIComponent(color)}&t=${encodeURIComponent(label)}`;
}

function addSeedPhotos(collection, foreignKey, foreignId, photos) {
  photos.forEach((p, idx) => {
    db.insert(collection, {
      [foreignKey]: foreignId,
      url: placeholderUrl(foreignId, idx, p.color, p.label),
      color: p.color,
      label: p.label,
      emoji: p.emoji || p.label,
      order: idx,
    });
  });
}

function ensureActionDemo() {
  if (db.count('actionPosts') > 0) return;
  const joao = db.findOne('users', (u) => u.email === 'joao@email.com');
  const maria = db.findOne('users', (u) => u.email === 'maria@email.com');
  const ana = db.findOne('users', (u) => u.email === 'ana@email.com');
  if (!joao || !maria || !ana) return;

  const cat = (slug) => db.findOne('categories', (c) => c.slug === slug);
  const catHome = cat('casa-moveis');
  const catRural = cat('agro') || cat('ferramentas');
  const catSport = cat('lazer');
  const catBaby = cat('lazer');
  const catInfo = cat('tecnologia');
  if (!catHome || !catRural || !catSport || !catBaby || !catInfo) return;

  function addDoneListing(item) {
    const createdAt = daysAgo(item.days + 12);
    const closedAt = daysAgo(item.days);
    const listing = db.insert('listings', {
      userId: item.user.id,
      title: item.title,
      description: item.description,
      categoryId: item.categoryId,
      subcategory: item.subcategory,
      price: item.price,
      condition: item.condition,
      city: item.city,
      cityId: item.cityId,
      neighborhood: item.neighborhood,
      listingType: item.listingType,
      acceptsTrade: item.acceptsTrade,
      acceptsCash: true,
      tradeWishes: item.tradeWishes,
      status: item.status,
      featured: false,
      vip: false,
      views: 18 + item.days * 3,
      createdAt,
      publishedAt: createdAt,
      expiresAt: daysFrom(createdAt, LISTING_DAYS),
      paidAt: createdAt,
      closedAt,
    });
    addSeedPhotos('listingImages', 'listingId', listing.id, item.photos);
    db.insert('payments', {
      userId: item.user.id,
      listingId: listing.id,
      amount: LISTING_FEE,
      status: 'paid',
      method: 'pix',
      kind: 'listing',
      transactionId: 'PIX-ACAO-' + listing.id.slice(0, 8).toUpperCase(),
      pixCode: '00020126580014br.gov.bcb.pix',
      createdAt,
      paidAt: createdAt,
    });
    return listing;
  }

  const stories = [
    {
      user: joao,
      title: 'Geladeira Consul Frost Free 110V',
      description:
        'Geladeira Consul frost free, 110V, pouco uso. Estou trocando de casa e não levo o eletro. Funcionando, prateleiras completas.',
      categoryId: catHome.id,
      subcategory: 'Eletrodomésticos',
      price: 980,
      condition: 'usado',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'Centro',
      listingType: 'venda',
      acceptsTrade: false,
      tradeWishes: '',
      status: 'sold',
      days: 1,
      photos: [
        { color: '#1E3A5F', label: 'Geladeira', emoji: 'GELA' },
        { color: '#334155', label: 'Interior', emoji: 'IN' },
      ],
      text:
        'Encontro na praça de Corinto, bem cedo. A geladeira estava limpa, gelando direito, e o comprador levou no próprio caminhão. Conferimos as prateleiras, o motor e o fechamento da porta na hora. Combinado, cumprido, aperto de mão. CATIRA encurtou o caminho.',
      postPhotos: [
        { color: '#0F172A', label: 'Carregando', emoji: 'CAM' },
        { color: '#1E3A5F', label: 'Na calçada', emoji: 'CALC' },
        { color: '#334155', label: 'Porta aberta', emoji: 'PORTA' },
        { color: '#475569', label: 'Pronto', emoji: 'OK' },
      ],
    },
    {
      user: maria,
      title: 'Máquina de costura Singer',
      description:
        'Singer doméstica, pouco uso, com pedal e caixa de acessórios. Costura reta e ziguezague. Motivo: ganhei outra de presente.',
      categoryId: catHome.id,
      subcategory: 'Eletrodomésticos',
      price: 420,
      condition: 'seminovo',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'São João',
      listingType: 'venda_troca',
      acceptsTrade: true,
      tradeWishes: 'Aceito micro-ondas ou volta em dinheiro.',
      status: 'traded',
      days: 3,
      photos: [
        { color: '#9B2226', label: 'Singer', emoji: 'SING' },
        { color: '#7F1D1D', label: 'Pedal', emoji: 'PED' },
      ],
      text:
        'Troquei a máquina de costura por um micro-ondas que fazia falta em casa. Nos encontramos no Centro, testamos os dois itens ali mesmo e cada um saiu satisfeito. Sem pressa, conversa franca, como tem que ser no interior. Valeu a confiança de ambos os lados.',
      postPhotos: [
        { color: '#9B2226', label: 'Máquina', emoji: 'MAQ' },
        { color: '#BB3E03', label: 'Troca', emoji: 'TROCA' },
        { color: '#CA6702', label: 'Micro-ondas', emoji: 'MICRO' },
      ],
    },
    {
      user: ana,
      title: 'Carrinho de bebê Galzerano',
      description:
        'Carrinho Galzerano, reclinável, com capota e cestinha. Estado de novo. Bebê já cresceu e não usa mais.',
      categoryId: catBaby.id,
      subcategory: 'Carrinhos',
      price: 310,
      condition: 'seminovo',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'São Geraldo',
      listingType: 'venda',
      acceptsTrade: false,
      tradeWishes: '',
      status: 'negotiated',
      days: 5,
      photos: [
        { color: '#7B2D8E', label: 'Carrinho', emoji: 'BB' },
        { color: '#5B21B6', label: 'Dobrado', emoji: 'DOB' },
      ],
      text:
        'A mamãe veio ver o carrinho com o marido. Combinamos a entrega no São Geraldo, abri, fechei, mostrei o cinto e a cestinha. Item de criança a gente trata com carinho: limpei tudo antes e expliquei cada regulagem. Ficou combinado, ficou certo, e o sorriso dela valeu o dia.',
      postPhotos: [
        { color: '#7B2D8E', label: 'Na varanda', emoji: 'VAR' },
        { color: '#6D28D9', label: 'Aberto', emoji: 'ABR' },
        { color: '#5B21B6', label: 'Entrega', emoji: 'ENT' },
        { color: '#4C1D95', label: 'Família', emoji: 'FAM' },
      ],
    },
    {
      user: joao,
      title: 'Lote de tela e mourão',
      description:
        'Tela galvanizada e mourões de eucalipto tratados. Sobra de cercamento da fazenda. Retirada em Corinto, ajudo a carregar.',
      categoryId: catRural.id,
      subcategory: 'Cercamento',
      price: 1500,
      condition: 'usado',
      city: 'Corinto',
      cityId: 'corinto',
      neighborhood: 'Zona Rural',
      listingType: 'venda',
      acceptsTrade: false,
      tradeWishes: '',
      status: 'sold',
      days: 8,
      photos: [
        { color: '#14532D', label: 'Tela', emoji: 'TELA' },
        { color: '#365314', label: 'Mourão', emoji: 'MOUR' },
      ],
      text:
        'Negócio de vizinho: o lote de tela e mourão saiu da fazenda rumo a Felixlândia. Contamos as peças, conferimos a galvanização e carregamos juntos no caminhão. No interior é assim: aperto de mão vale mais que papel. CATIRA só juntou quem já se conhecia de vista.',
      postPhotos: [
        { color: '#14532D', label: 'No pasto', emoji: 'PAS' },
        { color: '#166534', label: 'Empilhado', emoji: 'PIL' },
        { color: '#365314', label: 'Caminhão', emoji: 'TRK' },
        { color: '#3F6212', label: 'Carregando', emoji: 'CAR' },
        { color: '#4D7C0F', label: 'Pronto', emoji: 'OK' },
      ],
    },
    {
      user: maria,
      title: 'Notebook Lenovo i5 8GB',
      description:
        'Lenovo i5, 8GB, SSD 256GB, bateria boa. Uso de escritório. Aceito troca por bicicleta aro 29 em bom estado.',
      categoryId: catInfo.id,
      subcategory: 'Notebooks',
      price: 1400,
      condition: 'usado',
      city: 'Curvelo',
      cityId: 'curvelo',
      neighborhood: 'Centro',
      listingType: 'venda_troca',
      acceptsTrade: true,
      tradeWishes: 'Aceito bicicleta aro 29 revisada.',
      status: 'traded',
      days: 11,
      photos: [
        { color: '#1D3557', label: 'Notebook', emoji: 'NOTE' },
        { color: '#0F172A', label: 'Tela', emoji: 'TELA' },
      ],
      text:
        'Tinha o notebook parado e precisava de uma bike para ir ao trabalho. A troca aconteceu em Curvelo: liguei o notebook na hora, a pessoa pedaleou a rua e testou as marchas. Deu certo dos dois lados, sem pressa e sem enrolação. Recomendo negociar olho no olho.',
      postPhotos: [
        { color: '#1D3557', label: 'Notebook', emoji: 'NOTE' },
        { color: '#0F172A', label: 'Bike 29', emoji: 'BIKE' },
        { color: '#1E3A8A', label: 'Na rua', emoji: 'RUA' },
      ],
    },
  ];

  stories.forEach((item) => {
    const listing = addDoneListing(item);
    const createdAt = daysAgo(item.days);
    const post = db.insert('actionPosts', {
      userId: item.user.id,
      listingId: listing.id,
      text: item.text,
      status: 'published',
      createdAt,
      updatedAt: createdAt,
    });
    addSeedPhotos('actionPostImages', 'postId', post.id, item.postPhotos);
  });
}

function ensureExtras() {
  ensureCities();
  ensureCategories();
  db.all('listings').forEach((l) => {
    if (l.listingType) return;
    const listingType = l.acceptsTrade ? 'venda_troca' : 'venda';
    db.update('listings', l.id, { listingType, acceptsCash: !!l.acceptsCash });
  });
  const hasProcuro = db.findOne('listings', (l) => l.listingType === 'procuro');
  if (!hasProcuro) {
    const joao = db.findOne('users', (u) => u.email === 'joao@email.com');
    const maria = db.findOne('users', (u) => u.email === 'maria@email.com');
    const catPhone = db.findOne('categories', (c) => c.slug === 'tecnologia');
    const catTool = db.findOne('categories', (c) => c.slug === 'ferramentas');
    const now = new Date().toISOString();
    function addProcuro(user, title, description, price, cat, days) {
      if (!user || !cat) return;
      const createdAt = new Date(Date.now() - days * 86400000).toISOString();
      const listing = db.insert('listings', {
        userId: user.id,
        title,
        description,
        categoryId: cat.id,
        subcategory: '',
        price,
        condition: 'usado',
        city: user.city || 'Corinto',
        cityId: user.cityId || 'corinto',
        listingType: 'procuro',
        acceptsTrade: false,
        acceptsCash: true,
        tradeWishes: '',
        status: 'published',
        featured: false,
        vip: false,
        views: 4 + days,
        createdAt,
        publishedAt: createdAt,
        expiresAt: new Date(Date.now() + LISTING_DAYS * 86400000).toISOString(),
        paidAt: createdAt,
      });
      db.insert('listingImages', {
        listingId: listing.id,
        url: `/api/placeholder/${listing.id}/0?c=${encodeURIComponent('#1D3557')}&t=${encodeURIComponent('PROCURO')}`,
        color: '#1D3557',
        label: 'PROCURO',
        emoji: 'PROCURO',
        order: 0,
      });
      db.insert('payments', {
        userId: user.id,
        listingId: listing.id,
        amount: LISTING_FEE,
        status: 'paid',
        method: 'pix',
        kind: 'listing',
        transactionId: 'PIX-DEMO-' + listing.id.slice(0, 8).toUpperCase(),
        pixCode: '00020126580014br.gov.bcb.pix',
        createdAt: now,
        paidAt: createdAt,
      });
    }
    addProcuro(joao, 'iPhone 13', 'Estou procurando um iPhone 13 em bom estado. Se alguém tiver, tenho interesse.', 2000, catPhone, 1);
    addProcuro(maria, 'Furadeira de impacto', 'Procuro furadeira boa, pode ser usada. Aceito combinarmos em Corinto.', 250, catTool, 2);
  }
  ensureAuctionDemo();
  ensureSundayDemo();
  ensureActionDemo();
  try { require('./lance').ensureSettings(); } catch {}
}

module.exports = { seedIfEmpty, ensureExtras, ensureCities, ensureMaster, LISTING_FEE, LISTING_DAYS, CITIES, CITY_NAMES, CATEGORIES };
