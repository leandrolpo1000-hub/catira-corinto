const db = require('../db');

const FLAG_DEFS = [
  { key: 'auction_enabled', group: 'geral', name: 'CATIRA LEILÃO', description: 'Liga/desliga o botão de leilão no site. Com OFF, atalhos e rotas somem, mas as configurações continuam salvas.', default: false },
  { key: 'real_time_bids', group: 'geral', name: 'Lances em tempo real', description: 'Atualiza lances, cronômetro e posição sem atualizar a página.', default: true },
  { key: 'auction_watchers_enabled', group: 'geral', name: 'Estou de olho', description: 'Permite acompanhar leilões sem dar lance.', default: true },
  { key: 'auction_notifications_enabled', group: 'geral', name: 'Notificações', description: 'Chave geral das notificações de leilão.', default: true },
  { key: 'auction_auto_extension_enabled', group: 'cronometro', name: 'Extensão automática', description: 'Estende o encerramento quando alguém dá lance nos últimos segundos.', default: false },
  { key: 'auction_reputation_enabled', group: 'reputacao', name: 'Reputação', description: 'Calcula a reputação do arrematador.', default: false },
  { key: 'auction_points_enabled', group: 'reputacao', name: 'Pontos', description: 'Ganha e perde pontos de reputação.', default: false },
  { key: 'auction_penalties_enabled', group: 'penalidades', name: 'Penalidades', description: 'Aplica bloqueio por não pagamento. Com OFF, só registra o histórico.', default: false },
  { key: 'auction_gamification_enabled', group: 'gamificacao', name: 'Gamificação', description: 'Chave geral de níveis, badges, conquistas e ranking.', default: false },
  { key: 'auction_badges_enabled', group: 'gamificacao', name: 'Badges', description: 'Medalhas e selos de conquista.', default: false },
  { key: 'auction_levels_enabled', group: 'gamificacao', name: 'Níveis', description: 'Níveis de arrematador.', default: false },
  { key: 'auction_achievements_enabled', group: 'gamificacao', name: 'Conquistas', description: 'Conquistas desbloqueáveis.', default: false },
  { key: 'auction_ranking_enabled', group: 'gamificacao', name: 'Ranking', description: 'Ranking público dos participantes.', default: false },
  { key: 'auction_early_unlock_enabled', group: 'desbloqueio', name: 'Desbloqueio pago', description: 'Permite reativar a participação mediante taxa administrativa.', default: false },
  { key: 'auction_reputation_benefits_enabled', group: 'reputacao', name: 'Benefícios por reputação', description: 'Vantagens para usuários com boa reputação.', default: false },
  { key: 'auction_antifraud_enabled', group: 'antifraude', name: 'Antifraude', description: 'Registra e sinaliza comportamentos suspeitos sem bloquear automaticamente.', default: true },
  { key: 'auction_audio_enabled', group: 'geral', name: 'Áudio do leilão', description: 'Toca as faixas de ambiente conforme o estado do lote. Não altera lance, prazo nem pagamento.', default: true },
  { key: 'auction_sunday_schedule_enabled', group: 'domingo', name: 'Leilão programado', description: 'Liga o evento com programação no dia e horário definidos pelo administrador no perfil.', default: true },
  { key: 'auction_countdown_enabled', group: 'domingo', name: 'Contagem regressiva', description: 'Mostra o cronômetro até a próxima rodada e até o lote começar.', default: true },
  { key: 'auction_live_mode_enabled', group: 'domingo', name: 'Modo ao vivo', description: 'Destaque de evento ao vivo com lote atual, próximo lote e lotes restantes.', default: true },
  { key: 'auction_lot_extension_enabled', group: 'domingo', name: 'Extensão do lote', description: 'Estende o lote quando há lance nos últimos segundos. Usa os mesmos segundos da extensão automática.', default: true },
  { key: 'auction_featured_lots_enabled', group: 'domingo', name: 'Lotes em destaque', description: 'Exibe selo DESTAQUE e prévia dos melhores lotes da noite.', default: true },
  { key: 'auction_final_lot_enabled', group: 'domingo', name: 'Grande lote final', description: 'Identidade especial para o último lote da noite.', default: true },
  { key: 'auction_warmup_enabled', group: 'domingo', name: 'Aquecimento', description: 'Mantém a aba viva entre a primeira rodada e a noite, com prévia e avisos.', default: true },
];

