import { createElement, useEffect, useRef, useState } from 'react';

const TRACKS = {
  contagem: { file: 'Contagem regressiva', loop: true, volumeKey: 'volumeContagem', priority: 100 },
  arrematado: { file: 'Arrematado', loop: false, volumeKey: 'volumeArrematado', priority: 90 },
  tensao: { file: 'Clima de tensão', loop: true, volumeKey: 'volumeTensao', priority: 80 },
  ultimo: { file: 'Ultimo lote', loop: false, volumeKey: 'volumeUltimoLote', priority: 70 },
  importante: { file: 'Lote Importante', loop: false, volumeKey: 'volumeLoteImportante', priority: 60 },
  novo: { file: 'Novo lote', loop: false, volumeKey: 'volumeNovoLote', priority: 50 },
  antes: { file: 'Antes de começar', loop: true, volumeKey: 'volumeAntes', priority: 20 },
  durante: { file: 'Durante', loop: true, volumeKey: 'volumeDurante', priority: 10 },
};

const EXTS = ['.wav', '.mp3', '.ogg', '.m4a'];
const MUTE_KEY = 'catiraAuctionMute';

const players = {};
const resolved = {};
const resolving = {};
const fadeTimers = {};
let unlocked = false;
let muted = false;
let currentId = null;
let oneshotUntil = 0;
let lastShotKey = '';
let unlockBound = false;
let previewing = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch (e) {
  muted = false;
}

function volOf(id, settings) {
  const key = TRACKS[id] && TRACKS[id].volumeKey;
  const n = settings && key ? Number(settings[key]) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export function setAuctionAudioSources(files) {
  if (!files || typeof files !== 'object') return;
  Object.keys(files).forEach((id) => {
    if (files[id]) resolved[id] = files[id];
  });
}

function candidates(file) {
  return EXTS.map((ext) => '/audio/' + encodeURIComponent(file) + ext);
}

function resolveSrc(id) {
  if (resolved[id]) return Promise.resolve(resolved[id]);
  if (resolving[id]) return resolving[id];
  const meta = TRACKS[id];
  if (!meta) return Promise.resolve('');
  resolving[id] = (async () => {
    const list = ['/audio/' + id].concat(candidates(meta.file));
    for (let i = 0; i < list.length; i++) {
      try {
        const r = await fetch(list[i], { method: 'GET', headers: { Range: 'bytes=0-1' } });
        if (r.ok || r.status === 206) {
          resolved[id] = list[i];
          return list[i];
        }
      } catch (e) {}
    }
    resolved[id] = '';
    return '';
  })();
  return resolving[id];
}

function ensurePlayer(id) {
  if (players[id]) return players[id];
  const el = new Audio();
  el.preload = 'auto';
  el.loop = !!(TRACKS[id] && TRACKS[id].loop);
  el.setAttribute('playsinline', 'true');
  players[id] = el;
  return el;
}

function clearFade(id) {
  if (fadeTimers[id]) {
    clearInterval(fadeTimers[id]);
    delete fadeTimers[id];
  }
}

function stopId(id) {
  clearFade(id);
  const el = players[id];
  if (!el) return;
  try { el.pause(); el.currentTime = 0; } catch (e) {}
}

function overlapOf(settings) {
  const on = !!(settings && settings.audioOverlapEnabled);
  const sec = Number(settings && settings.audioOverlapSeconds);
  const seconds = Number.isFinite(sec) ? Math.max(0, Math.min(30, sec)) : 4;
  return on && seconds > 0 ? seconds : 0;
}

function fadeOut(id, seconds) {
  const el = players[id];
  if (!el) return;
  clearFade(id);
  const dur = Math.max(0.1, Number(seconds) || 0);
  const startVol = el.volume;
  const started = Date.now();
  fadeTimers[id] = setInterval(() => {
    const t = (Date.now() - started) / (dur * 1000);
    if (t >= 1 || !players[id]) {
      stopId(id);
      return;
    }
    try { el.volume = Math.max(0, startVol * (1 - t)); } catch (e) {}
  }, 50);
}

function stopOthers(keepId, settings) {
  const overlap = overlapOf(settings);
  Object.keys(players).forEach((k) => {
    if (k === keepId) return;
    if (overlap && players[k] && !players[k].paused) fadeOut(k, overlap);
    else stopId(k);
  });
}

function stopAll() {
  Object.keys(players).forEach(stopId);
  currentId = null;
  previewing = false;
}

function playId(id, settings, restart, force) {
  if (!force && (muted || !unlocked)) return Promise.resolve(false);
  if (!TRACKS[id]) return Promise.resolve(false);
  clearFade(id);
  const el = ensurePlayer(id);
  el.loop = !!TRACKS[id].loop;
  el.volume = volOf(id, settings);
  return resolveSrc(id).then((url) => {
    if (!url) return false;
    const same = el.getAttribute('data-src') === url;
    if (!same) {
      el.setAttribute('data-src', url);
      el.src = url;
    }
    const go = () => {
      if (restart) {
        try { el.currentTime = 0; } catch (e) {}
      }
      return el.play().then(() => true).catch(() => false);
    };
    if (el.readyState >= 2) return go();
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(go()), 2500);
      const ok = () => { clearTimeout(t); el.removeEventListener('error', bad); resolve(go()); };
      const bad = () => { clearTimeout(t); el.removeEventListener('canplay', ok); resolve(false); };
      el.addEventListener('canplay', ok, { once: true });
      el.addEventListener('error', bad, { once: true });
    });
  });
}

