import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { useTheme } from '../theme';
import { BrandLogo, NeedAuth, Top } from '../components';
import { useConfig } from '../config';

const WEEKDAYS = [
  { v: 0, l: 'Domingo' },
  { v: 1, l: 'Segunda' },
  { v: 2, l: 'Terça' },
  { v: 3, l: 'Quarta' },
  { v: 4, l: 'Quinta' },
  { v: 5, l: 'Sexta' },
  { v: 6, l: 'Sábado' },
];

function AdminAuctionSchedule() {
  const [sched, setSched] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api('/api/admin/auctions/config').then((d) => setSched(d.settings || {})).catch(() => {});
  }, []);

  function setF(k, v) { setSched({ ...sched, [k]: v }); }

  async function save(e) {
    e.preventDefault();
    setErr('');
    setMsg('');
    try {
      const d = await api('/api/admin/auctions/schedule', {
        method: 'PUT',
        body: JSON.stringify({
          sundayEventWeekday: Number(sched.sundayEventWeekday),
          sundayOpenTime: sched.sundayOpenTime,
          sundayFirstRoundStart: sched.sundayFirstRoundStart,
          sundayFirstRoundEnd: sched.sundayFirstRoundEnd,
          sundayWarmupStart: sched.sundayWarmupStart,
          sundayWarmupEnd: sched.sundayWarmupEnd,
          sundayMainStart: sched.sundayMainStart,
          sundayMainEnd: sched.sundayMainEnd,
          sundayFinalLotTime: sched.sundayFinalLotTime,
        }),
      });
      setSched(d.settings);
      setMsg('Dia e horário do leilão salvos.');
    } catch (ex) {
      setErr(ex.message);
    }
  }

  if (!sched) return null;
  return (
    <div className="admin-sched">
      <button type="button" onClick={() => setOpen(!open)}>{open ? 'Fechar programação do leilão' : 'Dia e horário do leilão'}</button>
      {open && (
        <form onSubmit={save} style={{ marginTop: 12 }}>
          <p className="lead">O leilão acontece no dia e no horário que você definir. Não precisa ser domingo.</p>
          {err && <div className="error">{err}</div>}
          {msg && <div className="okbox">{msg}</div>}
          <div className="field">
            <label>Dia</label>
            <select value={sched.sundayEventWeekday ?? 0} onChange={(e) => setF('sundayEventWeekday', Number(e.target.value))}>
              {WEEKDAYS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
            </select>
          </div>
          <div className="field"><label>Abertura</label><input type="time" value={sched.sundayOpenTime || '09:00'} onChange={(e) => setF('sundayOpenTime', e.target.value)} /></div>
          <div className="field"><label>Primeira rodada (início)</label><input type="time" value={sched.sundayFirstRoundStart || '10:00'} onChange={(e) => setF('sundayFirstRoundStart', e.target.value)} /></div>
          <div className="field"><label>Primeira rodada (fim)</label><input type="time" value={sched.sundayFirstRoundEnd || '11:00'} onChange={(e) => setF('sundayFirstRoundEnd', e.target.value)} /></div>
          <div className="field"><label>Aquecimento (início)</label><input type="time" value={sched.sundayWarmupStart || '14:00'} onChange={(e) => setF('sundayWarmupStart', e.target.value)} /></div>
          <div className="field"><label>Aquecimento (fim)</label><input type="time" value={sched.sundayWarmupEnd || '19:30'} onChange={(e) => setF('sundayWarmupEnd', e.target.value)} /></div>
          <div className="field"><label>Rodada principal (início)</label><input type="time" value={sched.sundayMainStart || '20:00'} onChange={(e) => setF('sundayMainStart', e.target.value)} /></div>
          <div className="field"><label>Rodada principal (fim)</label><input type="time" value={sched.sundayMainEnd || '21:30'} onChange={(e) => setF('sundayMainEnd', e.target.value)} /></div>
          <div className="field"><label>Lote final</label><input type="time" value={sched.sundayFinalLotTime || '21:30'} onChange={(e) => setF('sundayFinalLotTime', e.target.value)} /></div>
          <button className="btn btn-primary">Salvar dia e horário</button>
        </form>
      )}
    </div>
  );
}