const NOTIFY_DEFS = [
  { key: 'notify_starting', name: 'Leilão começando', description: 'Avisa quando o leilão observado começa.', default: true },
  { key: 'notify_outbid', name: 'Fui ultrapassado', description: 'Avisa quando outro usuário passa o seu lance.', default: true },
  { key: 'notify_five_min', name: 'Faltam 5 minutos', description: 'Avisa 5 minutos antes do encerramento.', default: true },
  { key: 'notify_one_min', name: 'Faltam 1 minuto', description: 'Avisa 1 minuto antes do encerramento.', default: true },
  { key: 'notify_thirty_sec', name: 'Faltam 30 segundos', description: 'Avisa 30 segundos antes do encerramento.', default: true },
  { key: 'notify_ended', name: 'Leilão encerrado', description: 'Avisa quando um leilão observado encerra.', default: true },
  { key: 'notify_won', name: 'Eu venci', description: 'Avisa quando você arremata.', default: true },
  { key: 'notify_lost', name: 'Eu perdi', description: 'Avisa quando você participou e não venceu.', default: true },
  { key: 'notify_lot_starting', name: 'Avisar quando começar', description: 'Avisa quem marcou o lote que a disputa está começando.', default: true },
];

const LEVELS_DEFAULT = [
  { id: 'novato', name: 'Novato', minPaid: 0, minRate: 0 },
  { id: 'participante', name: 'Participante', minPaid: 3, minRate: 50 },
  { id: 'arrematador', name: 'Arrematador', minPaid: 10, minRate: 70 },
  { id: 'experiente', name: 'Arrematador Experiente', minPaid: 25, minRate: 85 },
  { id: 'elite', name: 'Arrematador de Elite', minPaid: 50, minRate: 95 },
];

const SETTINGS_DEFAULTS = {
  startingBidMin: 1,
  minIncrement: 1,
  minDurationHours: 1,
  maxDurationHours: 720,
  paymentDeadlineHours: 48,
  extensionSeconds: 30,
  extensionTriggerSeconds: 30,
  maxExtensions: 0,
  penalty1Days: 30,
  penalty2Days: 90,
  penalty3Days: 180,
  penalty4Days: 365,
  permanentPenaltyEnabled: true,
  pointsPaid: 10,
  pointsNotPaid: -30,
  pointsOnTimeBonus: 5,
  reputationLevels: LEVELS_DEFAULT,
  achievements: [
    { id: 'primeiro', name: 'Primeiro Arremate', icon: '🏅', type: 'paid', threshold: 1 },
    { id: 'cinco', name: '5 Arremates Concluídos', icon: '🔥', type: 'paid', threshold: 5 },
    { id: 'dez', name: '10 Arremates Concluídos', icon: '💎', type: 'paid', threshold: 10 },
    { id: 'cinquenta', name: '50 Arremates', icon: '🏆', type: 'paid', threshold: 50 },
    { id: 'mestre', name: 'Mestre dos Leilões', icon: '⚡', type: 'rate', threshold: 100, extra: 10 },
  ],
  badges: [
    { id: 'confianca', name: 'Selo de Confiança', icon: '✅', minPaid: 10, minRate: 90 },
  ],
  displayNames: 'abbrev',
  rankingMetric: 'points',
  earlyUnlockFee: 0,
  earlyUnlockCooldown: 30,
  earlyUnlockMaxUses: 0,
  auctionApprovalRequired: false,
  sundayEventWeekday: 0,
  sundayTimezone: 'America/Sao_Paulo',
  sundayOpenTime: '09:00',
  sundayFirstRoundStart: '10:00',
  sundayFirstRoundEnd: '11:00',
  sundayWarmupStart: '14:00',
  sundayWarmupEnd: '19:30',
  sundayMainStart: '20:00',
  sundayMainEnd: '21:30',
  sundayFinalLotTime: '21:30',
  sundayDefaultDurationMinutes: 8,
  sundayLotIntervalMinutes: 2,
  sundaySimpleDurationMinutes: 5,
  sundayMediumDurationMinutes: 7,
  sundayImportantDurationMinutes: 10,
  sundaySpecialDurationMinutes: 12,
  soonMinutes: 10,
  tensionStartSeconds: 60,
  countdownStartSeconds: 10,
  antesStartSeconds: 600,
  audioOverlapEnabled: false,
  audioOverlapSeconds: 4,
  volumeDurante: 0.35,
  volumeArrematado: 0.8,
  volumeContagem: 0.7,
  volumeTensao: 0.55,
  volumeUltimoLote: 0.6,
  volumeLoteImportante: 0.6,
  volumeNovoLote: 0.7,
  volumeAntes: 0.45,
};

