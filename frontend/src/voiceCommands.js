// Motor de comandos de voz do CATIRA.
// Resolve uma frase falada para uma acao de navegacao, busca ou filtro.
// Cada rota possui um grande conjunto de sinonimos e variacoes para cobrir
// o maximo de situacoes reais de fala (com e sem acento, abreviado, popular).

export function normalizeVoice(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Verbos de comando que costumam abrir uma frase falada.
const LEADING_VERBS = [
  'por favor', 'faz favor', 'faz o favor', 'se possivel',
  'quero muito', 'queria', 'quero', 'gostaria', 'preciso', 'desejo',
  'me leva para', 'me leva pra', 'me leva', 'me leve para', 'me leve pra', 'me leve',
  'leva para', 'leva pra', 'leva', 'levar para', 'levar pra',
  'me manda para', 'me manda pra', 'me manda', 'me envia para', 'me envia',
  'ir para', 'ir pra', 'ir a', 'ir no', 'ir na', 'ir',
  'vai para', 'vai pra', 'vai a', 'vai no', 'vai na', 'vai',
  'navegar para', 'navegar pra', 'navegar ate', 'navegar', 'navega',
  'acessar', 'acessa', 'acesse', 'entrar em', 'entrar no', 'entrar na', 'entrar para', 'entrar',
  'abrir a', 'abrir o', 'abrir as', 'abrir os', 'abrir', 'abre a', 'abre o', 'abre as', 'abre os', 'abre', 'abri',
  'mostrar a', 'mostrar o', 'mostrar as', 'mostrar os', 'mostrar', 'mostra a', 'mostra o', 'mostra as', 'mostra os', 'mostra', 'mostre',
  'vizualizar', 'visualizar', 'ver a', 'ver o', 'ver as', 'ver os', 'ver', 've', 'veja',
  'tela de', 'tela do', 'tela da', 'tela', 'pagina de', 'pagina do', 'pagina da', 'pagina',
  'minha tela de', 'minha pagina de', 'meu', 'minha', 'minhas', 'meus',
  'buscar por', 'buscar', 'busca por', 'busca', 'procurar por', 'procurar', 'procura por', 'procura',
  'coloca', 'colocar', 'queria ver', 'quero ver',
];

function stripLeadingVerbs(text) {
  let out = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of LEADING_VERBS) {
      if (out === v) { out = ''; changed = true; break; }
      if (out.startsWith(v + ' ')) { out = out.slice(v.length + 1).trim(); changed = true; break; }
    }
  }
  return out;
}

