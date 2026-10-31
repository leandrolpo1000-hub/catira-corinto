const fs = require('fs');
const path = require('path');
const db = require('./db');

const DEFAULTS = {
  id: 'assistant',
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

// Modelos que já recusaram o parâmetro de raciocínio (para não desperdiçar chamadas).
const reasoningUnsupported = new Set();

// Traduz erros técnicos dos provedores para uma mensagem simples ao anunciante.
function friendlyApiError(message, status) {
  const m = String(message || '');
  if (status === 429 || /quota|resource_exhausted|rate limit|too many requests/i.test(m)) {
    return 'O assistente atingiu o limite de uso por agora. Tente de novo mais tarde ou peça ao administrador para ativar o plano completo.';
  }
  if (status === 503 || /high demand|unavailable|overloaded/i.test(m)) {
    return 'O assistente está muito ocupado neste momento. Tente de novo em alguns minutos.';
  }
  return m || 'Não foi possível concluir a análise agora. Tente de novo em instantes.';
}

function hintKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length < 8) return '••••';
  return s.slice(0, 3) + '••••' + s.slice(-4);
}

function getAssistantSettings() {
  const row = db.findOne('settings', (s) => s.id === 'assistant') || {};
  return {
    ...DEFAULTS,
    ...row,
    id: 'assistant',
    baseUrl: String(row.baseUrl || DEFAULTS.baseUrl).trim().replace(/\/+$/, ''),
    model: String(row.model || DEFAULTS.model).trim(),
  };
}

function publicAssistantSettings() {
  const s = getAssistantSettings();
  const apiKeySet = !!(s.apiKey && String(s.apiKey).trim());
  const enabled = s.enabled === true || s.enabled === 'true' || s.enabled === 1;
  return {
    enabled,
    baseUrl: s.baseUrl,
    model: s.model,
    apiKeySet,
    apiKeyHint: apiKeySet ? hintKey(s.apiKey) : '',
    configured: apiKeySet && enabled,
  };
}

function looksMasked(value) {
  return /[•*]/.test(String(value || ''));
}

function saveAssistantSettings(patch) {
  const current = getAssistantSettings();
  const incomingKey = patch.apiKey !== undefined ? String(patch.apiKey).trim() : '';
  const next = {
    id: 'assistant',
    enabled: patch.enabled === undefined
      ? (current.enabled === true || current.enabled === 'true' || current.enabled === 1)
      : (patch.enabled === true || patch.enabled === 'true' || patch.enabled === 1),
    baseUrl: patch.baseUrl !== undefined ? (String(patch.baseUrl).trim().replace(/\/+$/, '') || DEFAULTS.baseUrl) : current.baseUrl,
    model: patch.model !== undefined ? (String(patch.model).trim() || DEFAULTS.model) : current.model,
    apiKey: incomingKey && !looksMasked(incomingKey) ? incomingKey : current.apiKey,
  };
  if (next.enabled && !next.apiKey) {
    const err = new Error('Informe a API key do assistente.');
    err.status = 400;
    throw err;
  }
  if (next.enabled && !/^https?:\/\//i.test(next.baseUrl)) {
    const err = new Error('A URL da API deve começar com http.');
    err.status = 400;
    throw err;
  }
  const existing = db.findById('settings', 'assistant');
  return existing ? db.update('settings', 'assistant', next) : db.insert('settings', next);
}

function assistantReady() {
  const s = getAssistantSettings();
  const enabled = s.enabled === true || s.enabled === 'true' || s.enabled === 1;
  return !!(enabled && s.apiKey && s.baseUrl && s.model);
}

