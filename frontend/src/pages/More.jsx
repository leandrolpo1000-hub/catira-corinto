import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money, statusLabel } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { Empty, ListingRow, NeedAuth, ThemeToggle, Top } from '../components';
import { useConfig } from '../config';

export function Favorites() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user) return;
    api('/api/favorites').then((d) => setItems(d.items || [])).catch(() => {});
  }, [user]);
  if (!user) return <NeedAuth next="/favoritos" />;
  return (
    <>
      <Top back title="Favoritos" />
      <div className="page">
        <h1>Meus favoritos</h1>
        {!items.length && <Empty title="Nenhum favorito" text="Toque em favoritar nos anúncios." to="/" cta="Explorar" />}
        {items.map((it) => (
          <div key={it.id}>
            <ListingRow item={it} extra={<span className={'status ' + it.status}>{statusLabel[it.status] || it.status}</span>} />
            <button className="btn btn-ghost" style={{ marginBottom: 10 }} onClick={async () => {
              await api('/api/favorites/' + it.id, { method: 'POST' });
              setItems((prev) => prev.filter((x) => x.id !== it.id));
            }}>Remover dos favoritos</button>
          </div>
        ))}
      </div>
    </>
  );
}

export function Mine() {
  const { user } = useAuth();
  const { fee, vipListingFee, feeEnabled } = useConfig();
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('all');
  const [invite, setInvite] = useState(null);
  const nav = useNavigate();

  async function load() {
    const d = await api('/api/listings/mine');
    setItems(d.items || []);
  }
  useEffect(() => { if (user) load().catch(() => {}); }, [user]);
  if (!user) return <NeedAuth next="/meus-anuncios" />;

  const map = {
    all: items,
    published: items.filter((i) => i.status === 'published'),
    awaiting_payment: items.filter((i) => i.status === 'awaiting_payment'),
    awaiting_confirmation: items.filter((i) => i.status === 'awaiting_confirmation'),
    payment_expired: items.filter((i) => i.status === 'payment_expired'),
    changes_requested: items.filter((i) => i.status === 'changes_requested'),
    awaiting_review: items.filter((i) => i.status === 'awaiting_review'),
    cancelled: items.filter((i) => i.status === 'cancelled'),
    sold: items.filter((i) => i.status === 'sold'),
    traded: items.filter((i) => i.status === 'traded'),
    negotiated: items.filter((i) => i.status === 'negotiated'),
    expired: items.filter((i) => i.status === 'expired'),
    paused: items.filter((i) => i.status === 'paused'),
  };

  async function act(id, action) {
    if (action === 'pay') return nav('/pagar/' + id);
    const d = await api('/api/listings/' + id + '/status', { method: 'POST', body: JSON.stringify({ action }) });
    await load();
    if (d && d.actionInvite) setInvite({ id, title: d.title || '', action });
  }

  return (
    <>
      <Top back title="Meus anúncios" />
      <div className="page">
        <div className="chips">
          {[['all', 'Todos'], ['published', 'Ativos'], ['awaiting_payment', 'Pagamento'], ['awaiting_confirmation', 'Confirmação'], ['payment_expired', 'Pag. expirado'], ['changes_requested', 'Correção'], ['awaiting_review', 'Revisão'], ['paused', 'Pausados'], ['sold', 'Vendidos'], ['traded', 'Trocados'], ['negotiated', 'Negociados'], ['expired', 'Expirados'], ['cancelled', 'Encerrados']].map(([k, l]) => (
            <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {!map[tab].length && <Empty title="Nada aqui" text={feeEnabled ? 'Publique por ' + money(fee) + '.' : 'Publicar é grátis.'} to="/anunciar" cta="+ Anunciar" />}
        {map[tab].map((it) => (
          <div key={it.id} className="list-item" style={{ flexDirection: 'column' }}>
            <ListingRow item={it} />
            {it.adminNote && (it.status === 'changes_requested' || it.status === 'cancelled') && (
              <p className="admin-note">{it.status === 'cancelled' ? 'Motivo: ' : 'Correção pedida: '}{it.adminNote}</p>
            )}
            <div className="row-btns" style={{ marginTop: 8 }}>
               {(it.status === 'awaiting_payment' || (['published', 'paused'].includes(it.status) && it.paymentStatus === 'pending')) && it.paymentStatus !== 'awaiting_confirmation' && <button className="btn btn-primary" onClick={() => act(it.id, 'pay')}>Pagar</button>}
              {(it.status === 'awaiting_confirmation' || it.paymentStatus === 'awaiting_confirmation') && it.status !== 'payment_expired' && <button className="btn btn-primary" disabled>Pagar</button>}
              {it.status === 'payment_expired' && <button className="btn btn-primary" onClick={() => nav('/suporte')}>Falar com o suporte</button>}
              {it.status === 'changes_requested' && <button className="btn btn-primary" onClick={() => nav('/anunciar?edit=' + it.id)}>Corrigir anúncio</button>}
              {['published', 'paused', 'awaiting_review'].includes(it.status) && <button className="btn btn-ghost" onClick={() => nav('/anunciar?edit=' + it.id)}>Editar</button>}
              {it.status === 'changes_requested' && <button className="btn btn-ghost" onClick={() => act(it.id, 'cancel')}>Cancelar publicação</button>}
              {it.status === 'published' && <button className="btn btn-ghost" onClick={() => act(it.id, 'pause')}>Pausar</button>}
              {it.status === 'paused' && <button className="btn btn-ghost" onClick={() => act(it.id, 'resume')}>Ativar</button>}
              {['published', 'paused'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'sold')}>Vendido</button>}
              {['published', 'paused'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'traded')}>Trocado</button>}
              {['published', 'paused'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'negotiated')}>Negociado</button>}
              {['sold', 'traded', 'negotiated'].includes(it.status) && <button className="btn btn-ghost" onClick={() => nav('/em-acao/publicar?listing=' + it.id)}>Catira em Ação</button>}
              {['expired', 'paused', 'published'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'renew')}>Renovar</button>}
              {['published', 'paused'].includes(it.status) && !it.premium && it.paymentStatus !== 'pending' && it.paymentStatus !== 'awaiting_confirmation' && <button className="btn btn-ghost" onClick={() => nav('/turbinar/' + it.id)}>Turbinar</button>}
              {(it.status === 'awaiting_confirmation' || it.paymentStatus === 'awaiting_confirmation') && it.status !== 'payment_expired' && <button className="btn btn-ghost" disabled>Encerrar</button>}
              {it.status === 'awaiting_payment' && it.paymentStatus !== 'awaiting_confirmation' && <button className="btn btn-ghost" onClick={() => act(it.id, 'cancel')}>Encerrar</button>}
              {!['cancelled', 'changes_requested', 'awaiting_payment', 'awaiting_confirmation', 'payment_expired'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'cancel')}>Encerrar</button>}
            </div>
          </div>
        ))}
      </div>
      {invite && (
        <div className="modal-bg" onClick={() => setInvite(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Publicar no Catira em Ação?</h3>
            <p className="lead">O anúncio foi marcado. Você pode contar o que rolou, sem preço e sem contato. É opcional e não muda sua reputação.</p>
            <button className="btn btn-primary" type="button" onClick={() => nav('/em-acao/publicar?listing=' + invite.id)}>Publicar</button>
            <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={() => setInvite(null)}>Agora não</button>
          </div>
        </div>
      )}
    </>
  );
}

