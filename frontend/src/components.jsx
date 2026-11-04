import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { CatIcon, Ico } from './icons';
import { money, condLabel, statusLabel, typeLabel, priceText, api } from './api';
import { useAuth, isAdminRole } from './auth';
import { useTheme } from './theme';
import { useConfig } from './config';
import { useCity } from './city';
import { resolveVoiceCommand, buildSearchUrl, voiceHelpExamples } from './voiceCommands';

const Shell = createContext(null);
function useShell() {
  return useContext(Shell);
}

export function Layout({ children }) {
  const loc = useLocation();
  const { user } = useAuth();
  const { auctionEnabled } = useConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const hideNav = loc.pathname.startsWith('/admin') || loc.pathname.startsWith('/chat/') || loc.pathname.startsWith('/checkout');
  const hideFoot = hideNav || loc.pathname === '/em-acao' || loc.pathname.startsWith('/buscar');
  const admin = loc.pathname.startsWith('/admin');
  const isAdmin = user && isAdminRole(user.role);

  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    if (loc.pathname === '/perfil') {
      setUnread(0);
      return;
    }
    const reqs = [
      api('/api/listings/notices'),
      api('/api/acao/notices'),
    ];
    if (auctionEnabled) reqs.push(api('/api/auctions/notifications'));
    Promise.all(reqs.map((p) => p.then((d) => d.unread || 0).catch(() => 0)))
      .then((parts) => setUnread(parts.reduce((a, b) => a + b, 0)));
  }, [user, loc.pathname, auctionEnabled]);

  return (
    <Shell.Provider value={{ menuOpen, setMenuOpen, unread, setUnread }}>
      <div className={admin ? 'app admin-mode' : 'app'}>
        {children}
        {!hideFoot && (
          <footer className="site-foot">
            <BrandLogo size="sm" />
            <span>Compra, vende ou troca.</span>
            <nav className="foot-links">
              {!isAdmin && <Link to="/suporte">Falar com o suporte</Link>}
              <Link to="/privacidade">Política de privacidade</Link>
              <Link to="/termos">Termos de uso</Link>
            </nav>
            <p className="foot-disclaimer">
              Os produtos anunciados são de responsabilidade exclusiva do usuário anunciante.
              O CATIRA é apenas o meio de divulgação entre as partes.
            </p>
          </footer>
        )}
        {!hideNav && <BottomNav />}
        {menuOpen && <AccountMenu />}
      </div>
    </Shell.Provider>
  );
}