function pickLoop(ctx) {
  if (!ctx || !ctx.enabled) return null;
  const st = ctx.lotStatus || '';
  const status = ctx.status || '';
  const phase = ctx.phase || '';
  const left = Number(ctx.leftMs) || 0;
  const until = Number(ctx.untilStartMs) || 0;
  const tension = (Number(ctx.tensionStartSeconds) > 0 ? Number(ctx.tensionStartSeconds) : 60) * 1000;
  const count = (Number(ctx.countdownStartSeconds) > 0 ? Number(ctx.countdownStartSeconds) : 10) * 1000;
  const antes = (Number(ctx.antesStartSeconds) > 0 ? Number(ctx.antesStartSeconds) : 600) * 1000;
  const live = st === 'live' || st === 'last_seconds' || status === 'live';
  if (st === 'last_seconds' || (live && left > 0 && left <= count)) return 'contagem';
  if (live && left > 0 && left <= tension) return 'tensao';
  if (live) return 'durante';
  if (until > 0 && until <= antes) return 'antes';
  if (st === 'soon' || phase === 'countdown' || phase === 'warmup' || phase === 'interval' || phase === 'discovery' || phase === 'pre') return 'antes';
  return null;
}

function pickShot(ctx) {
  if (!ctx || !ctx.enabled) return '';
  const st = ctx.lotStatus || '';
  const status = ctx.status || '';
  const key = (ctx.lotId || '') + '|' + st + '|' + status;
  if (ctx.justEnded) return 'arrematado|' + key;
  if (ctx.justStarted) {
    if (ctx.finalLot) return 'ultimo|' + key;
    if (ctx.featured) return 'importante|' + key;
    return 'novo|' + key;
  }
  if (ctx.justSoon && ctx.finalLot) return 'ultimo|' + key + '|soon';
  if (ctx.justSoon && ctx.featured) return 'importante|' + key + '|soon';
  return '';
}

export function isAuctionMuted() {
  return muted;
}

export function setAuctionMuted(on) {
  muted = !!on;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
  if (muted) stopAll();
}

export function unlockAuctionAudio() {
  unlocked = true;
}

export function bindAuctionAudioUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const go = () => {
    unlockAuctionAudio();
    window.removeEventListener('pointerdown', go);
    window.removeEventListener('keydown', go);
    window.removeEventListener('touchstart', go);
  };
  window.addEventListener('pointerdown', go);
  window.addEventListener('keydown', go);
  window.addEventListener('touchstart', go);
}

export function applyAuctionAudio(ctx) {
  try {
    bindAuctionAudioUnlock();
    if (previewing) return;
    if (muted) {
      stopAll();
      return;
    }
    if (!ctx || !ctx.enabled) return;
    const shot = pickShot(ctx);
    if (shot && shot !== lastShotKey) {
      lastShotKey = shot;
      const id = shot.split('|')[0];
      stopOthers(id, ctx.settings);
      currentId = id;
      oneshotUntil = TRACKS[id].loop ? 0 : Date.now() + 8000;
      playId(id, ctx.settings, true);
      const el = players[id];
      if (el && !TRACKS[id].loop) {
        el.onended = () => {
          oneshotUntil = 0;
          if (currentId === id) currentId = null;
          applyAuctionAudio({ ...ctx, justStarted: false, justEnded: false, justSoon: false });
        };
      }
      return;
    }
    if (currentId && TRACKS[currentId] && !TRACKS[currentId].loop && Date.now() < oneshotUntil) return;
    const loop = pickLoop(ctx);
    if (!loop) {
      if (currentId && TRACKS[currentId] && TRACKS[currentId].loop) stopAll();
      return;
    }
    if (currentId === loop) {
      const el = players[loop];
      if (el) {
        el.volume = volOf(loop, ctx.settings);
        if (el.paused && unlocked && !muted) playId(loop, ctx.settings, false);
      }
      return;
    }
    stopOthers(loop, ctx.settings);
    currentId = loop;
    playId(loop, ctx.settings, false);
  } catch (e) {}
}