export function Support() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    api('/api/support')
      .then((d) => nav('/chat/' + d.conversationId, { replace: true }))
      .catch((e) => setErr(e.message));
  }, [user]);

  if (!user) return <NeedAuth next="/suporte" />;
  return (
    <>
      <Top back title="Suporte" />
      <div className="page">
        <h1>Falar com o suporte</h1>
        {err ? <div className="error">{err}</div> : <p className="lead">Abrindo conversa com o suporte do CATIRA...</p>}
      </div>
    </>
  );
}

export function Conversations() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [closed, setClosed] = useState(false);
  const isAdmin = user && isAdminRole(user.role);

  async function load(showClosed) {
    const d = await api('/api/conversations' + (showClosed ? '?status=closed' : ''));
    setItems(d.items || []);
  }
  useEffect(() => { if (user) load(closed).catch(() => {}); }, [user, closed]);

  if (!user) return <NeedAuth next="/conversas" />;
  return (
    <>
      <Top back title="Conversas" />
      <div className="page">
        {isAdmin && (
          <div className="chips">
            <button className={'chip' + (!closed ? ' on' : '')} onClick={() => setClosed(false)}>Ativas</button>
            <button className={'chip' + (closed ? ' on' : '')} onClick={() => setClosed(true)}>Suporte finalizado</button>
          </div>
        )}
        {!items.length && (
          <Empty
            title={closed ? 'Nenhum atendimento finalizado' : 'Nenhuma conversa'}
            text={closed ? 'Atendimentos encerrados ficam guardados aqui.' : 'Toque em Tenho interesse em um anúncio.'}
          />
        )}
        {items.map((c) => (
          <Link key={c.id} to={'/chat/' + c.id} className="list-item">
            {c.listing?.images?.[0] && <img src={c.listing.images[0].url} alt="" />}
            <div>
              <h3>{c.isSupport ? 'Suporte CATIRA' : c.other?.name}</h3>
              <div className="meta">{c.isSupport ? 'Atendimento do CATIRA' : c.listing?.title}</div>
              <div className="hint">{c.lastMessage}</div>
              {c.status === 'closed' && <span className="status cancelled">Finalizado</span>}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export function Chat() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();

  async function load() {
    const d = await api('/api/conversations/' + id);
    setData(d);
  }
  useEffect(() => { if (user) load().catch(() => {}); }, [id, user]);
  if (!user) return <NeedAuth next={'/chat/' + id} />;

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await api('/api/conversations/' + id + '/messages', { method: 'POST', body: JSON.stringify({ text }) });
    setText('');
    load();
  }

  const conv = data?.conversation;
  const isSupport = !!conv?.isSupport;
  const isAdmin = isAdminRole(user.role);
  const closed = isSupport && conv?.status === 'closed';

  async function closeSupport() {
    try {
      await api('/api/conversations/' + id + '/close', { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="brand-row">
          <button onClick={() => nav(-1)} className="back-btn">Voltar</button>
          <strong>{isSupport ? 'Suporte CATIRA' : conv?.other?.name || 'Chat'}</strong>
          {isSupport && isAdmin && !closed && (
            <button type="button" className="support-close-top" onClick={closeSupport}>Encerrar</button>
          )}
          <ThemeToggle />
        </div>
        {isSupport ? (
          <div className="hint">
            {closed ? 'Atendimento encerrado' : 'Atendimento do CATIRA · respondemos por aqui'}
          </div>
        ) : (
          conv?.listing && <div className="hint">{conv.listing.title} · {money(conv.listing.price)} · {conv.listing.listingTypeLabel || ''}</div>
        )}
      </header>
      <div className="chat-wrap">
        <div className="chat-msgs">
          {(data?.messages || []).map((m) => (
            <div key={m.id} className={'bubble ' + (m.senderId === user.id ? 'me' : 'them')}>{m.text}</div>
          ))}
        </div>
        {closed ? (
          <div className="support-closed">
            {isAdmin
              ? 'Atendimento encerrado.'
              : <>Atendimento encerrado. Se precisar, abra um novo em <Link to="/suporte">Falar com o suporte</Link>.</>}
          </div>
        ) : (
          <>
            {!conv?.isSupport && (
              <div className="quick-msgs chat-quick">
                {['Olá! Ainda está disponível?', 'Você aceita troca?', 'Faz por R$ ___?', 'Tenho interesse.'].map((t) => (
                  <button key={t} type="button" className="chip" onClick={() => setText(t)}>{t}</button>
                ))}
              </div>
            )}
            <form className="chat-input" onSubmit={send}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensagem" />
              <button>Enviar</button>
            </form>
            {err && <div className="error" style={{ margin: 12 }}>{err}</div>}
          </>
        )}
      </div>
    </>
  );
}

export function Trades() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [reviewFor, setReviewFor] = useState(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');

  async function load() {
    const d = await api('/api/trades');
    setItems(d.items || []);
  }
  useEffect(() => { if (user) load().catch(() => {}); }, [user]);
  if (!user) return <NeedAuth next="/propostas" />;

  async function act(id, action) {
    await api('/api/trades/' + id + '/status', { method: 'POST', body: JSON.stringify({ action }) });
    load();
  }

  async function sendReview() {
    await api('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        listingId: reviewFor.listingId,
        reviewedUserId: reviewFor.proposerId === user.id ? reviewFor.ownerId : reviewFor.proposerId,
        rating: stars,
        comment,
      }),
    });
    setReviewFor(null);
    setComment('');
  }

  return (
    <>
      <Top back title="Propostas" />
      <div className="page">
        <h1>Minhas propostas</h1>
        {!items.length && <Empty title="Nenhuma proposta" text="Proponha troca nos anúncios com o selo ACEITA TROCA." to="/catiras" cta="Ver catiras" />}
        {items.map((t) => (
          <div key={t.id} className="list-item" style={{ flexDirection: 'column' }}>
            <p className="hint">{t.mine ? 'Você quer' : 'Quer o seu'}</p>
            {t.listing ? (
              <Link to={'/anuncio/' + t.listing.id} className="trade-mini">
                {t.listing.images && t.listing.images[0] && <img src={t.listing.images[0].url} alt="" />}
                <span>
                  <strong>{t.listing.title}</strong>
                  {t.listing.unavailable ? <em>Anúncio indisponível</em> : <em>{money(t.listing.price)}</em>}
                </span>
              </Link>
            ) : (
              <p className="hint">Anúncio indisponível</p>
            )}
            <p className="hint">{t.mine ? 'Você oferece' : (t.proposer?.name || 'Quem propôs') + ' oferece'}</p>
            {t.offeredListing ? (
              t.offeredListing.unavailable ? (
                <div className="trade-mini">
                  {t.offeredListing.images && t.offeredListing.images[0] && <img src={t.offeredListing.images[0].url} alt="" />}
                  <span>
                    <strong>{t.offeredListing.title}</strong>
                    <em>Anúncio indisponível</em>
                  </span>
                </div>
              ) : (
                <Link to={'/anuncio/' + t.offeredListing.id} className="trade-mini">
                  {t.offeredListing.images && t.offeredListing.images[0] && <img src={t.offeredListing.images[0].url} alt="" />}
                  <span>
                    <strong>{t.offeredListing.title}</strong>
                    <em>{money(t.offeredListing.price)}</em>
                  </span>
                </Link>
              )
            ) : t.offerListingId ? (
              <p className="hint">Anúncio indisponível</p>
            ) : null}
            {t.description ? <p className="hint">{t.description}</p> : null}
            {t.extraValue ? (
              <p className="hint">
                {t.extraDirection === 'ask'
                  ? (t.mine ? 'Você pede ' : 'Pede ') + money(t.extraValue) + ' a mais'
                  : (t.mine ? 'Você oferece ' : 'Oferece ') + money(t.extraValue) + ' a mais'}
              </p>
            ) : null}
            <span className={'status ' + t.status}>{statusLabel[t.status] || t.status}</span>
            <div className="row-btns" style={{ marginTop: 8 }}>
              {!t.mine && ['sent', 'negotiating'].includes(t.status) && (
                <>
                  <button className="btn btn-green" onClick={() => act(t.id, 'accept')}>Aceitar</button>
                  <button className="btn btn-ghost" onClick={() => act(t.id, 'reject')}>Recusar</button>
                  {t.status === 'sent' && <button className="btn btn-ghost" onClick={() => act(t.id, 'negotiate')}>Negociar</button>}
                </>
              )}
              {t.status === 'accepted' && <button className="btn btn-primary" onClick={() => act(t.id, 'finish')}>Finalizar</button>}
              {t.status === 'finished' && <button className="btn btn-ghost" onClick={() => setReviewFor(t)}>Avaliar</button>}
            </div>
          </div>
        ))}
      </div>
      {reviewFor && (
        <div className="modal-bg" onClick={() => setReviewFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Avaliar negociação</h3>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>★</button>
              ))}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Negociação tranquila." />
            </div>
            <button className="btn btn-primary" onClick={sendReview}>Enviar avaliação</button>
          </div>
        </div>
      )}
    </>
  );
}