export function AccountButton({ className }) {
  const { user } = useAuth();
  const shell = useShell();
  if (!shell) return null;
  const { setMenuOpen, unread } = shell;
  const count = unread > 9 ? '9+' : unread;
  return (
    <button
      type="button"
      className={'account-btn' + (className ? ' ' + className : '')}
      onClick={() => setMenuOpen(true)}
      aria-label="Menu da conta"
    >
      {user ? (
        <span className="avatar sm account-avatar" style={{ background: user.avatarColor }}>{user.name.slice(0, 1)}</span>
      ) : (
        <Ico name="user" size={20} />
      )}
      {!!unread && <span className="account-badge">{count}</span>}
    </button>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const { auctionEnabled } = useConfig();
  const { setMenuOpen } = useShell();
  const admin = user && isAdminRole(user.role);
  function closeMenu() { setMenuOpen(false); }
  return (
    <div className="modal-bg menu-sheet-bg" onClick={closeMenu}>
      <div className="modal menu-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="menu-sheet-handle" />
        <div className="menu-sheet-user">
          {user ? (
            <Link to="/perfil" className="menu-sheet-user-link" onClick={closeMenu}>
              <div className="avatar" style={{ background: user.avatarColor }}>{user.name.slice(0, 1)}</div>
              <div>
                <strong>{user.name}</strong>
                <div className="hint">Ver perfil</div>
              </div>
            </Link>
          ) : (
            <div className="menu-sheet-user-link">
              <div>
                <strong>Menu</strong>
                <div className="hint">Entre para anunciar, favoritar e conversar.</div>
              </div>
            </div>
          )}
          <ThemeToggle />
        </div>
        <div className="menu">
          {user ? (
            <>
              <Link to="/perfil" onClick={closeMenu}>Perfil</Link>
              <Link to="/em-acao" onClick={closeMenu}>Catira em Ação</Link>
              <Link to="/favoritos" onClick={closeMenu}>Favoritos</Link>
              <Link to="/meus-anuncios" onClick={closeMenu}>Meus anúncios</Link>
              <Link to="/conversas" onClick={closeMenu}>Conversas</Link>
              <Link to="/propostas" onClick={closeMenu}>Minhas propostas</Link>
              <Link to="/alertas" onClick={closeMenu}>Meus alertas</Link>
              {auctionEnabled && <Link to="/leiloes" onClick={closeMenu}>CATIRA LEILÃO</Link>}
              {auctionEnabled && <Link to="/meus-leiloes" onClick={closeMenu}>Meus leilões</Link>}
              {auctionEnabled && <Link to="/meus-arremates" onClick={closeMenu}>Meus arremates</Link>}
              {user.dealerStatus === 'approved' || admin ? (
                <Link to="/central-repasse" onClick={closeMenu}>Central de Repasse</Link>
              ) : (
                <Link to="/catireiro" onClick={closeMenu}>{user.dealerStatus === 'pending' ? 'Solicitação de catireiro' : 'Quero ser catireiro'}</Link>
              )}
              <Link to="/propostas-rapidas" onClick={closeMenu}>Propostas rápidas</Link>
              <Link to="/oportunidades-catira" onClick={closeMenu}>Catira — Oportunidades Próprias</Link>
              {admin && <Link to="/admin" onClick={closeMenu}>{user.role === 'master' ? 'Painel master' : 'Painel administrador'}</Link>}
              <Link to="/config" onClick={closeMenu}>Configurações</Link>
              {!admin && <Link to="/suporte" onClick={closeMenu}>Falar com o suporte</Link>}
              <button type="button" onClick={() => { closeMenu(); logout(); }}>Sair</button>
            </>
          ) : (
            <>
              <Link to="/entrar" onClick={closeMenu}>Entrar</Link>
              <Link to="/cadastro" onClick={closeMenu}>Criar conta</Link>
              <Link to="/em-acao" onClick={closeMenu}>Catira em Ação</Link>
              <Link to="/suporte" onClick={closeMenu}>Falar com o suporte</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function BrandLogo({ size = 'md', mark = false }) {
  const srcLight = mark ? '/logo-mark.png' : '/logo-full.png';
  const srcDark = mark ? '/logo-mark.png' : '/logo-full-dark.png';
  const cls = 'brand-logo brand-logo-' + size + (mark ? ' is-mark' : '');
  return (
    <span className="brand-logo-wrap">
      <img src={srcLight} alt="CATIRA Corinto" className={cls + ' brand-logo-light'} />
      <img src={srcDark} alt="CATIRA Corinto" className={cls + ' brand-logo-dark'} />
    </span>
  );
}

export function ThemeToggle({ className }) {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      className={className || 'theme-btn'}
      onClick={toggle}
      aria-label={dark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={dark ? 'Modo claro' : 'Modo escuro'}
    >
      <Ico name={dark ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

export function Top({ title, right, back }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      <div className="brand-row">
        {back ? (
          <button onClick={() => nav(-1)} className="back-btn">Voltar</button>
        ) : (
          <Link to="/" className="brand-link">
            <BrandLogo size="sm" />
          </Link>
        )}
        {title && <strong style={{ fontSize: 16 }}>{title}</strong>}
        <div className="top-actions">
          {right || <CityChip />}
          <AccountButton />
        </div>
      </div>
    </header>
  );
}

export function CityChip() {
  const { city, cities, setCity } = useCity();
  return (
    <label className="city-chip">
      <Ico name="pin" size={14} />
       <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="Cidade dos anúncios">
        <option value="">Todas</option>
         {cities.map((c) => (
           <option key={c.id || c.name} value={c.name}>{c.name}{c.state ? '/' + c.state : ''}</option>
         ))}
      </select>
    </label>
  );
}

function useVoiceSearch({ onChange, onSubmit }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { auctionEnabled } = useConfig();
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [voiceErr, setVoiceErr] = useState('');
  const [heard, setHeard] = useState('');
  const [redirect, setRedirect] = useState(null);
  const recRef = useRef(null);
  const noteTimer = useRef(null);

  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  function flashNote(msg) {
    setVoiceNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setVoiceNote(''), 4000);
  }

  function stop() {
    if (recRef.current) {
      try { recRef.current.stop(); } catch (e) { /* noop */ }
    }
  }

  useEffect(() => () => { stop(); if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  useEffect(() => {
    if (!redirect) return;
    const t = setTimeout(() => {
      const to = redirect.to;
      setRedirect(null);
      nav(to);
    }, 3000);
    return () => clearTimeout(t);
  }, [redirect]);

  function runCommand(text) {
    const cmd = resolveVoiceCommand(text, { user, auctionEnabled });
    if (!cmd) { onChange(text); onSubmit && onSubmit(text); return; }
    if (cmd.type === 'help') {
      flashNote('Comandos: ' + voiceHelpExamples(auctionEnabled).join(', ') + '...');
      return;
    }
    if (cmd.type === 'navigate') {
      if (cmd.admin && !(user && isAdminRole(user.role))) { flashNote('Comando disponível apenas para administradores.'); return; }
      if (cmd.auth && !user) {
        setRedirect({ to: '/entrar?next=' + encodeURIComponent(cmd.to), title: 'Entrar na conta', message: 'Precisamos que você entre na sua conta para acessar ' + cmd.label + '.' });
        return;
      }
      setRedirect({ to: cmd.to, title: cmd.label, message: 'Levando você para a tela de ' + cmd.label + '.' });
      return;
    }
    if (cmd.type === 'search') {
      setRedirect({ to: buildSearchUrl(cmd), title: 'Buscar anúncios', message: 'Buscando ' + (cmd.label || 'o que você pediu') + '.' });
      return;
    }
    onChange(text);
    onSubmit && onSubmit(text);
  }

  function startVoice() {
    setVoiceErr('');
    setHeard('');
    if (!SR) {
      setVoiceErr('Seu navegador não suporta busca por voz.');
      flashNote('Busca por voz indisponível neste navegador.');
      return;
    }
    if (listening) { stop(); return; }
    const rec = new SR();
    recRef.current = rec;
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 3;
    let finalText = '';
    let lastText = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      const shown = text.trim();
      lastText = shown;
      setHeard(shown);
      onChange(shown);
    };
    rec.onerror = (e) => {
      setVoiceErr(e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Permita o acesso ao microfone para buscar por voz.'
        : 'Não consegui ouvir. Tente novamente.');
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = (finalText || lastText || '').trim();
      if (text) runCommand(text);
    };
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setVoiceErr('Não foi possível iniciar a busca por voz.');
      setListening(false);
    }
  }

  return { listening, voiceNote, voiceErr, heard, redirect, startVoice };
}

function VoiceRedirect({ redirect }) {
  if (!redirect) return null;
  return (
    <div className="voice-redirect" role="status" aria-live="polite">
      <div className="voice-redirect-card">
        <div className="voice-spinner" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
        <h3>{redirect.title}</h3>
        <p>{redirect.message}</p>
        <div className="voice-redirect-bar"><span /></div>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, onSubmit, placeholder }) {
  const voice = useVoiceSearch({ onChange, onSubmit });
  return (
    <>
      <form className="search-bar" onSubmit={(e) => { e.preventDefault(); onSubmit && onSubmit(value); }}>
        <Ico name="search" size={18} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={voice.listening ? 'Ouvindo...' : (placeholder || 'O que você está procurando?')}
        />
        {!!value && (
          <button
            type="button"
            className="search-clear"
            onClick={() => { onChange(''); onSubmit && onSubmit(''); }}
            aria-label="Limpar pesquisa"
            title="Limpar pesquisa"
          >
            <Ico name="close" size={18} />
          </button>
        )}
        <button
          type="button"
          className={'search-voice' + (voice.listening ? ' on' : '')}
          onClick={voice.startVoice}
          aria-label={voice.listening ? 'Parar busca por voz' : 'Buscar por voz'}
          title={voice.listening ? 'Parar' : 'Buscar por voz ou comando'}
        >
          <Ico name="mic" size={26} />
        </button>
        {voice.voiceNote && <span className="search-voice-note">{voice.voiceNote}</span>}
        {voice.voiceErr && <span className="search-voice-err">{voice.voiceErr}</span>}
      </form>
      <VoiceRedirect redirect={voice.redirect} />
    </>
  );
}

export function VoiceFab({ onChange, onSubmit, className }) {
  const voice = useVoiceSearch({ onChange, onSubmit });
  return (
    <>
      <button
        type="button"
        className={'voice-fab' + (voice.listening ? ' on' : '') + (className ? ' ' + className : '')}
        onClick={voice.startVoice}
        aria-label={voice.listening ? 'Parar busca por voz' : 'Buscar por voz'}
        title={voice.listening ? 'Parar' : 'Buscar por voz ou comando'}
      >
        <Ico name="mic" size={26} />
      </button>
      {voice.voiceNote && <span className="voice-fab-note">{voice.voiceNote}</span>}
      {voice.voiceErr && <span className="voice-fab-note err">{voice.voiceErr}</span>}
      <VoiceRedirect redirect={voice.redirect} />
    </>
  );
}

export function BottomNav() {
  const { user } = useAuth();
  const items = [
    { to: '/', name: 'home', label: 'Início', end: true },
    { to: '/buscar', name: 'search', label: 'Buscar' },
    { to: user ? '/anunciar' : '/entrar?next=/anunciar', name: 'plus', label: 'Anunciar', plus: true },
    { to: '/em-acao', name: 'sparkles', label: 'Em Ação' },
    { to: user ? '/conversas' : '/entrar?next=/conversas', name: 'chat', label: 'Mensagens' },
  ];

  return (
    <nav className="bottom-nav">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
        >
          {it.plus ? (
            <span className="nav-plus"><Ico name={it.name} size={22} stroke={2.4} /></span>
          ) : (
            <Ico name={it.name} size={22} />
          )}
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function officialLocation(item) {
  const delivery = item && item.delivery;
  if (!delivery) return 'Entrega Catira';
  if (delivery.mode === 'all') return 'Entrega para todo o Brasil';
  const count = Array.isArray(delivery.cityIds) ? delivery.cityIds.length : 0;
  if (!count) return 'Consulte a entrega';
  return count === 1 ? 'Entrega em 1 cidade' : 'Entrega em ' + count + ' cidades';
}

export function ListingCard({ item }) {
  const img = item.images?.[0]?.url;
  return (
    <article className={'card' + (item.featured ? ' featured' : '') + (item.isOfficial ? ' is-official' : '')}>
      <Link to={'/anuncio/' + item.id}>
        <div className="thumb">
          {img && <img src={img} alt={item.title} />}
          {item.isOfficial ? (
            <span className="badge-official">CATIRA OFICIAL</span>
          ) : item.listingType === 'procuro' ? (
            <span className="badge-want">PROCURO</span>
          ) : null}
          {!item.isOfficial && (item.listingType === 'troca' || item.listingType === 'venda_troca' || item.acceptsTrade) && item.listingType !== 'procuro' && <span className="badge-trade">ACEITA TROCA</span>}
          {item.premium && <span className="badge-premium">PREMIUM</span>}
          {(item.featured || item.vip) && !item.premium && !item.isOfficial && <span className="badge-feat">DESTAQUE</span>}
        </div>
        <div className="card-body">
          <h3>{item.title}</h3>
          <div className="price">{priceText(item)}</div>
          {item.ratingCount > 0 && (
            <div className="card-stars">{'★'.repeat(Math.round(item.ratingAvg))}{'☆'.repeat(5 - Math.round(item.ratingAvg))} {item.ratingAvg}</div>
          )}
          <div className="meta">
            <span>{item.isOfficial ? officialLocation(item) : item.city}{!item.isOfficial && item.city && !String(item.city).includes('/') ? '/MG' : ''}</span>
            {!item.isOfficial && <span>{item.timeAgo}</span>}
          </div>
          <span className="btn-view">{item.isOfficial ? 'Ver produto' : 'Ver anúncio'}</span>
        </div>
      </Link>
    </article>
  );
}

export function ListingFeedCard({ item, user, onChange, onOpenComments, onReport }) {
  const [menu, setMenu] = useState(false);
  const [openCap, setOpenCap] = useState(false);
  const nav = useNavigate();
  if (!item) return null;
  const seller = item.seller;
  const liked = !!item.liked;
  const title = String(item.title || '');
  const longCap = title.length > 110;
  const shown = openCap || !longCap ? title : title.slice(0, 110).trim();

  async function like() {
    if (!user) { nav('/entrar?next=/buscar'); return; }
    try {
      const next = await api('/api/listings/' + item.id + '/like', { method: 'POST' });
      onChange && onChange(next);
    } catch {}
  }

  if (item.isOfficial) {
    return (
      <article className="acao-ig is-official">
        <header className="acao-ig-head">
          <div className="acao-ig-user">
            <span className="acao-ig-ring official-ring">
              <span className="avatar sm official-avatar">C</span>
            </span>
            <span>
              <strong>CATIRA OFICIAL</strong>
              <em>{officialLocation(item)}</em>
            </span>
          </div>
          <span className="badge-official">OFICIAL</span>
        </header>
        {item.images && item.images.length > 0 && (
          <PhotoGallery images={item.images} alt={item.title} size="feed" />
        )}
        <p className="acao-ig-cap"><strong>CATIRA OFICIAL</strong> {shown}</p>
        <p className="acao-ig-price">{priceText(item)}</p>
        <Link to={'/anuncio/' + item.id} className="acao-ig-view-ad">Ver produto</Link>
        <p className="acao-ig-time">Produto vendido pela plataforma</p>
      </article>
    );
  }

  return (
    <article className="acao-ig">
      <header className="acao-ig-head">
        {seller ? (
          <Link to={'/usuario/' + seller.id} className="acao-ig-user">
            <span className="acao-ig-ring">
              <span className="avatar sm" style={{ background: seller.avatarColor }}>{(seller.name || '?').slice(0, 1)}</span>
            </span>
            <span>
              <strong>{seller.name}</strong>
              <em>{item.city || seller.city || 'Corinto'}</em>
            </span>
          </Link>
        ) : <span>Anunciante</span>}
        {onReport && (
          <button type="button" className="acao-ig-more" onClick={() => setMenu((v) => !v)} aria-label="Mais opções">
            <Ico name="more" size={22} />
          </button>
        )}
        {menu && (
          <div className="acao-ig-menu">
            <button type="button" onClick={() => { setMenu(false); onReport(item); }}>Denunciar</button>
          </div>
        )}
      </header>
      {item.images && item.images.length > 0 && (
        <PhotoGallery images={item.images} alt={item.title} size="feed" onDoubleTap={like} />
      )}
      <div className="acao-ig-actions">
        <button type="button" className={'acao-ig-btn' + (liked ? ' on' : '')} onClick={like} aria-pressed={liked} aria-label={liked ? 'Descurtir' : 'Curtir'}>
          <Ico name="heart" size={26} stroke={1.7} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="acao-ig-btn" onClick={() => onOpenComments && onOpenComments(item)} aria-label="Comentar">
          <Ico name="chat" size={26} stroke={1.7} />
        </button>
      </div>
      {!!item.likeCount && <p className="acao-ig-likes">{item.likeCount === 1 ? '1 curtida' : item.likeCount + ' curtidas'}</p>}
      <p className="acao-ig-cap">
        {seller && <Link to={'/usuario/' + seller.id}>{seller.name}</Link>}
        {' '}{shown}{longCap && !openCap ? '... ' : ' '}
        {longCap && !openCap && (
          <button type="button" className="acao-ig-more-text" onClick={() => setOpenCap(true)}>mais</button>
        )}
      </p>
      <p className="acao-ig-price">{priceText(item)}</p>
      <Link to={'/anuncio/' + item.id} className="acao-ig-view-ad">Ver anúncio</Link>
      {!!item.commentCount && (
        <button type="button" className="acao-ig-view" onClick={() => onOpenComments && onOpenComments(item)}>
          Ver {item.commentCount === 1 ? '1 comentário' : 'todos os ' + item.commentCount + ' comentários'}
        </button>
      )}
      <p className="acao-ig-time">{item.timeAgo}</p>
      <button type="button" className="acao-ig-add" onClick={() => onOpenComments && onOpenComments(item)}>
        Adicione um comentário...
      </button>
    </article>
  );
}

export function ListingRow({ item, extra }) {
  const img = item.images?.[0]?.url;
  return (
    <Link to={'/anuncio/' + item.id} className="list-item">
      {img && <img src={img} alt="" />}
      <div>
        <h3>{item.title}</h3>
        <div className="price">{priceText(item)}</div>
        <div className="meta">{item.city}{item.city && !String(item.city).includes('/') ? '/MG' : ''} · {item.timeAgo}</div>
        {item.listingType && <span className={'status type-' + item.listingType}>{item.listingTypeLabel || typeLabel(item.listingType)}</span>}
        {item.premium && <span className="status premium">Premium</span>}
        {(item.vip || item.featured) && !item.premium && <span className="status featured">Destaque</span>}
        {(item.listingType === 'troca' || item.listingType === 'venda_troca' || item.acceptsTrade) && item.listingType !== 'procuro' && <span className="status published">Aceita troca</span>}
        {item.status && item.status !== 'published' && (
          <span className={'status ' + item.status}>{statusLabel[item.status] || item.status}</span>
        )}
        {extra}
      </div>
    </Link>
  );
}

export function HomeAdBanner({ className }) {
  const { homeBanner, premiumBanner } = useConfig();
  const overlay = premiumBanner && premiumBanner.imageUrl ? premiumBanner : null;
  const banner = overlay || ((homeBanner && homeBanner.enabled && homeBanner.imageUrl) ? homeBanner : null);
  if (!banner) return null;
  const img = <img src={banner.imageUrl} alt={banner.title || 'Anúncio'} />;
  const cls = 'home-ad-banner' + (overlay ? ' is-premium' : '');
  let inner = <div className={cls}>{img}</div>;
  if (banner.link) {
    inner = banner.link.startsWith('/')
      ? <Link to={banner.link} className={cls}>{img}</Link>
      : <a href={banner.link} className={cls} target="_blank" rel="noopener noreferrer">{img}</a>;
  }
  return (
    <div className={'home-ad' + (className ? ' ' + className : '')}>
      {inner}
    </div>
  );
}

export function Empty({ title, text, to, cta }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
      {to && <Link to={to} className="btn btn-primary" style={{ marginTop: 16, maxWidth: 260 }}>{cta}</Link>}
    </div>
  );
}

export function NeedAuth({ next }) {
  const { fee, feeEnabled } = useConfig();
  return (
    <div className="page">
      <div className="brand-center"><BrandLogo size="lg" /></div>
      <h1>Entre para continuar</h1>
      <p className="lead">
        {feeEnabled
          ? `Cadastro é grátis. Anunciar custa ${money(fee)}. Comprar não paga nada.`
          : 'Cadastro é grátis. Anunciar é grátis. Comprar não paga nada.'}
      </p>
      <Link className="btn btn-primary" to={'/entrar?next=' + encodeURIComponent(next || '/')}>Entrar</Link>
      <div style={{ height: 10 }} />
      <Link className="btn btn-ghost" to={'/cadastro?next=' + encodeURIComponent(next || '/')}>Criar conta</Link>
    </div>
  );
}

export function conditionText(c) {
  return condLabel[c] || c;
}

export function PhotoGallery({ images, alt, size = 'card', onDoubleTap }) {
  const [idx, setIdx] = useState(0);
  const lastTap = useRef(0);
  const list = (images || []).filter((im) => im && im.url);
  if (!list.length) return null;
  const i = MinIdx(idx, list.length);
  const current = list[i];
  const many = list.length > 1;
  const feed = size === 'feed';

  function go(dir, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIdx((n) => {
      const next = n + dir;
      if (next < 0) return list.length - 1;
      if (next >= list.length) return 0;
      return next;
    });
  }

  function tapPhoto(e) {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      e.preventDefault();
      onDoubleTap();
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
  }

  return (
    <div className={'opp-gallery' + (size === 'hero' ? ' hero' : '') + (feed ? ' feed' : '')}>
      <div className="opp-gallery-main" onClick={tapPhoto}>
        <img src={current.url} alt={alt || ''} />
        {many && (
          <>
            <button type="button" className="opp-gallery-nav prev" onClick={(e) => go(-1, e)} aria-label="Foto anterior">{feed ? '‹' : 'Anterior'}</button>
            <button type="button" className="opp-gallery-nav next" onClick={(e) => go(1, e)} aria-label="Proxima foto">{feed ? '›' : 'Proxima'}</button>
            <span className="opp-gallery-count">{i + 1}/{list.length}</span>
          </>
        )}
        {feed && many && (
          <div className="opp-gallery-dots" aria-hidden="true">
            {list.map((im, n) => (
              <span key={im.id || im.url || n} className={n === i ? 'on' : ''} />
            ))}
          </div>
        )}
      </div>
      {many && !feed && (
        <div className="opp-gallery-thumbs">
          {list.map((im, n) => (
            <button
              key={im.id || im.url || n}
              type="button"
              className={n === i ? 'on' : ''}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(n); }}
            >
              <img src={im.url} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MinIdx(idx, len) {
  return Math.min(Math.max(0, idx), Math.max(0, len - 1));
}