// Rotas com amplo dicionario de sinonimos.
export const VOICE_ROUTES = [
  {
    to: '/leiloes', label: 'Leilão', group: 'leilao',
    keys: [
      'leilao', 'leiloes', 'leilaozinho', 'a leilao', 'em leilao', 'do leilao', 'dos leiloes',
      'leilao ao vivo', 'leiloes ao vivo', 'ao vivo', 'live', 'transmissao', 'transmissao ao vivo',
      'leilao agora', 'leilao hoje', 'leilao de hoje', 'leilao do dia', 'proximo leilao', 'proximos leiloes',
      'disputa', 'disputas', 'disputar', 'quadra de leilao', 'palco do leilao', 'palco',
      'lote', 'lotes', 'lote ao vivo', 'lote atual', 'lote da vez', 'proximo lote', 'proximos lotes',
      'dar lance', 'da lance', 'dar lances', 'fazer lance', 'envio de lance', 'enviar lance', 'cobrir lance',
      'arrematar', 'arremate', 'arrematacao', 'arrematacoes', 'arrematei',
      'pregao', 'pregoes', 'hasta', 'hastas', 'hasta publica', 'hasta publica de bens',
      'martelo', 'batida de martelo', 'leiloeiro', 'leiloeira', 'casa de leilao',
      'catira leilao', 'catira leiloes', 'tela do leilao', 'area do leilao', 'ambiente de leilao',
    ],
  },
  {
    to: '/estou-de-olho', label: 'Estou de olho', group: 'leilao',
    keys: [
      'estou de olho', 'tou de olho', 'de olho', 'meus favoritos de leilao', 'lotes que acompanho',
      'lotes que estou de olho', 'acompanhando leilao', 'avisar quando comecar', 'avisos de lote',
      'quero ser avisado', 'me avisa quando comecar', 'lotes vigiados', 'vigiar lote', 'observando leilao',
    ],
  },
  {
    to: '/meus-leiloes', label: 'Meus leilões', group: 'leilao',
    keys: [
      'meus leiloes', 'minha leiloes', 'meus lotes', 'minha agenda de leilao', 'meus anuncios de leilao',
      'leiloes que criei', 'lotes que criei', 'meus itens de leilao', 'painel do meu leilao',
      'gerenciar meus leiloes', 'administrar meus leiloes', 'meus leiloes criados',
    ],
  },
  {
    to: '/meus-arremates', label: 'Meus arremates', group: 'leilao',
    keys: [
      'meus arremates', 'minhas arrematacoes', 'o que eu arrematei', 'meus lotes arrematados',
      'lotes que ganhei', 'itens que ganhei no leilao', 'compras de leilao', 'meus ganhos de leilao',
      'pagamento do arremate', 'pagar arremate', 'arremates pendentes',
    ],
  },
  {
    to: '/ranking-leilao', label: 'Ranking do leilão', group: 'leilao',
    keys: [
      'ranking do leilao', 'ranking de leilao', 'ranking leilao', 'melhores do leilao',
      'classificacao do leilao', 'ranqueamento do leilao', 'top leilao', 'top arrematantes',
      'quem mais arremata', 'maiores arrematadores', 'campeoes do leilao', 'trofeu do leilao',
    ],
  },
  {
    to: '/avisos-leilao', label: 'Avisos do leilão', group: 'leilao',
    keys: [
      'avisos de leilao', 'avisos do leilao', 'notificacoes de leilao', 'notificacoes do leilao',
      'alertas de leilao', 'alertas do leilao', 'meus avisos de leilao', 'central de avisos do leilao',
      'mensagens do leilao', 'recados do leilao', 'comunicados de leilao',
    ],
  },
  {
    to: '/criar-leilao', label: 'Criar lote', group: 'leilao', admin: true,
    keys: [
      'criar leilao', 'criar um leilao', 'novo leilao', 'novo lote', 'criar lote', 'criar um lote',
      'cadastrar leilao', 'cadastrar lote', 'adicionar lote', 'incluir lote', 'publicar leilao',
      'agendar leilao', 'programar leilao', 'montar leilao', 'criar item de leilao', 'colocar no leilao',
    ],
  },
  {
    to: '/', label: 'Início', group: 'navegacao',
    keys: [
      'inicio', 'home', 'pagina inicial', 'tela inicial', 'pagina principal', 'principal',
      'comeco', 'tela principal', 'meu inicio', 'inicio do app', 'casa', 'voltar ao inicio',
      'pagina de inicio', 'tela do inicio', 'menu principal', 'raiz',
    ],
  },
  {
    to: '/buscar', label: 'Buscar', group: 'navegacao',
    keys: [
      'buscar', 'busca', 'buscar anuncios', 'buscar produtos', 'pesquisar', 'pesquisa',
      'procurar', 'procura', 'procurar anuncios', 'pesquisar produtos', 'encontrar',
      'encontrar produtos', 'localizar', 'catalogo', 'listagem', 'ver anuncios', 'explorar',
      'descobrir', 'tela de busca', 'pagina de busca', 'barra de busca', 'campo de busca',
    ],
  },
  {
    to: '/em-acao', label: 'Catira em Ação', group: 'navegacao',
    keys: [
      'em acao', 'catira em acao', 'acao', 'publicacoes', 'feed', 'o que rolou',
      'negociacoes publicadas', 'ver acao', 'tela de acao', 'publicar acao',
    ],
  },
  {
    to: '/catiras', label: 'Catiras (trocas)', group: 'navegacao',
    keys: [
      'catira', 'catiras', 'trocar', 'troca', 'trocas', 'permutar', 'permuta', 'permutas',
      'escambo', 'trocar produtos', 'negociar troca', 'tela de trocas', 'modo troca', 'espaco de trocas',
    ],
  },
  {
    to: '/anunciar', label: 'Anunciar', group: 'navegacao', auth: true,
    keys: [
      'anunciar', 'anuncio', 'criar anuncio', 'novo anuncio', 'publicar anuncio', 'publicar produto',
      'vender produto', 'vender item', 'quero vender', 'cadastrar produto', 'criar produto',
      'colocar a venda', 'colocar para vender', 'botar para vender', 'anunciar produto', 'tela de anunciar',
    ],
  },
  {
    to: '/meus-anuncios', label: 'Meus anúncios', group: 'navegacao', auth: true,
    keys: [
      'meus anuncios', 'minha anuncios', 'meus produtos', 'meus itens', 'anuncios que criei',
      'gerenciar meus anuncios', 'meus anuncios publicados', 'minhas vendas', 'meus produtos a venda',
      'painel de anuncios', 'meus anuncios ativos',
    ],
  },
  {
    to: '/favoritos', label: 'Favoritos', group: 'navegacao', auth: true,
    keys: [
      'favoritos', 'meus favoritos', 'salvos', 'itens salvos', 'lista de desejos', 'wishlist',
      'coisas que salvei', 'anuncios salvos', 'produtos salvos', 'curtidos', 'meus curtidos',
      'coração', 'coracao', 'itens que curti',
    ],
  },
  {
    to: '/perfil', label: 'Perfil', group: 'conta', auth: true,
    keys: [
      'perfil', 'meu perfil', 'minha conta', 'conta', 'minha pagina', 'meu usuario', 'meus dados',
      'informacoes da conta', 'editar perfil', 'dados pessoais', 'minha area', 'area do usuario',
    ],
  },
  {
    to: '/config', label: 'Configurações', group: 'conta', auth: true,
    keys: [
      'configuracoes', 'configuracao', 'config', 'ajustes', 'preferencias', 'opcoes',
      'settings', 'configurar conta', 'ajustar conta', 'meus ajustes', 'parametros', 'regras do app',
    ],
  },
  {
    to: '/conversas', label: 'Conversas', group: 'conta', auth: true,
    keys: [
      'conversas', 'mensagens', 'chat', 'chats', 'minhas mensagens', 'minhas conversas',
      'caixa de entrada', 'inbox', 'falar com alguem', 'mensagem', 'bate papo', 'batepapo',
      'meus chats', 'central de mensagens',
    ],
  },
  {
    to: '/propostas', label: 'Propostas', group: 'conta', auth: true,
    keys: [
      'propostas', 'minhas propostas', 'ofertas', 'minhas ofertas', 'negociacoes', 'minhas negociacoes',
      'propostas recebidas', 'propostas enviadas', 'contraproposta', 'acordos', 'meus acordos',
    ],
  },
  {
    to: '/alertas', label: 'Alertas', group: 'conta', auth: true,
    keys: [
      'alertas', 'meus alertas', 'notificacoes', 'minhas notificacoes', 'avisos', 'meus avisos',
      'alertas de busca', 'alertas salvos', 'avisos salvos', 'central de notificacoes',
    ],
  },
  {
    to: '/suporte', label: 'Suporte', group: 'ajuda',
    keys: [
      'suporte', 'ajuda', 'socorro', 'me ajuda', 'preciso de ajuda', 'atendimento', 'falar com suporte',
      'contato', 'central de ajuda', 'duvidas', 'tenho uma duvida', 'reclamacao', 'falar com atendente',
      'chamar suporte', 'abrir chamado', 'ticket', 'assistencia',
    ],
  },
  {
    to: '/ranking', label: 'Ranking', group: 'navegacao',
    keys: [
      'ranking', 'rank', 'classificacao', 'melhores usuarios', 'top usuarios', 'ranqueamento',
      'melhores vendedores', 'top vendedores', 'quem vende mais', 'colocacao', 'posicao no ranking',
      'trofeus', 'premiacao',
    ],
  },
  {
    to: '/entrar', label: 'Entrar', group: 'conta',
    keys: [
      'entrar', 'login', 'fazer login', 'logar', 'acessar conta', 'sign in', 'fazer acesso',
      'autenticar', 'entrar na conta', 'tela de login', 'quero entrar',
    ],
  },
  {
    to: '/cadastro', label: 'Criar conta', group: 'conta',
    keys: [
      'cadastro', 'cadastrar', 'criar conta', 'criar uma conta', 'registrar', 'registro', 'sign up',
      'novo usuario', 'abrir conta', 'fazer cadastro', 'quero me cadastrar', 'criar usuario', 'nova conta',
    ],
  },
  {
    to: '/recuperar', label: 'Recuperar senha', group: 'conta',
    keys: [
      'recuperar senha', 'esqueci a senha', 'esqueci minha senha', 'trocar senha', 'redefinir senha',
      'recuperar conta', 'nao consigo entrar', 'trocar a senha', 'mudar senha', 'senha esquecida',
      'resetar senha', 'refazer senha',
    ],
  },
  {
    to: '/confirmar-email', label: 'Confirmar e-mail', group: 'conta',
    keys: [
      'confirmar email', 'verificar email', 'confirmar meu email', 'verificacao de email',
      'ativar email', 'validar email', 'confirmar conta', 'ativar conta', 'verificar conta',
    ],
  },
  {
    to: '/privacidade', label: 'Privacidade', group: 'legal',
    keys: [
      'privacidade', 'politica de privacidade', 'meus dados e privacidade', 'lgpd', 'termos de dados',
      'protecao de dados', 'seguranca e privacidade',
    ],
  },
  {
    to: '/termos', label: 'Termos de uso', group: 'legal',
    keys: [
      'termos', 'termos de uso', 'termos e condicoes', 'regras de uso', 'contrato', 'condicoes de uso',
      'politica de uso', 'aceitar termos',
    ],
  },
  {
    to: '/admin', label: 'Painel do admin', group: 'admin', admin: true,
    keys: [
      'admin', 'administracao', 'painel admin', 'painel administrativo', 'area admin', 'moderacao',
      'gerenciar usuarios', 'painel de controle', 'backoffice', 'administrar o app', 'area administrativa',
    ],
  },
];