export function previewAuctionTrack(id, settings) {
  unlocked = true;
  previewing = true;
  Object.keys(players).forEach((k) => { if (k !== id) stopId(k); });
  currentId = id;
  oneshotUntil = TRACKS[id] && !TRACKS[id].loop ? Date.now() + 12000 : 0;
  return playId(id, settings, true, true).then((ok) => {
    const el = players[id];
    if (el) {
      el.onended = () => {
        previewing = false;
        oneshotUntil = 0;
        if (currentId === id) currentId = null;
      };
    }
    if (!ok) previewing = false;
    return ok;
  }).catch(() => {
    previewing = false;
    return false;
  });
}

export function stopAuctionAudio() {
  stopAll();
}

function audioPayload(ctx, extra) {
  const settings = (ctx && ctx.settings) || {};
  return {
    enabled: !!(ctx && ctx.enabled),
    lotId: ctx && ctx.lotId,
    lotStatus: ctx && ctx.lotStatus,
    status: ctx && ctx.status,
    phase: ctx && ctx.phase,
    featured: !!(ctx && ctx.featured),
    finalLot: !!(ctx && ctx.finalLot),
    leftMs: ctx && ctx.leftMs,
    untilStartMs: ctx && ctx.untilStartMs,
    tensionStartSeconds: settings.tensionStartSeconds,
    countdownStartSeconds: settings.countdownStartSeconds,
    antesStartSeconds: settings.antesStartSeconds,
    settings,
    justStarted: false,
    justEnded: false,
    justSoon: false,
    ...(extra || {}),
  };
}

export function useAuctionAudio(ctx) {
  const prev = useRef({ lotId: '', lotStatus: '', status: '', armed: false });
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const settings = ctx.settings || {};
  useEffect(() => {
    bindAuctionAudioUnlock();
    const p = prev.current;
    const liveNow = ctx.lotStatus === 'live' || ctx.lotStatus === 'last_seconds' || ctx.status === 'live';
    const liveBefore = p.lotStatus === 'live' || p.lotStatus === 'last_seconds' || p.status === 'live';
    const endedNow = ctx.lotStatus === 'sold' || ctx.lotStatus === 'ended' || ctx.status === 'ended';
    const justStarted = !!(ctx.lotId && liveNow && p.armed && (!liveBefore || (p.lotId && p.lotId !== ctx.lotId)));
    const justEnded = !!(endedNow && liveBefore && p.armed);
    const justSoon = ctx.lotStatus === 'soon' && p.lotStatus !== 'soon' && p.armed;
    applyAuctionAudio(audioPayload(ctx, { justStarted, justEnded, justSoon }));
    prev.current = { lotId: ctx.lotId || '', lotStatus: ctx.lotStatus || '', status: ctx.status || '', armed: true };
    const onUnmute = () => applyAuctionAudio(audioPayload(ctxRef.current));
    window.addEventListener('catira-audio-unmute', onUnmute);
    return () => window.removeEventListener('catira-audio-unmute', onUnmute);
  }, [
    ctx.enabled,
    ctx.lotId,
    ctx.lotStatus,
    ctx.status,
    ctx.phase,
    ctx.featured,
    ctx.finalLot,
    settings.tensionStartSeconds,
    settings.countdownStartSeconds,
    settings.antesStartSeconds,
    settings.audioOverlapEnabled,
    settings.audioOverlapSeconds,
    settings.volumeDurante,
    settings.volumeArrematado,
    settings.volumeContagem,
    settings.volumeTensao,
    settings.volumeUltimoLote,
    settings.volumeLoteImportante,
    settings.volumeNovoLote,
    settings.volumeAntes,
  ]);
  useEffect(() => {
    if (!ctx.enabled) return undefined;
    const t = setInterval(() => applyAuctionAudio(audioPayload(ctxRef.current)), 1000);
    return () => clearInterval(t);
  }, [ctx.enabled]);
  useEffect(() => () => { stopAuctionAudio(); }, []);
}

export function AuctionSoundBtn() {
  const [on, setOn] = useState(!isAuctionMuted());
  return createElement('button', {
    type: 'button',
    className: 'auc-sound' + (on ? ' on' : ''),
    onClick: () => {
      unlockAuctionAudio();
      const next = !on;
      setAuctionMuted(!next);
      setOn(next);
      if (next) window.dispatchEvent(new Event('catira-audio-unmute'));
    },
  }, on ? 'Som ligado' : 'Som desligado');
}

export const AUCTION_AUDIO_TRACKS = Object.keys(TRACKS).map((id) => ({
  id,
  name: TRACKS[id].file,
  loop: TRACKS[id].loop,
  volumeKey: TRACKS[id].volumeKey,
}));