export function Alerts() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const d = await api('/api/alerts');
    setItems(d.items || []);
  }
  useEffect(() => { if (user) load().catch(() => {}); }, [user]);
  if (!user) return <NeedAuth next="/alertas" />;

  async function add(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/alerts', { method: 'POST', body: JSON.stringify({ query }) });
      setQuery('');
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <>
      <Top back title="Alertas" />
      <div className="page">
        <h1>Meus alertas</h1>
        <p className="lead">Acompanhe um produto. Quando sair um anúncio parecido, ele aparece aqui.</p>
        {err && <div className="error">{err}</div>}
        <form onSubmit={add}>
          <div className="field">
            <label>Quero receber alertas de</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: iPhone" required />
          </div>
          <button className="btn btn-primary">Criar alerta</button>
        </form>
        {!items.length && <Empty title="Nenhum alerta" text="Digite o que você procura, como iPhone ou bicicleta." />}
        {items.map((a) => (
          <div key={a.id} className="list-item" style={{ flexDirection: 'column' }}>
            <strong>{a.query || 'Alerta'}</strong>
            {(a.hits || []).slice(0, 3).map((h) => (
              <Link key={h.listingId} to={'/anuncio/' + h.listingId} className="hint">
                Novo anúncio que pode interessar você: {h.title} — {money(h.price)}
              </Link>
            ))}
            {!(a.hits || []).length && <p className="hint">Ainda sem novidades.</p>}
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={async () => {
              await api('/api/alerts/' + a.id, { method: 'DELETE' });
              load();
            }}>Remover</button>
          </div>
        ))}
      </div>
    </>
  );
}