// Categorias -> busca por categoria.
const VOICE_CATEGORIES = [
  { slug: 'veiculos', label: 'Veículos', keys: ['veiculo', 'veiculos', 'carro', 'carros', 'automovel', 'automoveis', 'moto', 'motos', 'motocicleta', 'motocicletas', 'caminhonete', 'caminhao', 'pickup', 'suv', 'bicicleta', 'bike', 'bikes', 'onix', 'uno', 'gol', 'strada', 'hilux', 'civic', 'corolla', 'hb20', 'celta', 'palio', 'sandero'] },
  { slug: 'tecnologia', label: 'Celulares e Tecnologia', keys: ['celular', 'celulares', 'tecnologia', 'smartphone', 'smartphones', 'telefone', 'telefones', 'iphone', 'samsung', 'xiaomi', 'motorola', 'eletronico', 'eletronicos', 'informatica', 'tv', 'televisao', 'televisor', 'notebook', 'computador', 'laptop', 'tablet', 'fone', 'fones', 'radio', 'caixa de som', 'som', 'console', 'videogame', 'drone', 'monitor', 'game', 'games', 'jogo', 'jogos', 'playstation', 'ps4', 'ps5', 'xbox', 'nintendo'] },
  { slug: 'casa-moveis', label: 'Casa e Móveis', keys: ['casa', 'movel', 'moveis', 'sofa', 'cama', 'mesa', 'cadeira', 'armario', 'guarda roupa', 'geladeira', 'fogao', 'microondas', 'eletrodomestico', 'eletrodomesticos', 'decoracao', 'colchao', 'cozinha', 'sala', 'quarto', 'utensilio', 'panelas', 'luminaria', 'ar condicionado', 'ventilador'] },
  { slug: 'moda', label: 'Moda e Acessórios', keys: ['moda', 'roupa', 'roupas', 'calcado', 'calcados', 'sapato', 'sapatos', 'tenis', 'camisa', 'camiseta', 'calca', 'bermuda', 'vestido', 'saia', 'blusa', 'casaco', 'jaqueta', 'acessorio', 'acessorios', 'bolsa', 'mochila', 'cinto', 'bone', 'chapeu', 'sunga', 'biquini'] },
  { slug: 'ferramentas', label: 'Ferramentas', keys: ['ferramenta', 'ferramentas', 'furadeira', 'parafusadeira', 'serra', 'martelo', 'chave de fenda', 'alicate', 'esmerilhadeira', 'compressor', 'maquina', 'maquinas', 'equipamento', 'oficina', 'construcao', 'betoneira', 'lixadeira', 'makita', 'bosch'] },
  { slug: 'agro', label: 'Agro e Rural', keys: ['agro', 'rural', 'roca', 'fazenda', 'sitio', 'agricola', 'agricultura', 'semente', 'sementes', 'adubo', 'fertilizante', 'trator', 'implemento', 'colheita', 'plantacao', 'pulverizador', 'cerca', 'arame', 'muda', 'mudas', 'horta', 'hortalica', 'tomate', 'milho', 'cafe'] },
  { slug: 'animais', label: 'Animais', keys: ['animal', 'animais', 'pet', 'pets', 'cachorro', 'cao', 'caes', 'gato', 'gatos', 'passaro', 'passaros', 'ave', 'aves', 'peixe', 'peixes', 'gado', 'boi', 'vaca', 'cavalo', 'porco', 'ovelha', 'galinha', 'frango', 'racao', 'aquario'] },
  { slug: 'lazer', label: 'Esportes e Lazer', keys: ['lazer', 'esporte', 'esportes', 'academia', 'musculacao', 'futebol', 'bola', 'skate', 'patins', 'natacao', 'suplemento', 'suplementos', 'whey', 'halter', 'caneleira', 'surf', 'prancha', 'infantil', 'crianca', 'criancas', 'bebe', 'bebes', 'brinquedo', 'brinquedos', 'livro', 'livros', 'revista'] },
  { slug: 'imoveis', label: 'Imóveis', keys: ['imovel', 'imoveis', 'terreno', 'terrenos', 'apartamento', 'apartamentos', 'casa para vender', 'sitio para vender', 'chacara'] },
  { slug: 'servicos', label: 'Serviços e Outros', keys: ['servico', 'servicos', 'outros', 'outro', 'diversos', 'variados', 'frete', 'pedreiro', 'diarista'] },
];

