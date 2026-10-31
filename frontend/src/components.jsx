import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { CatIcon, Ico } from './icons';
import { money, condLabel, statusLabel, typeLabel, priceText } from './api';
import { useAuth, isAdminRole } from './auth';
import { useTheme } from './theme';
import { useConfig } from './config';
import { useCity } from './city';
import { resolveVoiceCommand, buildSearchUrl, voiceHelpExamples } from './voiceCommands';

export function Layout({ children }) {
  const loc = useLocation();
  const { user } = useAuth();
  const hideNav = loc.pathname.startsWith('/admin') || loc.pathname.startsWith('/chat/');
  const admin = loc.pathname.startsWith('/admin');
  const isAdmin = user && isAdminRole(user.role);
  return (
    <div className={admin ? 'app admin-mode' : 'app'}>
      {children}
      {!loc.pathname.startsWith('/chat/') && (
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
          <ThemeToggle />
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

export function SearchBox({ value, onChange, onSubmit, placeholder }) {
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

  return (
    <>
      <form className="search-bar" onSubmit={(e) => { e.preventDefault(); onSubmit && onSubmit(value); }}>
        <Ico name="search" size={18} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={listening ? 'Ouvindo...' : (placeholder || 'O que você está procurando?')}
        />
        <button
          type="button"
          className={'search-voice' + (listening ? ' on' : '')}
          onClick={startVoice}
          aria-label={listening ? 'Parar busca por voz' : 'Buscar por voz'}
          title={listening ? 'Parar' : 'Buscar por voz ou comando'}
        >
          <Ico name="mic" size={26} />
        </button>
        {voiceNote && <span className="search-voice-note">{voiceNote}</span>}
        {voiceErr && <span className="search-voice-err">{voiceErr}</span>}
      </form>
      {redirect && (
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
      )}
    </>
  );
}

export function BottomNav() {
  const { user, logout } = useAuth();
  const { auctionEnabled } = useConfig();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const admin = user && isAdminRole(user.role);

  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  const items = [
    { to: '/', name: 'home', label: 'Início', end: true },
    { to: '/buscar', name: 'search', label: 'Buscar' },
    { to: user ? '/anunciar' : '/entrar?next=/anunciar', name: 'plus', label: 'Anunciar', plus: true },
    { to: '/em-acao', name: 'sparkles', label: 'Em Ação' },
    { menu: true, name: 'menu', label: 'Menu' },
  ];

  function closeMenu() { setMenuOpen(false); }

  return (
    <>
      <nav className="bottom-nav">
        {items.map((it) => {
          if (it.menu) {
            return (
              <button
                key="menu"
                type="button"
                className={'nav-item' + (menuOpen ? ' active' : '')}
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Menu"
                aria-expanded={menuOpen}
              >
                <Ico name="menu" size={22} />
                Menu
              </button>
            );
          }
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={closeMenu}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              {it.plus ? (
                <span className="nav-plus"><Ico name={it.name} size={22} stroke={2.4} /></span>
              ) : (
                <Ico name={it.name} size={22} />
              )}
              {it.label}
            </NavLink>
          );
        })}
      </nav>
      {menuOpen && (
        <div className="modal-bg menu-sheet-bg" onClick={closeMenu}>
          <div className="modal menu-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="menu-sheet-handle" />
            {user ? (
              <Link to="/perfil" className="menu-sheet-user" onClick={closeMenu}>
                <div className="avatar" style={{ background: user.avatarColor }}>{user.name.slice(0, 1)}</div>
                <div>
                  <strong>{user.name}</strong>
                  <div className="hint">Ver perfil</div>
                </div>
              </Link>
            ) : (
              <div className="menu-sheet-user">
                <div>
                  <strong>Menu</strong>
                  <div className="hint">Entre para anunciar, favoritar e conversar.</div>
                </div>
              </div>
            )}
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
      )}
    </>
  );
}

export function ListingCard({ item }) {
  const img = item.images?.[0]?.url;
  return (
    <article className={'card' + (item.featured ? ' featured' : '')}>
      <Link to={'/anuncio/' + item.id}>
        <div className="thumb">
          {img && <img src={img} alt={item.title} />}
          {item.listingType === 'procuro' && <span className="badge-want">PROCURO</span>}
          {(item.listingType === 'troca' || item.listingType === 'venda_troca' || item.acceptsTrade) && item.listingType !== 'procuro' && <span className="badge-trade">ACEITA TROCA</span>}
          {item.premium && <span className="badge-premium">PREMIUM</span>}
          {(item.featured || item.vip) && !item.premium && <span className="badge-feat">DESTAQUE</span>}
        </div>
        <div className="card-body">
          <h3>{item.title}</h3>
          <div className="price">{priceText(item)}</div>
          {item.ratingCount > 0 && (
            <div className="card-stars">{'★'.repeat(Math.round(item.ratingAvg))}{'☆'.repeat(5 - Math.round(item.ratingAvg))} {item.ratingAvg}</div>
          )}
          <div className="meta">
            <span>{item.city}{item.city && !String(item.city).includes('/') ? '/MG' : ''}</span>
            <span>{item.timeAgo}</span>
          </div>
          <span className="btn-view">Ver anúncio</span>
        </div>
      </Link>
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

export function PhotoGallery({ images, alt, size = 'card' }) {
  const [idx, setIdx] = useState(0);
  const list = (images || []).filter((im) => im && im.url);
  if (!list.length) return null;
  const i = Math.min(idx, list.length - 1);
  const current = list[i];
  const many = list.length > 1;

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

  return (
    <div className={'opp-gallery' + (size === 'hero' ? ' hero' : '')}>
      <div className="opp-gallery-main">
        <img src={current.url} alt={alt || ''} />
        {many && (
          <>
            <button type="button" className="opp-gallery-nav prev" onClick={(e) => go(-1, e)} aria-label="Foto anterior">Anterior</button>
            <button type="button" className="opp-gallery-nav next" onClick={(e) => go(1, e)} aria-label="Proxima foto">Proxima</button>
            <span className="opp-gallery-count">{i + 1} / {list.length}</span>
          </>
        )}
      </div>
      {many && (
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