export function PublicUser() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    api('/api/users/' + id).then(setData).catch(() => {});
    api('/api/acao?userId=' + id + '&limit=12').then((d) => setPosts(d.items || [])).catch(() => setPosts([]));
  }, [id]);
  if (!data) return <><Top back /><div className="page">Carregando...</div></>;
  const u = data.user;
  return (
    <>
      <Top back />
      <div className="page">
        <div className="seller">
          <div className="avatar" style={{ background: u.avatarColor }}>{u.name.slice(0, 1)}</div>
          <div>
            <strong>{u.name}</strong>
            <div className="verified">{(u.phoneVerified || u.emailVerified) ? 'Usuário verificado' : u.city}</div>
            <div className="hint">No CATIRA desde {u.createdAt ? new Date(u.createdAt).getFullYear() : ''}</div>
            <div className="hint">{u.ratingCount ? `${u.ratingAvg} (${u.ratingCount} avaliações)` : 'Ainda sem avaliações'}{u.rank ? ' · #' + u.rank : ''}</div>
            <div className="hint">{u.listingsCount || u.published || 0} anúncios{u.deals ? ' · ' + u.deals + ' negociações concluídas' : ''}</div>
          </div>
        </div>
        {user && user.id !== u.id && (
          <>
            <button className="btn btn-ghost" onClick={() => api('/api/block/' + u.id, { method: 'POST' })}>Bloquear usuário</button>
            <p className="pay-alert">Não faça pagamentos antecipados. Prefira negociar pessoalmente em local seguro.</p>
          </>
        )}
        {!!posts.length && (
          <>
            <h2 style={{ margin: '16px 0 10px', fontSize: 17 }}>Catira em Ação</h2>
            {posts.map((p) => (
              <div key={p.id} className="acao-card compact">
                {p.images && p.images[0] && <img src={p.images[0].url} alt="" />}
                <p className="acao-text">{p.text}</p>
                {p.audioUrl && (
                  <div className="acao-audio compact">
                    <audio controls preload="none" src={p.audioUrl}>Seu navegador não toca este áudio.</audio>
                    {p.audioTranscript ? <p className="acao-transcript">{p.audioTranscript}</p> : null}
                  </div>
                )}
                <div className="hint">{p.timeAgo}</div>
              </div>
            ))}
            <Link className="btn btn-ghost" to="/em-acao" style={{ marginBottom: 8 }}>Ver o feed</Link>
          </>
        )}
        <h2 style={{ margin: '16px 0 10px', fontSize: 17 }}>Anúncios</h2>
        {data.listings.map((it) => <ListingRow key={it.id} item={it} />)}
        <h2 style={{ margin: '16px 0 10px', fontSize: 17 }}>Avaliações</h2>
        {(data.reviews || []).map((r) => (
          <div key={r.id} className="list-item">
            <div>
              <strong>{r.reviewer?.name}</strong>
              <div>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
              <p className="hint">{r.comment}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