const VOICE_TYPES = [
  { id: 'venda', keys: ['venda', 'vender', 'comprar', 'compra', 'quero comprar', 'a venda', 'para comprar', 'compras', 'anuncios de venda'] },
  { id: 'troca', keys: ['troca', 'trocar', 'permuta', 'escambo', 'aceita troca', 'para trocar'] },
  { id: 'procuro', keys: ['procuro', 'procurando', 'quero encontrar', 'estou procurando', 'quero achar', 'demanda', 'quero comprar urgente'] },
];

const VOICE_SORTS = [
  { id: 'price_asc', keys: ['mais barato', 'mais baratos', 'menor preco', 'menores precos', 'barato', 'baratinho', 'preco mais baixo', 'economico', 'por preco menor'] },
  { id: 'price_desc', keys: ['mais caro', 'mais caros', 'maior preco', 'maiores precos', 'preco mais alto', 'caro', 'premium', 'luxo'] },
  { id: 'views', keys: ['mais visto', 'mais vistos', 'mais popular', 'populares', 'mais acessado', 'tendencia', 'em alta', 'destaques'] },
  { id: 'recent', keys: ['mais recente', 'mais recentes', 'novos', 'recentes', 'novidade', 'novidades', 'acabou de chegar', 'ultimos', 'recem adicionados'] },
];