function parseAssistantJson(raw) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function chatCompletion({ messages, temperature, timeoutMs, maxTokens, reasoningEffort }) {
  const s = getAssistantSettings();
  if (!assistantReady()) {
    const err = new Error('Assistente ainda não está ativo. O administrador precisa configurar a chave de IA.');
    err.status = 400;
    throw err;
  }
  const body = { model: s.model, temperature: temperature === undefined ? 0.4 : temperature, messages };
  if (maxTokens) body.max_tokens = maxTokens;
  // Modelos que "pensam" (ex.: Gemini 3.x) gastam tokens de raciocínio e podem cortar a
  // resposta no meio. Como aqui só precisamos de JSON objetivo, pedimos o mínimo de raciocínio.
  if (reasoningEffort && !/lite/i.test(s.model) && !reasoningUnsupported.has(s.model)) body.reasoning_effort = reasoningEffort;
  // Provedores de IA costumam responder 429/503 de forma temporária quando estão cheios.
  // Tentamos de novo antes de desistir, para o anunciante não ver falha sem motivo.
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  const ATTEMPTS = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 45000);
    let res;
    try {
      res = await fetch(s.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + s.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastErr = new Error(e && e.name === 'AbortError'
        ? 'O assistente demorou para responder. Tente de novo.'
        : 'Não foi possível falar com o assistente agora.');
      lastErr.status = 400;
      break;
    }
    clearTimeout(timer);
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      return payload && payload.choices && payload.choices[0] && payload.choices[0].message
        ? payload.choices[0].message.content
        : '';
    }
    const message = extractApiError(payload);
    // Se o provedor (ou este modelo) não aceitar o parâmetro de raciocínio, memoriza e tenta de novo.
    if (res.status === 400 && body.reasoning_effort && /reasoning|unsupported|unknown|invalid/i.test(message)) {
      reasoningUnsupported.add(s.model);
      delete body.reasoning_effort;
      continue;
    }
    const friendly = friendlyApiError(message, res.status);
    lastErr = new Error(friendly);
    lastErr.status = res.status >= 400 && res.status < 500 ? 400 : 502;
    if (!RETRYABLE.has(res.status) || attempt === ATTEMPTS) break;
    await new Promise((r) => setTimeout(r, 600 * attempt));
  }
  throw lastErr;
}

// Alguns provedores (ex.: Gemini no modo compatível com OpenAI) devolvem o erro
// dentro de uma lista: [{ error: {...} }]. Aqui extraímos a mensagem legível.
function extractApiError(payload) {
  const fallback = 'Não foi possível concluir a análise agora. Tente de novo em instantes.';
  let obj = payload;
  if (Array.isArray(obj)) obj = obj[0];
  const e = obj && obj.error ? obj.error : obj;
  const msg = e && e.message ? e.message : '';
  if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 300);
  return fallback;
}

function cleanList(arr, max, itemMax) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max)
    .map((x) => x.slice(0, itemMax || 60));
}

