import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, money } from '../api';
import { useAuth } from '../auth';
import { useCity } from '../city';
import { deliveryEta } from '../deliveryEta';
import { resolveGeoCity } from '../geoCity';
import { officialLocation } from '../components';

export default function OfficialProduct() {
  const { id } = useParams();
  const { user } = useAuth();
  const { city: chipCity } = useCity();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  const [geoCity, setGeoCity] = useState(chipCity || 'Corinto');

  useEffect(() => {
    api('/api/listings/' + id)
      .then(setItem)
      .catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => {
    if (!item || !item.isOfficial) return;
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    resolveGeoCity({ geolocation: geo, storage, fallbackCity: chipCity })
      .then(setGeoCity)
      .catch(() => setGeoCity(chipCity || 'Corinto'));
  }, [item, chipCity]);

  if (err && !item) {
    return (
      <div className="page">
        <div className="error">{err}</div>
      </div>
    );
  }
  if (!item) return <div className="page">Carregando...</div>;
  if (!item.isOfficial) return <Navigate to={'/anuncio/' + id} replace />;

  const images = item.images || [];
  const img = images[idx]?.url || images[0]?.url;
  const officialOffers = Array.isArray(item.officialOffers) ? item.officialOffers : [];
  const catiraOffer = officialOffers.find((o) => o.provider === 'catira');
  const externalOffers = officialOffers.filter((o) => o.provider !== 'catira');
  const eta = deliveryEta(geoCity);
  const price = catiraOffer && catiraOffer.price;
  const prev = catiraOffer && catiraOffer.previousPrice;

  function goCheckout() {
    if (!catiraOffer) return;
    const next = '/checkout?listing=' + item.id + '&offer=' + catiraOffer.id;
    if (!user) {
      nav('/entrar?next=' + encodeURIComponent(next));
      return;
    }
    nav(next);
  }

  async function fav() {
    if (!user) {
      nav('/entrar?next=' + encodeURIComponent(location.pathname));
      return;
    }
    try {
      const d = await api('/api/favorites/' + item.id, { method: 'POST' });
      setItem({ ...item, favorited: d.favorited });
    } catch (e) {
      setErr(e.message);
    }
  }

  async function share() {
    const url = window.location.href;
    api('/api/listings/' + item.id + '/share', { method: 'POST' }).catch(() => {});
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: item.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {}
  }

  return (
    <div className="pdp">
      <div className="pdp-gallery">
        {img ? <img src={img} alt={item.title} /> : <div className="pdp-gallery-empty" />}
        <button type="button" className="pdp-icon pdp-back" onClick={() => nav(-1)} aria-label="Voltar">
          ‹
        </button>
        <button type="button" className="pdp-icon pdp-share" onClick={share} aria-label="Compartilhar">
          ↗
        </button>
        {images.length > 0 && (
          <span className="pdp-count">
            {idx + 1}/{images.length}
          </span>
        )}
        {images.length > 1 && (
          <div className="pdp-dots">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                className={i === idx ? 'on' : ''}
                aria-label={'Foto ' + (i + 1)}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="pdp-body">
        <span className="badge-official">CATIRA OFICIAL</span>
        <h1 className="pdp-title">{item.title}</h1>
        {!!price && (
          <div className="pdp-price">
            {prev && prev > price ? <s>{money(prev)}</s> : null}
            <strong>{money(price)}</strong>
          </div>
        )}

        <div className="pdp-eta">
          <p className="pdp-eta-line">{eta.label}</p>
          <p className="hint">Prazo estimado, sujeito à confirmação do endereço na compra.</p>
        </div>

        {catiraOffer && catiraOffer.buyEnabled && (
          <button type="button" className="btn btn-primary pdp-buy" onClick={goCheckout}>
            Comprar pelo Catira
          </button>
        )}
        {catiraOffer && !catiraOffer.buyEnabled && (
          <p className="hint">Em preparação · compra pelo Catira ainda não está disponível.</p>
        )}

        {externalOffers.length > 0 && (
          <div className="pdp-ml">
            <p>Prefere comprar no Mercado Livre?</p>
            {externalOffers.map((o) => (
              <a
                key={o.id}
                className="btn btn-ghost"
                href={o.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {o.providerLabel || 'Comprar no Mercado Livre'}
              </a>
            ))}
          </div>
        )}

        {item.description && <p className="pdp-desc">{item.description}</p>}

        <div className="seller official-seller">
          <div className="avatar official-avatar">C</div>
          <div>
            <strong>CATIRA OFICIAL</strong>
            <div className="verified">Produto vendido pela plataforma · {officialLocation(item)}</div>
          </div>
        </div>

        <div className="row-btns">
          <button type="button" className="btn btn-ghost" onClick={fav}>
            {item.favorited ? 'Favoritado' : 'Favoritar'}
          </button>
        </div>
      </div>

      {catiraOffer && catiraOffer.buyEnabled && (
        <div className="pdp-cta">
          <button type="button" className="btn btn-primary" onClick={goCheckout}>
            Comprar pelo Catira
          </button>
        </div>
      )}
    </div>
  );
}