function keywordScore(textTokens, text, key) {
  const k = ` ${key} `;
  if (text === key) return 1000 + key.length;
  if (text.startsWith(key + ' ') || text.endsWith(' ' + key) || text.includes(k)) return 400 + key.length;
  const keyTokens = key.split(' ');
  if (keyTokens.length > 1 && keyTokens.every((t) => textTokens.includes(t))) return 200 + key.length;
  if (keyTokens.length === 1 && textTokens.includes(key)) return 150 + key.length;
  return 0;
}

function bestRoute(text, textTokens, opts = {}) {
  let best = null;
  let bestScore = 0;
  for (const route of VOICE_ROUTES) {
    if (route.group === 'leilao' && !opts.auctionEnabled) continue;
    for (const key of route.keys) {
      const s = keywordScore(textTokens, text, key);
      if (s > bestScore) { bestScore = s; best = route; }
    }
  }
  return bestScore >= 150 ? best : null;
}

function bestList(text, textTokens, list, keyName) {
  let best = null;
  let bestScore = 0;
  for (const item of list) {
    const keys = item[keyName || 'keys'] || [];
    for (const key of keys) {
      const s = keywordScore(textTokens, text, key);
      if (s > bestScore) { bestScore = s; best = item; }
    }
  }
  return bestScore >= 150 ? best : null;
}