// Análise rica da foto: identifica o produto, sugere anúncio e aponta o que falta.
// Regra dura: nunca afirmar funcionamento, conservação ou características não observáveis.
async function analyzeImage({ dataUrl, categories, listingType, hint, city }) {
  if (!assistantReady()) {
    const err = new Error('Assistente ainda não está ativo. O administrador precisa configurar a chave de IA.');
    err.status = 400;
    throw err;
  }
  const catList = (categories || []).map((c) => '- ' + c.slug + ' = ' + c.name).join('\n');
  const system =
    'Você é o assistente de anúncios do CATIRA, um site de compra, venda e troca do interior de Minas Gerais. ' +
    'Seu público tem pouca familiaridade com tecnologia. A partir da FOTO do produto, prepare um anúncio simples, honesto e em português brasileiro. ' +
    'NUNCA invente informações: não afirme que o produto funciona, está conservado, tem determinada marca, medida, capacidade ou defeito que você não consegue ver na foto. ' +
    'Quando não tiver certeza, deixe o campo vazio e liste a dúvida em "missing". ' +
    'Responda SOMENTE com um JSON válido, sem texto fora do JSON, no formato: ' +
    '{' +
    '"identified": boolean (conseguiu reconhecer o produto com segurança?), ' +
    '"productName": string (nome popular e curto do produto, ex.: "geladeira"; vazio se não identificou), ' +
    '"title": string (até 60 caracteres, sem preço), ' +
    '"description": string (de 2 a 4 frases curtas e populares), ' +
    '"categorySlug": string (exatamente um dos slugs da lista), ' +
    '"condition": "novo"|"seminovo"|"usado" (estime só pelo visível; na dúvida use "usado"), ' +
    '"features": string[] (até 5 características VISÍVEIS na foto, ex.: "cor branca", "duas portas"), ' +
    '"missing": string[] (até 4 informações que faltam para concluir o anúncio, ex.: "Preço", "Marca e modelo", "Tempo de uso"), ' +
    '"imageQuality": "ok"|"dark"|"blurry" (a foto está boa, escura ou desfocada?), ' +
    '"prohibited": boolean (produto proibido, ilegal ou suspeito?), ' +
    '"prohibitedReason": string (motivo curto, se proibido)' +
    '}';
  const userText =
    'Tipo de anúncio: ' + (listingType || 'venda') + '.\n' +
    (city ? 'Cidade: ' + city + '.\n' : '') +
    'Slugs de categoria disponíveis:\n' + catList + '\n' +
    (hint ? 'Observação do anunciante: ' + hint + '\n' : '') +
    'Analise a foto e devolva o JSON.';
  const content = await chatCompletion({
    temperature: 0.3,
    maxTokens: 1500,
    reasoningEffort: 'none',
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const parsed = parseAssistantJson(content);
  if (!parsed) {
    const err = new Error('O assistente não conseguiu analisar a foto. Tente outra foto, mais clara e de perto.');
    err.status = 502;
    throw err;
  }
  const slug = String(parsed.categorySlug || '').trim();
  const match = (categories || []).find((c) => c.slug === slug) || null;
  const condition = ['novo', 'seminovo', 'usado'].includes(parsed.condition) ? parsed.condition : 'usado';
  const quality = ['ok', 'dark', 'blurry'].includes(parsed.imageQuality) ? parsed.imageQuality : 'ok';
  const identified = parsed.identified === true && String(parsed.productName || '').trim().length > 0;
  return {
    identified,
    productName: String(parsed.productName || '').trim().slice(0, 60),
    title: String(parsed.title || '').trim().slice(0, 80),
    description: String(parsed.description || '').trim().slice(0, 1000),
    categoryId: match ? match.id : '',
    categorySlug: match ? match.slug : '',
    categoryName: match ? match.name : '',
    condition,
    features: cleanList(parsed.features, 5, 60),
    missing: cleanList(parsed.missing, 4, 60),
    imageQuality: quality,
    prohibited: parsed.prohibited === true,
    prohibitedReason: String(parsed.prohibitedReason || '').trim().slice(0, 160),
  };
}

// Melhora o título e a descrição já existentes, sem inventar fatos.
async function improveText({ title, description, listingType, categoryName }) {
  if (!assistantReady()) {
    const err = new Error('Assistente ainda não está ativo. O administrador precisa configurar a chave de IA.');
    err.status = 400;
    throw err;
  }
  const system =
    'Você revisa anúncios do CATIRA, um marketplace do interior de Minas Gerais. ' +
    'Melhore o título e a descrição com linguagem simples, clara e correta em português do Brasil. ' +
    'Corrija erros de português. NUNCA invente características, marcas, medidas ou defeitos. ' +
    'NUNCA afirme que o produto funciona, está conservado, novo, ou em bom estado se isso não estiver escrito no texto original. ' +
    'Não acrescente garantias nem promessas. Mantenha o sentido original e não coloque preço. ' +
    'Se o texto original for curto, apenas o deixe mais claro e correto, sem inventar detalhes. ' +
    'Responda SOMENTE com JSON: {"title": string (até 60 caracteres), "description": string (2 a 4 frases)}.';
  const userText =
    'Tipo: ' + (listingType || 'venda') + '.\n' +
    (categoryName ? 'Categoria: ' + categoryName + '.\n' : '') +
    'Título atual: ' + String(title || '').trim() + '\n' +
    'Descrição atual: ' + String(description || '').trim();
  const content = await chatCompletion({
    temperature: 0.3,
    maxTokens: 800,
    reasoningEffort: 'none',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userText },
    ],
  });
  const parsed = parseAssistantJson(content);
  if (!parsed || !parsed.title) {
    const err = new Error('Não foi possível melhorar o texto agora. Tente de novo.');
    err.status = 502;
    throw err;
  }
  return {
    title: String(parsed.title || '').trim().slice(0, 80),
    description: String(parsed.description || '').trim().slice(0, 1000),
  };
}

async function transcribeWithCloud(filePath, originalName, mimeType) {
  if (!assistantReady() || typeof Blob === 'undefined' || typeof FormData === 'undefined') return '';
  const s = getAssistantSettings();
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return '';
  }
  const name = path.basename(originalName || filePath || 'audio.webm');
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mimeType || 'audio/mpeg' }), name);
  fd.append('model', 'whisper-1');
  fd.append('language', 'pt');
  fd.append('response_format', 'json');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(s.baseUrl + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + s.apiKey },
      body: fd,
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return '';
    return String(payload.text || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeAudio(filePath, originalName, mimeType) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const cloud = await transcribeWithCloud(filePath, originalName, mimeType);
  if (cloud) return cloud;
  try {
    const { transcribeLocal } = require('./transcribeLocal');
    return await transcribeLocal(filePath);
  } catch {
    return '';
  }
}

module.exports = {
  getAssistantSettings,
  publicAssistantSettings,
  saveAssistantSettings,
  assistantReady,
  analyzeImage,
  improveText,
  transcribeAudio,
};
