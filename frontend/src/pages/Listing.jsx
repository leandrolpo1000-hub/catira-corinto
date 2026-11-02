import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money, reportReasons, typeLabel, priceText, formatBRLInput, parseBRL } from '../api';
import { useAuth } from '../auth';
import { conditionText, HomeAdBanner, officialLocation, Top } from '../components';

export default function Listing() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [showTrade, setShowTrade] = useState(false);
  const [reason, setReason] = useState('golpe');
  const [repDesc, setRepDesc] = useState('');
  const [tradeDesc, setTradeDesc] = useState('');
  const [extra, setExtra] = useState('');
  const [extraDir, setExtraDir] = useState('offer');
  const [offerId, setOfferId] = useState('');
  const [myListings, setMyListings] = useState([]);
  const [tradeErr, setTradeErr] = useState('');
  const [reviews, setReviews] = useState([]);
  const [stars, setStars] = useState(0);
  const [revComment, setRevComment] = useState('');

  useEffect(() => {
    api('/api/listings/' + id).then((d) => {
      setItem(d);
      setStars(d.myRating || 0);
      setRevComment(d.myComment || '');
    }).catch((e) => setErr(e.message));
    api('/api/listings/' + id + '/reviews').then((d) => setReviews(d.items || [])).catch(() => setReviews([]));
  }, [id]);

  if (err && !item) {
    return <><Top back /><div className="page"><div className="error">{err}</div></div></>;
  }
  if (!item) return <><Top back /><div className="page">Carregando...</div></>;

  const mine = user && user.id === item.userId;
  const img = item.images?.[idx]?.url || item.images?.[0]?.url;

  async function needUser(next) {
    if (!user) {
      nav('/entrar?next=' + encodeURIComponent(next || location.pathname));
      return false;
    }
    return true;
  }

  async function interest(preset) {
    if (!(await needUser())) return;
    try {
      const d = await api('/api/interest', {
        method: 'POST',
        body: JSON.stringify({ listingId: item.id, message: preset || 'Olá! Tenho interesse neste anúncio.' }),
      });
      nav('/chat/' + d.conversationId);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function message() {
    if (!(await needUser())) return;
    interest('Olá! Ainda está disponível?');
  }

  async function share() {
    const url = window.location.href;
    const text = 'CATIRA — ' + item.title + ' · ' + money(item.price);
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text, url });
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url);
      setOk('Link copiado.');
    } catch {
      setErr('Não foi possível copiar o link.');
    }
  }

  function shareWhatsApp() {
    const url = window.location.href;
    const text = 'CATIRA\n' + item.title + '\n' + money(item.price) + '\n' + url;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }

  async function whatsapp() {
    if (!(await needUser())) return;
    try {
      const d = await api('/api/whatsapp/' + item.id);
      window.open(d.url, '_blank');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function fav() {
    if (!(await needUser())) return;
    try {
      const d = await api('/api/favorites/' + item.id, { method: 'POST' });
      setItem({ ...item, favorited: d.favorited });
    } catch (e) {
      setErr(e.message);
    }
  }

  async function sendReport() {
    if (!(await needUser())) return;
    try {
      await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ listingId: item.id, reason, description: repDesc }),
      });
      setShowReport(false);
      setOk('Denúncia enviada. Obrigado.');
    } catch (e) {
      setErr(e.message);
    }
  }

  function openTrade() {
    setShowTrade(true);
    setTradeErr('');
    if (!user) return;
    api('/api/listings/mine')
      .then((d) => {
        const mineActive = (d.items || []).filter((l) => l.status === 'published' && l.id !== item.id && l.listingType !== 'procuro');
        setMyListings(mineActive);
      })
      .catch(() => setMyListings([]));
  }

  async function sendTrade() {
    if (!(await needUser())) return;
    setTradeErr('');
    try {
      const extraN = parseBRL(extra);
      await api('/api/trades', {
        method: 'POST',
        body: JSON.stringify({
          listingId: item.id,
          description: tradeDesc,
          extraValue: extraN > 0 ? extraN : 0,
          extraDirection: extraN > 0 ? extraDir : '',
          offerListingId: offerId || '',
        }),
      });
      setShowTrade(false);
      setTradeDesc('');
      setExtra('');
      setOfferId('');
      setOk('Proposta de troca enviada.');
    } catch (e) {
      setTradeErr(e.message);
    }
  }

  async function sendListingReview() {
    if (!(await needUser())) return;
    if (!stars) {
      setErr('Escolha uma nota de 1 a 5.');
      return;
    }
    try {
      const d = await api('/api/listings/' + item.id + '/reviews', {
        method: 'POST',
        body: JSON.stringify({ rating: stars, comment: revComment }),
      });
      if (d.listing) setItem(d.listing);
      const list = await api('/api/listings/' + item.id + '/reviews');
      setReviews(list.items || []);
      setOk('Avaliação registrada.');
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function block() {
    if (!(await needUser())) return;
    try {
      await api('/api/block/' + item.userId, { method: 'POST' });
      setOk('Usuário bloqueado.');
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <Top back />
      <div className="gallery">
        <div className="gallery-main">
          {img && <img src={img} alt={item.title} />}
          {item.images?.length > 1 && (
            <>
              <button
                type="button"
                className="opp-gallery-nav prev"
                onClick={() => setIdx((n) => (n === 0 ? item.images.length - 1 : n - 1))}
                aria-label="Foto anterior"
              >Anterior</button>
              <button
                type="button"
                className="opp-gallery-nav next"
                onClick={() => setIdx((n) => (n === item.images.length - 1 ? 0 : n + 1))}
                aria-label="Proxima foto"
              >Proxima</button>
              <span className="opp-gallery-count">{idx + 1} / {item.images.length}</span>
            </>
          )}
        </div>
        {item.images?.length > 1 && (
          <div className="thumbs">
            {item.images.map((im, i) => (
              <img key={im.id || i} className={i === idx ? 'on' : ''} src={im.url} onClick={() => setIdx(i)} alt="" />
            ))}
          </div>
        )}
      </div>
      <div className="page">
        {err && <div className="error">{err}</div>}
        {ok && <div className="okbox">{ok}</div>}
        <h1 style={{ fontSize: 22 }}>{item.title}</h1>
        <div className="badge-row">
          {item.isOfficial && <span className="badge-official">CATIRA OFICIAL</span>}
          {!item.isOfficial && item.listingType === 'procuro' && <span className="badge-want">PROCURO</span>}
          {!item.isOfficial && (item.listingType === 'troca' || item.listingType === 'venda_troca' || item.acceptsTrade) && item.listingType !== 'procuro' && <span className="badge-trade-inline">ACEITA TROCA</span>}
          {!item.isOfficial && item.premium && <span className="badge-premium-inline">PREMIUM</span>}
        </div>
        <div className="price-lg">{priceText(item)}</div>
        {item.ratingCount > 0 && (
          <div className="listing-stars">
            {'★'.repeat(Math.round(item.ratingAvg))}{'☆'.repeat(5 - Math.round(item.ratingAvg))}
            <span>{item.ratingAvg} · {item.ratingCount} {item.ratingCount === 1 ? 'avaliação' : 'avaliações'}</span>
          </div>
        )}
        <div className="meta">
          {item.isOfficial
            ? 'Produto oficial · ' + officialLocation(item) + ' · ' + conditionText(item.condition)
            : <>{typeLabel(item.listingType)} · {item.city}/MG · {item.listingType !== 'procuro' ? conditionText(item.condition) + ' · ' : ''}{item.timeAgo}</>}
        </div>
        {item.category && <div className="meta" style={{ marginTop: 4 }}>{item.category.name}{item.subcategory ? ' · ' + item.subcategory : ''}</div>}
        {mine && (
          <p className="hint">{item.views || 0} visualizações · {item.favoritesCount || 0} pessoas salvaram este anúncio</p>
        )}

        {!item.isOfficial && (item.listingType === 'troca' || item.listingType === 'venda_troca' || item.acceptsTrade) && item.listingType !== 'procuro' && (
          <div className="trade-box">
            <strong>ACEITA TROCA</strong>
            {item.tradeWishes && <p style={{ marginTop: 6 }}>Procura por: {item.tradeWishes}</p>}
            {item.acceptsCash && <p className="hint">Aceita dinheiro como parte da negociação.</p>}
            {!mine && <button className="btn btn-green" style={{ marginTop: 10 }} onClick={() => { if (!user) { nav('/entrar?next=' + encodeURIComponent(location.pathname)); return; } openTrade(); }}>Propor troca</button>}
          </div>
        )}

        <p style={{ marginTop: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.description}</p>

        {item.isOfficial && (
          <div className="seller official-seller">
            <div className="avatar official-avatar">C</div>
            <div>
              <strong>CATIRA OFICIAL</strong>
              <div className="verified">Produto vendido pela plataforma · {officialLocation(item)}</div>
            </div>
          </div>
        )}

        {item.seller && !item.isOfficial && (
          <Link to={'/usuario/' + item.seller.id} className="seller">
            <div className="avatar" style={{ background: item.seller.avatarColor }}>{item.seller.name.slice(0, 1)}</div>
            <div>
              <strong>{item.seller.name}</strong>
              <div className="verified">
                {item.seller.phoneVerified || item.seller.emailVerified ? 'Usuário verificado · ' : ''}
                {item.seller.city} · {item.seller.ratingCount ? `${item.seller.ratingAvg} (${item.seller.ratingCount})` : 'Novo no CATIRA'}
              </div>
            </div>
          </Link>
        )}

        {item.isOfficial && item.officialOffers && item.officialOffers.length > 0 && (
          <div className="official-buy">
            <strong>Onde comprar</strong>
            <p className="hint official-note">A compra é feita fora do Catira, na plataforma escolhida.</p>
            <div className="official-offers">
              {item.officialOffers.map((o) => (
                <a
                  key={o.id}
                  className={'btn official-offer provider-' + o.provider}
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  <span>{o.providerLabel}</span>
                  {!!o.price && (
                    <em>
                      {o.previousPrice && o.previousPrice > o.price ? <s>{money(o.previousPrice)}</s> : null}
                      {money(o.price)}
                    </em>
                  )}
                </a>
              ))}
            </div>
            <p className="hint official-note">Preço e disponibilidade podem mudar até a finalização no site do parceiro.</p>
          </div>
        )}
        {item.isOfficial && (
          <div className="row-btns">
            <button className="btn btn-ghost" onClick={fav}>{item.favorited ? 'Favoritado' : 'Favoritar'}</button>
            <button className="btn btn-ghost" onClick={share}>Compartilhar</button>
          </div>
        )}

        {!mine && !item.isOfficial && (
          <div className="actions">
            <>
              <button className="btn btn-primary" onClick={() => interest()}>Tenho interesse</button>
              <div className="quick-msgs">
                {['Olá! Ainda está disponível?', 'Você aceita troca?', 'Faz por R$ ___?', 'Tenho interesse.'].map((t) => (
                  <button key={t} type="button" className="chip" onClick={() => interest(t)}>{t}</button>
                ))}
              </div>
              <div className="row-btns">
                <button className="btn btn-dark" onClick={message}>Enviar mensagem</button>
                <button className="btn btn-wa" onClick={whatsapp}>Conversar pelo WhatsApp</button>
              </div>
            </>
             <div className="row-btns">
               <button className="btn btn-ghost" onClick={fav}>{item.favorited ? 'Favoritado' : 'Favoritar'}</button>
               <button className="btn btn-ghost" onClick={share}>Compartilhar</button>
             </div>
             <button className="btn btn-ghost" onClick={shareWhatsApp}>Enviar no WhatsApp</button>
             <div className="row-btns">
               <button className="btn btn-ghost" onClick={() => setShowReport(true)}>Denunciar</button>
               <button className="btn btn-ghost" onClick={block}>Bloquear usuário</button>
             </div>
             <p className="pay-alert">Não faça pagamentos antecipados para pessoas desconhecidas. Prefira negociar pessoalmente em local seguro.</p>
          </div>
        )}
        {mine && (
          <div className="row-btns">
            {['published', 'paused', 'awaiting_review', 'changes_requested'].includes(item.status) && (
              <Link className="btn btn-ghost" to={'/anunciar?edit=' + item.id}>{item.status === 'changes_requested' ? 'Corrigir anúncio' : 'Editar'}</Link>
            )}
            {['published', 'paused'].includes(item.status) && !item.premium && (
              <Link className="btn btn-ghost" to={'/turbinar/' + item.id}>Turbinar</Link>
            )}
            <Link className="btn btn-ghost" to="/meus-anuncios">Gerenciar anúncio</Link>
          </div>
        )}

        {!item.isOfficial && (
        <div className="review-box">
          <h2>Avaliações do anúncio</h2>
          {!mine && (
            <>
              <p className="hint">Diga o que achou deste anúncio.</p>
              <div className="stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>★</button>
                ))}
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Comentário (opcional)</label>
                <textarea value={revComment} onChange={(e) => setRevComment(e.target.value)} placeholder="Anúncio claro, fotos boas, preço justo." />
              </div>
              <button className="btn btn-primary" type="button" onClick={sendListingReview}>
                {item.myRating ? 'Atualizar avaliação' : 'Enviar avaliação'}
              </button>
            </>
          )}
          {!reviews.length && <p className="hint" style={{ marginTop: 12 }}>Nenhuma avaliação ainda.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="review-item">
              <strong>{r.user?.name || 'Usuário'}</strong>
              <div className="listing-stars">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
              {r.comment && <p>{r.comment}</p>}
            </div>
          ))}
        </div>
        )}
        <HomeAdBanner />
      </div>

      {showReport && (
        <div className="modal-bg" onClick={() => setShowReport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Denunciar anúncio</h3>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Motivo</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                {reportReasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Explique o motivo da denúncia.</label>
              <textarea value={repDesc} onChange={(e) => setRepDesc(e.target.value)} />
            </div>
            <button className="btn btn-danger" onClick={sendReport}>Enviar denúncia</button>
          </div>
        </div>
      )}

      {showTrade && (
        <div className="modal-bg" onClick={() => setShowTrade(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Propor troca</h3>
            <p className="hint">Você quer: {item.title}</p>
            {tradeErr && <div className="error">{tradeErr}</div>}
            <div className="field" style={{ marginTop: 12 }}>
              <label>Anúncio seu (opcional)</label>
              {myListings.length ? (
                <div className="trade-pick">
                  <button
                    type="button"
                    className={'trade-pick-item' + (!offerId ? ' on' : '')}
                    onClick={() => setOfferId('')}
                  >
                    Só descrever no texto
                  </button>
                  {myListings.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className={'trade-pick-item' + (offerId === l.id ? ' on' : '')}
                      onClick={() => setOfferId(l.id)}
                    >
                      {l.images && l.images[0] && <img src={l.images[0].url} alt="" />}
                      <span>
                        <strong>{l.title}</strong>
                        <em>{priceText(l)}</em>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint">Você não tem anúncio ativo. Descreva o que oferece no texto.</p>
              )}
            </div>
            <div className="field">
              <label>{offerId ? 'Complemento (opcional)' : 'O que você oferece?'}</label>
              <textarea
                value={tradeDesc}
                onChange={(e) => setTradeDesc(e.target.value)}
                placeholder="Ex.: Tenho uma TV 50 polegadas e posso voltar um valor."
              />
            </div>
            <div className="field">
              <label>Diferença em dinheiro (opcional)</label>
              <div className="cond">
                <label>
                  <input type="radio" name="extraDir" checked={extraDir === 'offer'} onChange={() => setExtraDir('offer')} />
                  <span>Eu ofereço a mais</span>
                </label>
                <label>
                  <input type="radio" name="extraDir" checked={extraDir === 'ask'} onChange={() => setExtraDir('ask')} />
                  <span>Eu peço a mais</span>
                </label>
              </div>
              <input
                value={extra}
                onChange={(e) => setExtra(formatBRLInput(e.target.value))}
                inputMode="numeric"
                placeholder="0,00"
              />
            </div>
            <button className="btn btn-green" onClick={sendTrade}>Enviar proposta</button>
          </div>
        </div>
      )}
    </>
  );
}
