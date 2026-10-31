import { useEffect, useRef, useState } from 'react';
import { api, money, winnerStatusLabel, auctionStatusLabel, lotLabel } from '../api';
import { isMasterRole } from '../auth';
import { AUCTION_AUDIO_TRACKS, previewAuctionTrack, setAuctionAudioSources, stopAuctionAudio, unlockAuctionAudio } from '../auctionAudio';
import { compressImages, revokePreviews } from '../compressImage';

const LOT_MAX_PHOTOS = 6;
const ROUND_LABEL = { first: 'Primeira rodada', main: 'Rodada principal', final: 'Lote final' };

function moveIds(ids, from, to) {
  if (from === to || from < 0 || to < 0) return ids;
  const next = ids.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function FlagRow({ item, onToggle, disabled }) {
  return (
    <div className={'ff-row' + (item.enabled ? ' on' : '')}>
      <div>
        <strong>{item.name}</strong>
        <p>{item.description}</p>
        {item.updatedAt && (
          <span className="hint">
            {item.enabled ? 'ON' : 'OFF'} ·             {item.updatedByName || 'padrão'} · {new Date(item.updatedAt).toLocaleString('pt-BR')}
          </span>
        )}
      </div>
      <button
        type="button"
        className={'ff-sw' + (item.enabled ? ' on' : '')}
        disabled={disabled}
        onClick={() => onToggle(item.key, !item.enabled)}
      >
        {item.enabled ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

export default function AdminAuctions({ user }) {
  const isMaster = isMasterRole(user && user.role);
  const [sub, setSub] = useState('flags');
  const [cfg, setCfg] = useState(null);
  const [overview, setOverview] = useState(null);
  const [list, setList] = useState([]);
  const [pays, setPays] = useState([]);
  const [pens, setPens] = useState([]);
  const [reps, setReps] = useState([]);
  const [logs, setLogs] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [settings, setSettings] = useState(null);
  const [levelsText, setLevelsText] = useState('');
  const lotPhotoRef = useRef(null);
  const [lotPhotos, setLotPhotos] = useState([]);
  const [lotForm, setLotForm] = useState({ title: '', description: '', startingBid: '50', minIncrement: '', durationMinutes: '', round: 'main' });
  const [dragId, setDragId] = useState('');
  const [editions, setEditions] = useState([]);
  const [editionId, setEditionId] = useState('');
  const [edForm, setEdForm] = useState({ title: '', date: '', number: '' });
  const [audioFiles, setAudioFiles] = useState({});

  const lotPhotosRef = useRef([]);
  lotPhotosRef.current = lotPhotos;

  async function loadCfg() {
    const d = await api('/api/admin/auctions/config');
    setCfg(d);
    setSettings(d.settings);
    setAudioFiles(d.audioFiles || {});
    setAuctionAudioSources(d.audioFiles || {});
    setLevelsText((d.settings.reputationLevels || []).map((l) => l.id + '|' + l.name + '|' + l.minPaid + '|' + l.minRate).join('\n'));
  }

  async function loadEditions() {
    const d = await api('/api/admin/auctions/editions');
    const items = d.items || [];
    setEditions(items);
    setEditionId((cur) => cur || (items.find((e) => e.status !== 'closed') || items[items.length - 1] || {}).id || '');
    return items;
  }

  useEffect(() => {
    loadCfg().catch((e) => setErr(e.message));
    api('/api/admin/auctions/overview').then(setOverview).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (sub === 'prog') loadEditions().catch((e) => setErr(e.message));
    if (sub === 'ads') {
      api('/api/admin/auctions/list').then((d) => setList(d.items || [])).catch((e) => setErr(e.message));
    }
    if (sub === 'pays') api('/api/admin/auctions/payments').then((d) => setPays(d.items || [])).catch((e) => setErr(e.message));
    if (sub === 'pen') api('/api/admin/auctions/penalties').then((d) => setPens(d.items || [])).catch((e) => setErr(e.message));
    if (sub === 'rep') api('/api/admin/auctions/reputations').then((d) => setReps(d.items || [])).catch((e) => setErr(e.message));
    if (sub === 'log' && isMaster) api('/api/admin/auctions/logs').then((d) => setLogs(d.items || [])).catch((e) => setErr(e.message));
  }, [sub, user]);

  useEffect(() => () => revokePreviews(lotPhotosRef.current), []);

  function patchEdition(ed) {
    if (!ed) return;
    setEditions((prev) => {
      const i = prev.findIndex((x) => x.id === ed.id);
      if (i < 0) return prev.concat(ed);
      const next = prev.slice();
      next[i] = { ...next[i], ...ed };
      return next;
    });
  }

  async function toggle(key, value, kind) {
    setErr('');
    setMsg('');
    try {
      const body = kind === 'notif' ? { notifications: { [key]: value } } : { flags: { [key]: value } };
      const d = await api('/api/admin/auctions/config', { method: 'PUT', body: JSON.stringify(body) });
      setCfg(d);
      setMsg(key === 'auction_enabled'
        ? (value ? 'Botão de leilão ligado. O atalho voltou no site.' : 'Botão de leilão desligado. O atalho sumiu do site. As configs continuam salvas.')
        : key + ' agora ' + (value ? 'ON' : 'OFF') + '.');
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    if (!isMaster) return;
    setErr('');
    setMsg('');
    try {
      const reputationLevels = levelsText.split('\n').map((line) => line.trim()).filter(Boolean).map((line, i) => {
        const [id, name, minPaid, minRate] = line.split('|');
        return { id: id || ('nivel-' + i), name: name || id, minPaid: Number(minPaid) || 0, minRate: Number(minRate) || 0 };
      });
      const d = await api('/api/admin/auctions/config', {
        method: 'PUT',
        body: JSON.stringify({ settings: { ...settings, reputationLevels } }),
      });
      setCfg(d);
      setSettings(d.settings);
      setMsg('Configurações salvas.');
    } catch (ex) {
      setErr(ex.message);
    }
  }

  function setS(k, v) { setSettings({ ...settings, [k]: v }); }

  const groups = {
    geral: 'Geral',
    cronometro: 'Cronômetro',
    domingo: 'Programação',
    gamificacao: 'Gamificação',
    reputacao: 'Reputação',
    penalidades: 'Penalidades',
    desbloqueio: 'Desbloqueio',
    antifraude: 'Antifraude',
  };

  const masterFlag = cfg && (cfg.flags || []).find((f) => f.key === 'auction_enabled');
  const auctionOn = !!(masterFlag && masterFlag.enabled);

  return (
    <>
      <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>CATIRA LEILÃO</h2>
      <p className="lead">Ligue ou desligue o botão de leilão sem perder as configs. Com OFF, o atalho some do site; o restante fica guardado para ligar depois.</p>
      {cfg && masterFlag && (
        <label className={'fee-toggle' + (auctionOn ? ' on' : '')} style={{ marginBottom: 14 }}>
          <span className="fee-toggle-info">
            <strong>Botão de leilão</strong>
            <small>
              {auctionOn
                ? 'Visível na home, no perfil e nos comandos de voz.'
                : 'Escondido no site. Regras, áudio e programação continuam salvos.'}
            </small>
            {masterFlag.updatedAt && (
              <span className="hint">
                {auctionOn ? 'ON' : 'OFF'} · {masterFlag.updatedByName || 'padrão'} · {new Date(masterFlag.updatedAt).toLocaleString('pt-BR')}
              </span>
            )}
          </span>
          <input
            type="checkbox"
            checked={auctionOn}
            disabled={!isMaster}
            onChange={(e) => toggle('auction_enabled', e.target.checked, 'flag')}
            aria-label="Ligar ou desligar o botão de leilão"
          />
        </label>
      )}
      {err && <div className="error">{err}</div>}
      {msg && <div className="okbox">{msg}</div>}
      {overview && (
        <div className="admin-grid" style={{ marginBottom: 12 }}>
          <div className="stat"><strong>{overview.live}</strong><span>Ao vivo</span></div>
          <div className="stat"><strong>{overview.bids}</strong><span>Lances</span></div>
          <div className="stat"><strong>{overview.pendingPayment}</strong><span>A pagar</span></div>
          <div className="stat"><strong>{overview.notPaid}</strong><span>Não pagos</span></div>
        </div>
      )}
      <div className="chips">
        {[['flags', 'Feature flags'], ['notif', 'Notificações'], ['cfg', 'Regras'], ['prog', 'Programação'], ['audio', 'Áudio do Leilão'], ['ads', 'Leilões'], ['pays', 'Arremates'], ['pen', 'Penalidades'], ['rep', 'Reputação'], ['log', 'Auditoria']].map(([k, l]) => (
          <button key={k} className={'chip' + (sub === k ? ' on' : '')} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>

      {sub === 'flags' && cfg && Object.entries(groups).map(([g, label]) => (
        <div key={g} style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>{label}</h3>
          {cfg.flags.filter((f) => f.group === g && f.key !== 'auction_enabled').map((f) => (
            <FlagRow key={f.key} item={f} disabled={!isMaster} onToggle={(k, v) => toggle(k, v, 'flag')} />
          ))}
        </div>
      ))}

      {sub === 'notif' && cfg && cfg.notifications.map((f) => (
        <FlagRow key={f.key} item={f} disabled={!isMaster} onToggle={(k, v) => toggle(k, v, 'notif')} />
      ))}

      {sub === 'cfg' && settings && (
        <form className="filters" onSubmit={saveSettings}>
          {!isMaster && <p className="hint">Só o master altera as regras.</p>}
          <h3 style={{ fontSize: 14 }}>Geral</h3>
          <div className="field"><label>Lance inicial mínimo (R$)</label><input type="number" step="0.01" value={settings.startingBidMin} onChange={(e) => setS('startingBidMin', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Incremento mínimo padrão (R$)</label><input type="number" step="0.01" value={settings.minIncrement} onChange={(e) => setS('minIncrement', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Duração mínima (horas)</label><input type="number" value={settings.minDurationHours} onChange={(e) => setS('minDurationHours', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Duração máxima (horas)</label><input type="number" value={settings.maxDurationHours} onChange={(e) => setS('maxDurationHours', e.target.value)} disabled={!isMaster} /></div>
          <div className="field">
            <label>Nomes no histórico</label>
            <select value={settings.displayNames} onChange={(e) => setS('displayNames', e.target.value)} disabled={!isMaster}>
              <option value="abbrev">Nome abreviado</option>
              <option value="full">Nome completo</option>
              <option value="id">Só identificador</option>
            </select>
          </div>
          <h3 style={{ fontSize: 14 }}>Cronômetro</h3>
          <div className="field"><label>Segundos de extensão</label><input type="number" value={settings.extensionSeconds} onChange={(e) => setS('extensionSeconds', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Janela de extensão (segundos)</label><input type="number" value={settings.extensionTriggerSeconds} onChange={(e) => setS('extensionTriggerSeconds', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Máximo de extensões (0 = ilimitado)</label><input type="number" value={settings.maxExtensions} onChange={(e) => setS('maxExtensions', e.target.value)} disabled={!isMaster} /></div>
          <h3 style={{ fontSize: 14 }}>Pagamento</h3>
          <div className="field"><label>Prazo para pagar (horas)</label><input type="number" value={settings.paymentDeadlineHours} onChange={(e) => setS('paymentDeadlineHours', e.target.value)} disabled={!isMaster} /></div>
          <h3 style={{ fontSize: 14 }}>Penalidades</h3>
          <div className="field"><label>1ª ocorrência (dias)</label><input type="number" value={settings.penalty1Days} onChange={(e) => setS('penalty1Days', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>2ª ocorrência (dias)</label><input type="number" value={settings.penalty2Days} onChange={(e) => setS('penalty2Days', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>3ª ocorrência (dias)</label><input type="number" value={settings.penalty3Days} onChange={(e) => setS('penalty3Days', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>4ª ocorrência (dias)</label><input type="number" value={settings.penalty4Days} onChange={(e) => setS('penalty4Days', e.target.value)} disabled={!isMaster} /></div>
          <div className="field">
            <label>Bloqueio permanente após a 4ª</label>
            <div className="cond">
              <label><input type="radio" name="pp" checked={!settings.permanentPenaltyEnabled} onChange={() => setS('permanentPenaltyEnabled', false)} disabled={!isMaster} /><span>Não</span></label>
              <label><input type="radio" name="pp" checked={!!settings.permanentPenaltyEnabled} onChange={() => setS('permanentPenaltyEnabled', true)} disabled={!isMaster} /><span>Sim</span></label>
            </div>
          </div>
          <h3 style={{ fontSize: 14 }}>Pontos</h3>
          <div className="field"><label>Pontos ao pagar</label><input type="number" value={settings.pointsPaid} onChange={(e) => setS('pointsPaid', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Pontos ao não pagar</label><input type="number" value={settings.pointsNotPaid} onChange={(e) => setS('pointsNotPaid', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Bônus no prazo</label><input type="number" value={settings.pointsOnTimeBonus} onChange={(e) => setS('pointsOnTimeBonus', e.target.value)} disabled={!isMaster} /></div>
          <h3 style={{ fontSize: 14 }}>Níveis (id|nome|arremates|% conclusão)</h3>
          <div className="field"><textarea value={levelsText} onChange={(e) => setLevelsText(e.target.value)} rows={6} disabled={!isMaster} /></div>
          <h3 style={{ fontSize: 14 }}>Ranking</h3>
          <div className="field">
            <label>Métrica ativa</label>
            <select value={settings.rankingMetric} onChange={(e) => setS('rankingMetric', e.target.value)} disabled={!isMaster}>
              <option value="points">Pontos</option>
              <option value="paid">Arremates concluídos</option>
              <option value="rate">Percentual de conclusão</option>
              <option value="achievements">Conquistas</option>
            </select>
          </div>
          <h3 style={{ fontSize: 14 }}>Desbloqueio antecipado</h3>
          <div className="field"><label>Taxa administrativa (R$)</label><input type="number" step="0.01" value={settings.earlyUnlockFee} onChange={(e) => setS('earlyUnlockFee', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Intervalo mínimo (dias)</label><input type="number" value={settings.earlyUnlockCooldown} onChange={(e) => setS('earlyUnlockCooldown', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Usos máximos (0 = ilimitado)</label><input type="number" value={settings.earlyUnlockMaxUses} onChange={(e) => setS('earlyUnlockMaxUses', e.target.value)} disabled={!isMaster} /></div>
          <h3 style={{ fontSize: 14 }}>Leilão programado</h3>
          <p className="hint">O administrador escolhe o dia e o horário. Não fica preso ao domingo.</p>
          <div className="field">
            <label>Dia da semana</label>
            <select value={settings.sundayEventWeekday ?? 0} onChange={(e) => setS('sundayEventWeekday', Number(e.target.value))} disabled={!isMaster}>
              <option value={0}>Domingo</option>
              <option value={1}>Segunda</option>
              <option value={2}>Terça</option>
              <option value={3}>Quarta</option>
              <option value={4}>Quinta</option>
              <option value={5}>Sexta</option>
              <option value={6}>Sábado</option>
            </select>
          </div>
          <div className="field"><label>Abertura</label><input type="time" value={settings.sundayOpenTime || '09:00'} onChange={(e) => setS('sundayOpenTime', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Primeira rodada (início)</label><input type="time" value={settings.sundayFirstRoundStart || '10:00'} onChange={(e) => setS('sundayFirstRoundStart', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Primeira rodada (fim)</label><input type="time" value={settings.sundayFirstRoundEnd || '11:00'} onChange={(e) => setS('sundayFirstRoundEnd', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Aquecimento (início)</label><input type="time" value={settings.sundayWarmupStart || '14:00'} onChange={(e) => setS('sundayWarmupStart', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Aquecimento (fim)</label><input type="time" value={settings.sundayWarmupEnd || '19:30'} onChange={(e) => setS('sundayWarmupEnd', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Rodada principal (início)</label><input type="time" value={settings.sundayMainStart || '20:00'} onChange={(e) => setS('sundayMainStart', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Rodada principal (fim)</label><input type="time" value={settings.sundayMainEnd || '21:30'} onChange={(e) => setS('sundayMainEnd', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Horário do lote final</label><input type="time" value={settings.sundayFinalLotTime || '21:30'} onChange={(e) => setS('sundayFinalLotTime', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Duração padrão (min)</label><input type="number" value={settings.sundayDefaultDurationMinutes} onChange={(e) => setS('sundayDefaultDurationMinutes', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Intervalo entre lotes (min)</label><input type="number" value={settings.sundayLotIntervalMinutes} onChange={(e) => setS('sundayLotIntervalMinutes', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Itens simples (min)</label><input type="number" value={settings.sundaySimpleDurationMinutes} onChange={(e) => setS('sundaySimpleDurationMinutes', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Itens médios (min)</label><input type="number" value={settings.sundayMediumDurationMinutes} onChange={(e) => setS('sundayMediumDurationMinutes', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Itens importantes (min)</label><input type="number" value={settings.sundayImportantDurationMinutes} onChange={(e) => setS('sundayImportantDurationMinutes', e.target.value)} disabled={!isMaster} /></div>
          <div className="field"><label>Lote especial (min)</label><input type="number" value={settings.sundaySpecialDurationMinutes} onChange={(e) => setS('sundaySpecialDurationMinutes', e.target.value)} disabled={!isMaster} /></div>
          {isMaster && <button className="btn btn-primary">Salvar regras</button>}
        </form>
      )}

      {sub === 'audio' && settings && (
        <form className="filters" onSubmit={saveSettings}>
          {!isMaster && <p className="hint">Só o master altera o áudio.</p>}
          <p className="lead">Envie cada faixa aqui. O som acompanha o estado do lote e não muda lance, prazo nem pagamento.</p>
          <h3 style={{ fontSize: 14 }}>Quando cada som entra</h3>
          <p className="hint">Informe quantos minutos (ou segundos) faltam para o som começar. Não altera lance, prazo nem pagamento.</p>
          <div className="field">
            <label>Antes de começar entra faltando (minutos)</label>
            <input
              type="number"
              min="0.1"
              step="0.5"
              value={Math.round(((Number(settings.antesStartSeconds) > 0 ? Number(settings.antesStartSeconds) : 600) / 60) * 10) / 10}
              onChange={(e) => setS('antesStartSeconds', Math.max(1, Math.round(Number(e.target.value) * 60)))}
              disabled={!isMaster}
            />
          </div>
          <div className="field">
            <label>Tensão entra faltando (minutos)</label>
            <input
              type="number"
              min="0.1"
              step="0.5"
              value={Math.round(((Number(settings.tensionStartSeconds) > 0 ? Number(settings.tensionStartSeconds) : 60) / 60) * 10) / 10}
              onChange={(e) => setS('tensionStartSeconds', Math.max(1, Math.round(Number(e.target.value) * 60)))}
              disabled={!isMaster}
            />
          </div>
          <div className="field">
            <label>Contagem entra faltando (segundos)</label>
            <input type="number" min="1" value={settings.countdownStartSeconds || 10} onChange={(e) => setS('countdownStartSeconds', e.target.value)} disabled={!isMaster} />
            <div className="hint">A contagem costuma ser curta. Use segundos (ex.: 10).</div>
          </div>
          <h3 style={{ fontSize: 14 }}>Sobreposição</h3>
          <label className={'fee-toggle' + (settings.audioOverlapEnabled ? ' on' : '')} style={{ marginBottom: 10 }}>
            <span className="fee-toggle-info">
              <strong>Um áudio pode sobrepor o outro</strong>
              <small>{settings.audioOverlapEnabled ? 'O novo som começa enquanto o anterior some aos poucos.' : 'O som anterior para na hora e o novo começa sozinho.'}</small>
            </span>
            <input
              type="checkbox"
              checked={!!settings.audioOverlapEnabled}
              disabled={!isMaster}
              onChange={(e) => setS('audioOverlapEnabled', e.target.checked)}
              aria-label="Ligar ou desligar a sobreposição de áudio"
            />
          </label>
          <div className="field">
            <label>Quanto tempo um áudio cobre o outro (segundos)</label>
            <input
              type="number"
              min="0"
              max="30"
              step="1"
              value={settings.audioOverlapSeconds ?? 4}
              onChange={(e) => setS('audioOverlapSeconds', e.target.value)}
              disabled={!isMaster || !settings.audioOverlapEnabled}
            />
          </div>
          {AUCTION_AUDIO_TRACKS.map((t) => (
            <div key={t.id} className="field">
              <label>{t.name} {t.loop ? '(loop)' : ''} — volume {Math.round((Number(settings[t.volumeKey]) || 0) * 100)}%</label>
              <input type="range" min="0" max="1" step="0.05" value={settings[t.volumeKey] ?? 0.5} onChange={(e) => setS(t.volumeKey, e.target.value)} disabled={!isMaster} />
              {isMaster && (
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a"
                  onChange={async (e) => {
                    const file = e.target.files && e.target.files[0];
                    e.target.value = '';
                    if (!file) return;
                    setErr('');
                    setMsg('');
                    try {
                      const fd = new FormData();
                      fd.append('file', file);
                      const d = await api('/api/admin/auctions/audio/' + t.id, { method: 'POST', body: fd });
                      setAudioFiles(d.files || {});
                      setAuctionAudioSources(d.files || {});
                      setMsg(t.name + ' enviado.');
                    } catch (ex) {
                      setErr(ex.message);
                    }
                  }}
                />
              )}
              <div className="hint">{audioFiles[t.id] ? 'Arquivo no ar. Pode testar.' : 'Ainda sem arquivo nesta faixa.'}</div>
              <button type="button" className="btn btn-ghost" onClick={async () => {
                setErr('');
                setMsg('');
                unlockAuctionAudio();
                if (audioFiles[t.id]) setAuctionAudioSources({ [t.id]: audioFiles[t.id] });
                const ok = await previewAuctionTrack(t.id, settings);
                if (ok) setMsg('Tocando ' + t.name + '.');
                else setErr('Não tocou ' + t.name + '. Envie o arquivo ou confira o volume do aparelho.');
              }}>Testar</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={() => stopAuctionAudio()}>Parar teste</button>
          {isMaster && <button className="btn btn-primary">Salvar volumes</button>}
        </form>
      )}

      {sub === 'prog' && (
        <div>
          <h3 style={{ fontSize: 15, margin: '12px 0 8px' }}>Edições</h3>
          <p className="hint">Crie a edição (número e data). Depois entre nela e adicione os lotes. O público só vê a edição da vez; a próxima abre quando a anterior encerrar.</p>
          {isMaster && (
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              setErr('');
              setMsg('');
              try {
                const ed = await api('/api/admin/auctions/editions', {
                  method: 'POST',
                  body: JSON.stringify({
                    title: edForm.title,
                    date: edForm.date,
                    number: edForm.number ? Number(edForm.number) : undefined,
                  }),
                });
                patchEdition(ed);
                setEditionId(ed.id);
                setEdForm({ title: '', date: '', number: '' });
                setMsg('Edição ' + ed.number + ' criada. Agora inclua os lotes.');
              } catch (ex) {
                setErr(ex.message);
              }
            }}>
              <div className="field"><label>Número</label><input type="number" min="1" value={edForm.number} onChange={(e) => setEdForm({ ...edForm, number: e.target.value })} placeholder="Automático" /></div>
              <div className="field"><label>Nome</label><input value={edForm.title} onChange={(e) => setEdForm({ ...edForm, title: e.target.value })} placeholder="CATIRA LEILÃO #25" /></div>
              <div className="field"><label>Data</label><input type="date" value={edForm.date} onChange={(e) => setEdForm({ ...edForm, date: e.target.value })} required /></div>
              <button className="btn btn-primary">Criar edição</button>
            </form>
          )}
          <div className="chips" style={{ margin: '8px 0 12px' }}>
            {editions.map((ed) => (
              <button key={ed.id} type="button" className={'chip' + (editionId === ed.id ? ' on' : '')} onClick={() => setEditionId(ed.id)}>
                #{ed.number} · {ed.date} · {ed.status === 'closed' ? 'encerrada' : ed.status === 'live' ? 'ao vivo' : (ed.lotCount + ' lotes')}
              </button>
            ))}
          </div>
          {!editions.length && <p className="hint">Nenhuma edição ainda. Crie a primeira.</p>}
          {editionId && (
            <>
              <h3 style={{ fontSize: 15, margin: '12px 0 8px' }}>Lotes da edição {(editions.find((e) => e.id === editionId) || {}).number || ''}</h3>
              {isMaster && (
                <form className="filters" onSubmit={async (e) => {
                  e.preventDefault();
                  setErr('');
                  setMsg('');
                  try {
                    const fd = new FormData();
                    fd.append('editionId', editionId);
                    fd.append('title', lotForm.title);
                    fd.append('description', lotForm.description || lotForm.title);
                    fd.append('startingBid', String(lotForm.startingBid).replace(',', '.'));
                    fd.append('minIncrement', String((lotForm.minIncrement || (settings && settings.minIncrement) || 1)).replace(',', '.'));
                    fd.append('durationMinutes', String(lotForm.durationMinutes || (settings && settings.sundayDefaultDurationMinutes) || 8));
                    fd.append('round', lotForm.round || 'main');
                    fd.append('finalLot', lotForm.round === 'final' ? 'true' : 'false');
                    lotPhotos.forEach((p) => fd.append('photos', p.file));
                    const created = await api('/api/admin/auctions/sunday-lot', { method: 'POST', body: fd });
                    patchEdition(created.edition);
                    setMsg('Lote incluído na edição.');
                    setLotForm({ title: '', description: '', startingBid: '50', minIncrement: '', durationMinutes: '', round: 'main' });
                    revokePreviews(lotPhotos);
                    setLotPhotos([]);
                    if (lotPhotoRef.current) lotPhotoRef.current.value = '';
                  } catch (ex) {
                    setErr(ex.message);
                  }
                }}>
                  <div className="field">
                    <label>Fotos</label>
                    <input
                      ref={lotPhotoRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={async (e) => {
                        const incoming = [...(e.target.files || [])];
                        e.target.value = '';
                        if (!incoming.length) return;
                        const compressed = await compressImages(incoming, LOT_MAX_PHOTOS - lotPhotos.length);
                        setLotPhotos((prev) => [...prev, ...compressed].slice(0, LOT_MAX_PHOTOS));
                      }}
                    />
                    <div className="hint">Até 6 fotos. {lotPhotos.length}/{LOT_MAX_PHOTOS}</div>
                    {lotPhotos.length > 0 && (
                      <div className="photo-grid">
                        {lotPhotos.map((p, i) => (
                          <div key={p.preview} className={'photo-item' + (i === 0 ? ' is-main' : '')}>
                            <img src={p.preview} alt="" />
                            <button type="button" className="photo-remove" onClick={() => setLotPhotos((prev) => {
                              const next = prev.filter((_, x) => x !== i);
                              if (prev[i] && prev[i].preview) URL.revokeObjectURL(prev[i].preview);
                              return next;
                            })}>Remover</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="field"><label>Produto</label><input value={lotForm.title} onChange={(e) => setLotForm({ ...lotForm, title: e.target.value })} required /></div>
                  <div className="field"><label>Descrição</label><textarea rows={4} value={lotForm.description} onChange={(e) => setLotForm({ ...lotForm, description: e.target.value })} placeholder="Detalhes do produto, estado, medidas, observações." /></div>
                  <div className="field"><label>Lance inicial</label><input value={lotForm.startingBid} onChange={(e) => setLotForm({ ...lotForm, startingBid: e.target.value })} /></div>
                  <div className="field"><label>Incremento (R$)</label><input value={lotForm.minIncrement} onChange={(e) => setLotForm({ ...lotForm, minIncrement: e.target.value })} placeholder={String((settings && settings.minIncrement) || 1)} /></div>
                  <div className="field"><label>Duração (min)</label><input type="number" min="1" value={lotForm.durationMinutes} onChange={(e) => setLotForm({ ...lotForm, durationMinutes: e.target.value })} placeholder={String((settings && settings.sundayDefaultDurationMinutes) || 8)} /></div>
                  <div className="field">
                    <label>Rodada</label>
                    <select value={lotForm.round} onChange={(e) => setLotForm({ ...lotForm, round: e.target.value })}>
                      <option value="first">Primeira rodada</option>
                      <option value="main">Rodada principal</option>
                      <option value="final">Lote final</option>
                    </select>
                  </div>
                  <button className="btn btn-primary">Criar lote</button>
                </form>
              )}
              {((editions.find((e) => e.id === editionId) || {}).items || []).map((a, i, arr) => (
                <div
                  key={a.id}
                  className={'list-item lot-drag' + (dragId === a.id ? ' dragging' : '')}
                  style={{ flexDirection: 'column' }}
                  draggable={isMaster}
                  onDragStart={() => setDragId(a.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async () => {
                    if (!dragId || dragId === a.id) return setDragId('');
                    const ids = moveIds(arr.map((x) => x.id), arr.findIndex((x) => x.id === dragId), i);
                    setDragId('');
                    const prev = editions;
                    patchEdition({ id: editionId, items: ids.map((id, n) => ({ ...(arr.find((x) => x.id === id) || {}), programOrder: n + 1 })) });
                    try {
                      const ed = await api('/api/admin/auctions/editions/' + editionId + '/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
                      patchEdition(ed);
                    } catch (ex) {
                      setEditions(prev);
                      setErr(ex.message);
                    }
                  }}
                  onDragEnd={() => setDragId('')}
                >
                  <strong>{i + 1}. {a.title}</strong>
                  <div className="hint">
                    {isMaster ? 'Arraste para reordenar · ' : ''}{ROUND_LABEL[a.round] || 'Rodada principal'} · {lotLabel(a)} · {a.durationMinutes || Math.round((a.durationHours || 0) * 60)} min · incremento R$ {Number(a.minIncrement || 0).toFixed(2)} · {(a.images && a.images.length) || 0} foto{(a.images && a.images.length) === 1 ? '' : 's'}
                    {a.featured ? ' · DESTAQUE' : ''}
                  </div>
                  {isMaster && a.status === 'scheduled' && (
                    <div className="row-btns">
                      <button className="btn btn-ghost" onClick={async () => {
                        const mins = window.prompt('Duração em minutos:', String(a.durationMinutes || 8));
                        if (!mins) return;
                        await api('/api/admin/auctions/' + a.id + '/program', { method: 'POST', body: JSON.stringify({ durationMinutes: Number(mins) }) });
                        loadEditions().catch(() => {});
                      }}>Duração</button>
                      <button className="btn btn-ghost" onClick={async () => {
                        await api('/api/admin/auctions/' + a.id + '/program', { method: 'POST', body: JSON.stringify({ featured: !a.featured }) });
                        loadEditions().catch(() => {});
                      }}>{a.featured ? 'Tirar destaque' : 'Destacar'}</button>
                      <select
                        value={a.round || (a.finalLot ? 'final' : 'main')}
                        onChange={async (e) => {
                          const round = e.target.value;
                          await api('/api/admin/auctions/' + a.id + '/program', { method: 'POST', body: JSON.stringify({ round, finalLot: round === 'final' }) });
                          loadEditions().catch(() => {});
                        }}
                      >
                        <option value="first">Primeira rodada</option>
                        <option value="main">Rodada principal</option>
                        <option value="final">Lote final</option>
                      </select>
                    </div>
                  )}
                </div>
              ))}
              {!((editions.find((e) => e.id === editionId) || {}).items || []).length && <p className="hint">Nenhum lote nesta edição.</p>}
            </>
          )}
        </div>
      )}

      {sub === 'ads' && list.map((a) => (
        <div key={a.id} className="list-item" style={{ flexDirection: 'column' }}>
          <strong>{a.title}</strong>
          <div className="hint">{auctionStatusLabel[a.derived] || a.status} · {money(a.currentBid)} · {a.bidCount} lances · {a.sellerName}</div>
          {a.status !== 'cancelled' && a.status !== 'ended' && (
            <button className="btn btn-ghost" onClick={async () => {
              const reason = window.prompt('Motivo do cancelamento:');
              if (!reason) return;
              await api('/api/admin/auctions/' + a.id + '/cancel', { method: 'POST', body: JSON.stringify({ reason }) });
              const d = await api('/api/admin/auctions/list');
              setList(d.items || []);
            }}>Cancelar</button>
          )}
        </div>
      ))}

      {sub === 'pays' && pays.map((p) => (
        <div key={p.id} className="list-item" style={{ flexDirection: 'column' }}>
          <strong>{p.auctionTitle || p.kind}</strong>
          <div className="hint">{p.winnerName} · {money(p.amount)} · {winnerStatusLabel[p.status] || p.status}</div>
          {p.status === 'PENDING_PAYMENT' && (
            <button className="btn btn-primary" onClick={async () => {
              await api('/api/admin/auctions/payments/' + p.id + '/confirm', { method: 'POST' });
              const d = await api('/api/admin/auctions/payments');
              setPays(d.items || []);
              setMsg('Pagamento confirmado.');
            }}>Confirmar pagamento</button>
          )}
        </div>
      ))}

      {sub === 'pen' && pens.map((p) => (
        <div key={p.id} className="list-item" style={{ flexDirection: 'column' }}>
          <strong>{p.userName}</strong>
          <div className="hint">{p.reason} · {p.occurrence}ª · {p.applied ? (p.permanent ? 'permanente' : (p.periodDays + ' dias')) : 'só registro'}</div>
          {isMaster && (
            <button className="btn btn-ghost" onClick={async () => {
              await api('/api/admin/auctions/penalties/' + p.id + '/lift', { method: 'POST' });
              setMsg('Penalidade levantada.');
            }}>Levantar bloqueio</button>
          )}
        </div>
      ))}

      {sub === 'rep' && reps.map((r) => (
        <div key={r.userId} className="list-item" style={{ flexDirection: 'column' }}>
          <strong>{r.name}</strong>
          <div className="hint">{r.totalWon} arremates · {r.totalPaid} pagos · {r.totalNotPaid} não pagos · {r.completionRate}% · {r.points} pts · {r.antifraudStatus}</div>
          <div className="row-btns">
            {['NORMAL', 'REVIEW', 'SUSPICIOUS', 'BLOCKED'].map((st) => (
              <button key={st} className="btn btn-ghost" onClick={async () => {
                await api('/api/admin/auctions/reputations/' + r.userId + '/antifraud', { method: 'POST', body: JSON.stringify({ status: st }) });
                const d = await api('/api/admin/auctions/reputations');
                setReps(d.items || []);
              }}>{st}</button>
            ))}
          </div>
        </div>
      ))}

      {sub === 'log' && (isMaster ? logs.map((l) => (
        <div key={l.id} className="list-item" style={{ flexDirection: 'column' }}>
          <strong>{l.adminName}</strong>
          <div className="hint">{new Date(l.at).toLocaleString('pt-BR')} · {l.key}</div>
          <div className="hint">{String(l.oldValue)} para {String(l.newValue)}</div>
        </div>
      )) : <p className="hint">Só o master vê a auditoria.</p>)}
    </>
  );
}