function extractQuery(text) {
  const m = text.match(/\b(?:buscar|busca|procurar|procura|pesquisar|pesquisa|encontrar|achar|localizar|quero|procuro)\b(?: por| de| sobre| o| a| os| as)?\s+(.+)$/);
  if (m && m[1]) return m[1].trim();
  return text;
}

// Resolve a fala em uma acao. Retorna null quando nao ha comando reconhecido.
export function resolveVoiceCommand(raw, opts = {}) {
  const text = normalizeVoice(raw);
  if (!text) return null;

  const stripped = stripLeadingVerbs(text) || text;
  const tokens = stripped.split(' ').filter(Boolean);
  const allTokens = text.split(' ').filter(Boolean);

  // Ajuda / o que da para fazer
  if (/^(ajuda|o que voce faz|o que da pra fazer|o que posso falar|comandos|falar o que|me ajuda|o que eu falo|quais comandos|opcoes de voz|como usar)$/.test(stripped)) {
    return { type: 'help', label: 'Comandos de voz' };
  }

  // Atalhos explicitos de fala
  if (/\b(ajuda|comandos de voz|o que falar|o que posso dizer)\b/.test(text) && tokens.length <= 4) {
    return { type: 'help', label: 'Comandos de voz' };
  }

  // Rota explicita (tem prioridade apos remover verbos de comando)
  const route = bestRoute(stripped, tokens, opts);
  if (route) return { type: 'navigate', to: route.to, label: route.label, auth: !!route.auth, admin: !!route.admin };

  // Categoria -> busca por categoria
  const cat = bestList(stripped, tokens, VOICE_CATEGORIES);
  if (cat) return { type: 'search', category: cat.slug, label: cat.label };

  // Tipo de anuncio (venda/troca/procuro)
  const type = bestList(stripped, tokens, VOICE_TYPES);
  if (type) return { type: 'search', listingType: type.id, label: 'Anúncios' };

  // Ordenacao
  const sort = bestList(stripped, tokens, VOICE_SORTS);
  if (sort) return { type: 'search', sort: sort.id, label: 'Anúncios' };

  // Fallback de rota usando a frase completa (verbos nao reconhecidos)
  const fullRoute = bestRoute(text, allTokens, opts);
  if (fullRoute) return { type: 'navigate', to: fullRoute.to, label: fullRoute.label, auth: !!fullRoute.auth, admin: !!fullRoute.admin };

  // Busca por categoria/tipo/ordem usando a frase completa
  const fullCat = bestList(text, allTokens, VOICE_CATEGORIES);
  if (fullCat) return { type: 'search', category: fullCat.slug, label: fullCat.label };

  // Busca livre
  if (tokens.length) {
    const q = extractQuery(stripped) || stripped;
    return { type: 'search', q, label: q };
  }
  return null;
}

export function buildSearchUrl(result) {
  const qs = new URLSearchParams();
  if (result.q) qs.set('q', result.q);
  if (result.category) qs.set('category', result.category);
  if (result.listingType) qs.set('type', result.listingType);
  if (result.sort) qs.set('sort', result.sort);
  return '/buscar' + (qs.toString() ? '?' + qs.toString() : '');
}

export const VOICE_HELP_EXAMPLES = [
  '"Leilão ao vivo"',
  '"Meus favoritos"',
  '"Criar anúncio"',
  '"Buscar carro"',
  '"Celulares mais baratos"',
  '"Minhas conversas"',
  '"Ranking"',
  '"Suporte"',
];

export function voiceHelpExamples(auctionEnabled) {
  if (auctionEnabled) return VOICE_HELP_EXAMPLES;
  return VOICE_HELP_EXAMPLES.filter((e) => !/leil/i.test(e));
}