const CONFIG_ID = 'auctionConfig';

function boolOf(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function getStored() {
  const row = db.findOne('settings', (s) => s.id === CONFIG_ID) || {};
  return {
    id: CONFIG_ID,
    flags: row.flags && typeof row.flags === 'object' ? row.flags : {},
    notifications: row.notifications && typeof row.notifications === 'object' ? row.notifications : {},
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
  };
}

function flagRecord(stored, key) {
  const def = FLAG_DEFS.find((f) => f.key === key) || NOTIFY_DEFS.find((f) => f.key === key);
  const fallback = def ? def.default : false;
  const isNotify = !!NOTIFY_DEFS.find((f) => f.key === key);
  const bag = isNotify ? stored.notifications : stored.flags;
  const row = bag[key] || {};
  return {
    enabled: boolOf(row.enabled, fallback),
    updatedAt: row.updatedAt || null,
    updatedBy: row.updatedBy || '',
    updatedByName: row.updatedByName || '',
  };
}

function rawFlags(stored) {
  const out = {};
  FLAG_DEFS.forEach((f) => { out[f.key] = flagRecord(stored, f.key).enabled; });
  NOTIFY_DEFS.forEach((f) => { out[f.key] = flagRecord(stored, f.key).enabled; });
  return out;
}

function effectiveFlags(raw) {
  const on = { ...raw };
  if (!on.auction_enabled) {
    Object.keys(on).forEach((k) => { if (k !== 'auction_enabled') on[k] = false; });
    return on;
  }
  if (!on.auction_gamification_enabled) {
    on.auction_badges_enabled = false;
    on.auction_levels_enabled = false;
    on.auction_achievements_enabled = false;
    on.auction_ranking_enabled = false;
  }
  if (!on.auction_watchers_enabled) {
    // Observar sem dar lance é pré-requisito das notificações por observação.
    on.notify_starting = false;
    on.notify_lot_starting = false;
    on.notify_five_min = false;
    on.notify_one_min = false;
    on.notify_thirty_sec = false;
    on.notify_ended = false;
  }
  if (!on.auction_notifications_enabled) {
    NOTIFY_DEFS.forEach((f) => { on[f.key] = false; });
  }
  if (!on.auction_reputation_enabled) {
    on.auction_points_enabled = false;
    on.auction_reputation_benefits_enabled = false;
  }
  if (!on.auction_sunday_schedule_enabled) {
    on.auction_countdown_enabled = false;
    on.auction_live_mode_enabled = false;
    on.auction_lot_extension_enabled = false;
    on.auction_featured_lots_enabled = false;
    on.auction_final_lot_enabled = false;
    on.auction_warmup_enabled = false;
  }
  return on;
}

function getAuctionConfig() {
  const stored = getStored();
  const raw = rawFlags(stored);
  const settings = { ...structuredClone(SETTINGS_DEFAULTS), ...stored.settings };
  if (!Array.isArray(settings.reputationLevels) || !settings.reputationLevels.length) {
    settings.reputationLevels = LEVELS_DEFAULT;
  }
  if (!Array.isArray(settings.achievements) || !settings.achievements.length) {
    settings.achievements = SETTINGS_DEFAULTS.achievements;
  }
  if (!Array.isArray(settings.badges) || !settings.badges.length) {
    settings.badges = SETTINGS_DEFAULTS.badges;
  }
  return { stored, raw, flags: effectiveFlags(raw), settings };
}

function publicAuctionConfig() {
  const cfg = getAuctionConfig();
  return {
    flags: cfg.flags,
    enabled: cfg.flags.auction_enabled,
    settings: {
      startingBidMin: cfg.settings.startingBidMin,
      minIncrement: cfg.settings.minIncrement,
      minDurationHours: cfg.settings.minDurationHours,
      maxDurationHours: cfg.settings.maxDurationHours,
      paymentDeadlineHours: cfg.settings.paymentDeadlineHours,
      extensionSeconds: cfg.settings.extensionSeconds,
      extensionTriggerSeconds: cfg.settings.extensionTriggerSeconds,
      maxExtensions: cfg.settings.maxExtensions,
      earlyUnlockFee: cfg.settings.earlyUnlockFee,
      displayNames: cfg.settings.displayNames,
      sundayEventWeekday: cfg.settings.sundayEventWeekday,
      sundayTimezone: cfg.settings.sundayTimezone,
      sundayOpenTime: cfg.settings.sundayOpenTime,
      sundayFirstRoundStart: cfg.settings.sundayFirstRoundStart,
      sundayFirstRoundEnd: cfg.settings.sundayFirstRoundEnd,
      sundayWarmupStart: cfg.settings.sundayWarmupStart,
      sundayWarmupEnd: cfg.settings.sundayWarmupEnd,
      sundayMainStart: cfg.settings.sundayMainStart,
      sundayMainEnd: cfg.settings.sundayMainEnd,
      sundayFinalLotTime: cfg.settings.sundayFinalLotTime,
      sundayDefaultDurationMinutes: cfg.settings.sundayDefaultDurationMinutes,
      sundayLotIntervalMinutes: cfg.settings.sundayLotIntervalMinutes,
      sundaySimpleDurationMinutes: cfg.settings.sundaySimpleDurationMinutes,
      sundayMediumDurationMinutes: cfg.settings.sundayMediumDurationMinutes,
      sundayImportantDurationMinutes: cfg.settings.sundayImportantDurationMinutes,
      sundaySpecialDurationMinutes: cfg.settings.sundaySpecialDurationMinutes,
      soonMinutes: cfg.settings.soonMinutes,
      extensionSeconds: cfg.settings.extensionSeconds,
      extensionTriggerSeconds: cfg.settings.extensionTriggerSeconds,
      tensionStartSeconds: cfg.settings.tensionStartSeconds,
      countdownStartSeconds: cfg.settings.countdownStartSeconds,
      antesStartSeconds: cfg.settings.antesStartSeconds,
      audioOverlapEnabled: !!cfg.settings.audioOverlapEnabled,
      audioOverlapSeconds: cfg.settings.audioOverlapSeconds,
      volumeDurante: cfg.settings.volumeDurante,
      volumeArrematado: cfg.settings.volumeArrematado,
      volumeContagem: cfg.settings.volumeContagem,
      volumeTensao: cfg.settings.volumeTensao,
      volumeUltimoLote: cfg.settings.volumeUltimoLote,
      volumeLoteImportante: cfg.settings.volumeLoteImportante,
      volumeNovoLote: cfg.settings.volumeNovoLote,
      volumeAntes: cfg.settings.volumeAntes,
    },
  };
}

function adminAuctionConfig() {
  const cfg = getAuctionConfig();
  return {
    flags: FLAG_DEFS.map((f) => ({ ...f, ...flagRecord(cfg.stored, f.key), rawEnabled: cfg.raw[f.key] })),
    notifications: NOTIFY_DEFS.map((f) => ({ ...f, ...flagRecord(cfg.stored, f.key), rawEnabled: cfg.raw[f.key] })),
    settings: cfg.settings,
  };
}

function logChange(admin, scope, key, oldValue, newValue) {
  if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
  db.insert('auctionAdminLogs', {
    adminId: admin ? admin.id : '',
    adminName: admin ? admin.name : 'sistema',
    at: new Date().toISOString(),
    scope,
    key,
    oldValue,
    newValue,
  });
}

function saveAuctionConfig({ flags, notifications, settings }, admin) {
  const stored = getStored();
  const now = new Date().toISOString();
  const who = admin || {};
  const nextFlags = { ...stored.flags };
  const nextNotifs = { ...stored.notifications };
  const nextSettings = { ...stored.settings };

  const flagMap = new Map(FLAG_DEFS.map((f) => [f.key, f]));
  const notifMap = new Map(NOTIFY_DEFS.map((f) => [f.key, f]));

  if (flags && typeof flags === 'object') {
    Object.keys(flags).forEach((key) => {
      if (!flagMap.has(key)) return;
      const current = flagRecord(stored, key);
      const value = !!flags[key];
      nextFlags[key] = { enabled: value, updatedAt: now, updatedBy: who.id || '', updatedByName: who.name || '' };
      logChange(admin, 'flag', key, current.enabled, value);
    });
  }
  if (notifications && typeof notifications === 'object') {
    Object.keys(notifications).forEach((key) => {
      if (!notifMap.has(key)) return;
      const current = flagRecord(stored, key);
      const value = !!notifications[key];
      nextNotifs[key] = { enabled: value, updatedAt: now, updatedBy: who.id || '', updatedByName: who.name || '' };
      logChange(admin, 'notificacao', key, current.enabled, value);
    });
  }
  if (settings && typeof settings === 'object') {
    Object.keys(settings).forEach((key) => {
      if (!(key in SETTINGS_DEFAULTS)) return;
      let value = settings[key];
      const numericKeys = Object.keys(SETTINGS_DEFAULTS).filter((k) => typeof SETTINGS_DEFAULTS[k] === 'number');
      if (numericKeys.includes(key)) {
        value = Number(value);
        if (!Number.isFinite(value)) return;
        if (key.indexOf('volume') === 0) {
          if (value < 0) value = 0;
          if (value > 1) value = 1;
        }
        if (key === 'tensionStartSeconds' || key === 'countdownStartSeconds' || key === 'antesStartSeconds') {
          if (value < 1) value = 1;
        }
        if (key === 'audioOverlapSeconds') {
          if (value < 0) value = 0;
          if (value > 30) value = 30;
        }
        if (key === 'sundayEventWeekday') {
          value = Math.round(value);
          if (value < 0 || value > 6) value = 0;
        }
      }
      if (key === 'reputationLevels' && Array.isArray(value)) {
        value = value.map((l, i) => ({
          id: String(l.id || 'nivel-' + i),
          name: String(l.name || 'Nível ' + (i + 1)),
          minPaid: Number(l.minPaid) || 0,
          minRate: Number(l.minRate) || 0,
        }));
      }
      if (key === 'achievements' && Array.isArray(value)) {
        value = value.map((a, i) => ({
          id: String(a.id || 'conquista-' + i),
          name: String(a.name || 'Conquista ' + (i + 1)),
          icon: String(a.icon || '🏅'),
          type: a.type === 'rate' ? 'rate' : 'paid',
          threshold: Number(a.threshold) || 0,
          extra: Number(a.extra) || 0,
        }));
      }
      if (key === 'badges' && Array.isArray(value)) {
        value = value.map((b, i) => ({
          id: String(b.id || 'selo-' + i),
          name: String(b.name || 'Selo ' + (i + 1)),
          icon: String(b.icon || '✅'),
          minPaid: Number(b.minPaid) || 0,
          minRate: Number(b.minRate) || 0,
        }));
      }
      if (key === 'displayNames' && !['full', 'abbrev', 'id'].includes(value)) return;
      if (typeof SETTINGS_DEFAULTS[key] === 'boolean') value = !!value;
      if (typeof SETTINGS_DEFAULTS[key] === 'string' && key !== 'displayNames' && key !== 'rankingMetric') {
        value = String(value || '').slice(0, 32);
      }
      const old = stored.settings[key] !== undefined ? stored.settings[key] : SETTINGS_DEFAULTS[key];
      nextSettings[key] = value;
      logChange(admin, 'config', key, old, value);
    });
  }

  const payload = { id: CONFIG_ID, flags: nextFlags, notifications: nextNotifs, settings: nextSettings };
  const existing = db.findById('settings', CONFIG_ID);
  if (existing) db.update('settings', CONFIG_ID, payload);
  else db.insert('settings', payload);
  return adminAuctionConfig();
}

function flagOn(key) {
  return !!getAuctionConfig().flags[key];
}

module.exports = {
  FLAG_DEFS,
  NOTIFY_DEFS,
  SETTINGS_DEFAULTS,
  LEVELS_DEFAULT,
  getAuctionConfig,
  publicAuctionConfig,
  adminAuctionConfig,
  saveAuctionConfig,
  flagOn,
  logChange,
};