export default function Profile() {
  const { user, logout, setUser } = useAuth();
  const { auctionEnabled } = useConfig();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', city: '' });
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!user) return;
    setForm({ name: user.name, phone: user.phone, city: user.city });
    api('/api/users/' + user.id).then(setStats).catch(() => {});
  }, [user]);

  if (!user) return <NeedAuth next="/perfil" />;

  async function save(e) {
    e.preventDefault();
    const d = await api('/api/auth/me', { method: 'PUT', body: JSON.stringify(form) });
    setUser(d.user);
    setEdit(false);
  }

  return (
    <>
      <Top />
      <div className="page">
        <div className="seller">
          <div className="avatar" style={{ background: user.avatarColor }}>{user.name.slice(0, 1)}</div>
          <div>
            <strong>{user.name}</strong>
            <div className="verified">{(user.phoneVerified || user.emailVerified) ? 'Usuário verificado' : user.city}</div>
            <div className="hint">No CATIRA desde {new Date(user.createdAt).getFullYear()}</div>
            <div className="hint">
              {user.ratingCount ? `${user.ratingAvg} (${user.ratingCount} avaliações)` : 'Ainda sem avaliações'}
              {stats?.user?.rank ? ` · #${stats.user.rank} no ranking` : ''}
            </div>
            <div className="hint">
              {stats?.user?.listingsCount || stats?.user?.published || 0} anúncios
              {stats?.user?.deals ? ` · ${stats.user.deals} negociações concluídas` : ''}
            </div>

          </div>
        </div>
        {user && !user.emailVerified && !isAdminRole(user.role) && (
          <div className="verify-banner">
            <div>
              <strong>Confirme seu e-mail</strong>
              <p>Sem confirmação você não consegue publicar anúncios.</p>
            </div>
            <Link to="/confirmar-email" className="btn btn-primary">Confirmar</Link>
          </div>
        )}
        {edit && (
          <form onSubmit={save} style={{ marginBottom: 16 }}>
            <div className="field"><label>Nome</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Telefone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label>Cidade</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <button className="btn btn-primary">Salvar</button>
          </form>
        )}
        {auctionEnabled && isAdminRole(user.role) && <AdminAuctionSchedule />}
        <div className="menu">
          <button onClick={() => setEdit(!edit)}>Editar perfil</button>
          <Link to="/meus-anuncios">Meus anúncios</Link>
          <Link to="/em-acao">Catira em Ação</Link>
          <Link to="/favoritos">Favoritos</Link>
          <Link to="/propostas">Minhas propostas</Link>
          <Link to="/conversas">Conversas</Link>
          {!user.emailVerified && !isAdminRole(user.role) && <Link to="/confirmar-email">Confirmar e-mail</Link>}
          {!isAdminRole(user.role) && <Link to="/suporte">Falar com o suporte</Link>}
          <Link to="/alertas">Meus alertas</Link>
          {auctionEnabled && <Link to="/leiloes">CATIRA LEILÃO</Link>}
          {auctionEnabled && <Link to="/meus-leiloes">Meus leilões</Link>}
          {auctionEnabled && <Link to="/meus-arremates">Meus arremates</Link>}
          {auctionEnabled && <Link to="/avisos-leilao">Avisos de leilão</Link>}
          {user.dealerStatus === 'approved' || isAdminRole(user.role) ? (
            <Link to="/central-repasse">Central de Repasse</Link>
          ) : (
            <Link to="/catireiro">{user.dealerStatus === 'pending' ? 'Solicitação de catireiro' : 'Quero ser catireiro'}</Link>
          )}
          <Link to="/propostas-rapidas">Propostas rápidas</Link>
          <Link to="/oportunidades-catira">Catira — Oportunidades Próprias</Link>
          {user.dealerFounder && <div style={{ padding: 14 }}>Selo Catireiro Fundador</div>}
          {isAdminRole(user.role) && <Link to="/admin">{user.role === 'master' ? 'Painel master' : 'Painel administrador'}</Link>}
          <Link to="/config">Configurações</Link>
          <button onClick={logout}>Sair</button>
        </div>
      </div>
    </>
  );
}

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { fee } = useConfig();
  return (
    <>
      <Top back title="Configurações" />
      <div className="page">
        <div className="brand-center"><BrandLogo size="md" /></div>
        <p className="lead">Aparência do aplicativo</p>
        <div className="theme-switch" style={{ marginBottom: 18 }}>
          <button type="button" className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>Claro</button>
          <button type="button" className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>Escuro</button>
        </div>
        <p className="lead">CATIRA começa em Corinto-MG e pode crescer para Curvelo, Três Marias e outras cidades.</p>
        <div className="menu">
          <div style={{ padding: 14 }}>Versão 1.0 · MVP</div>
          <div style={{ padding: 14 }}>Taxa de anúncio: {money(fee)}</div>
          <div style={{ padding: 14 }}>Comissão sobre venda: nenhuma</div>
        </div>
      </div>
    </>
  );
}
