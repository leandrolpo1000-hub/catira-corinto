import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, money, statusLabel, formatBRLInput, parseBRL, listingTypes } from '../api';
import { useAuth, isAdminRole, isMasterRole } from '../auth';
import { BrandLogo, Top } from '../components';
import AdminAuctions from './AdminAuctions';
import AdminIntelligence from './AdminIntelligence';
import AdminLance from './AdminLance';
import AdminOfficial from './AdminOfficial';

export default function Admin() {
  const { user } = useAuth();
  const isMaster = isMasterRole(user && user.role);
  const [tab, setTab] = useState(isMaster ? 'dash' : 'users');
  const [dash, setDash] = useState(null);
  const [users, setUsers] = useState([]);
  const [listings, setListings] = useState([]);
  const [reports, setReports] = useState([]);
  const [cats, setCats] = useState([]);
  const [catForm, setCatForm] = useState({ name: '', icon: 'gem' });
  const [pubs, setPubs] = useState([]);
  const [pubQ, setPubQ] = useState('');
  const [pubStatus, setPubStatus] = useState('');
  const [pubSort, setPubSort] = useState({ key: 'name', dir: 'asc' });
  const [pix, setPix] = useState({ pixKey: '', pixKeyType: 'email', merchantName: 'CATIRA CORINTO', merchantCity: 'CORINTO', fee: 5, vipListingFee: 15, vipAccessFee: 20, vipDays: 30, vipWhatsappGroup: '', highlightFee: 10, highlightDays: 7, feeEnabled: false, commonFeeEnabled: false, vipFeeEnabled: false, premiumFeeEnabled: true, configured: false });
  const [pixMsg, setPixMsg] = useState('');
  const [pixErr, setPixErr] = useState('');
  const pixSaveY = useRef(0);
  const [pays, setPays] = useState([]);
  const [reviewsAdmin, setReviewsAdmin] = useState([]);
  const [actionPosts, setActionPosts] = useState([]);
  const [promos, setPromos] = useState([]);
  const [promoForm, setPromoForm] = useState({ code: '', discountPercent: '100', maxUses: '' });
  const [promoErr, setPromoErr] = useState('');
  const [dashFilter, setDashFilter] = useState({ period: '7d', city: '', status: '', category: '' });
  const [dashCities, setDashCities] = useState([]);
  const [mail, setMail] = useState({ fromEmail: '', fromName: 'CATIRA', enabled: false, configured: false, apiKeySet: false, apiKeyHint: '', apiKey: '' });
  const [mailMsg, setMailMsg] = useState('');
  const [mailErr, setMailErr] = useState('');
  const [mailTestTo, setMailTestTo] = useState('');
  const [appmaxCfg, setAppmaxCfg] = useState({
    clientId: '',
    clientSecret: '',
    clientSecretSet: false,
    clientSecretHint: '',
    externalId: '',
    webhookConfigured: false,
    webhookUrl: '',
    env: 'production',
    source: {},
  });
  const [appmaxMsg, setAppmaxMsg] = useState('');
  const [appmaxErr, setAppmaxErr] = useState('');
  const [banner, setBanner] = useState({ enabled: false, imageUrl: '', link: '', title: '' });
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerMsg, setBannerMsg] = useState('');
  const [bannerErr, setBannerErr] = useState('');
  const [assist, setAssist] = useState({ enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKeySet: false, apiKeyHint: '', configured: false, apiKey: '' });
  const [assistMsg, setAssistMsg] = useState('');
  const [assistErr, setAssistErr] = useState('');
  const [previewAd, setPreviewAd] = useState(null);
  const [noteId, setNoteId] = useState('');
  const [noteAction, setNoteAction] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [adsStatus, setAdsStatus] = useState('');
  const [adsQ, setAdsQ] = useState('');
  const [adsCity, setAdsCity] = useState('');
  const [adsType, setAdsType] = useState('');
  const [adsPlan, setAdsPlan] = useState('');
  const [adsSeller, setAdsSeller] = useState('');
  const [openAd, setOpenAd] = useState('');
  const [editingAd, setEditingAd] = useState('');
  const [saveDraft, setSaveDraft] = useState(null);
  const [savePassword, setSavePassword] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [previewPhoto, setPreviewPhoto] = useState(0);
  const [userQ, setUserQ] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userCityFilter, setUserCityFilter] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('');
  const [orders, setOrders] = useState([]);
  const [orderDetail, setOrderDetail] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ((params.get('code') && params.get('state')) || params.get('tab') === 'oficial') {
      setTab('oficial');
      return;
    }
    if (isMaster && (tab === 'users' || tab === 'dash')) setTab('dash');
  }, [isMaster]);

  useLayoutEffect(() => {
    if (tab !== 'pix') return;
    const y = pixSaveY.current;
    if (!y) return;
    window.scrollTo(0, y);
  }, [tab, pixMsg, pixErr]);

  useEffect(() => {
    if (!user || !isAdminRole(user.role)) return;
    api('/api/auth/cities').then(setDashCities).catch(() => {});
    api('/api/admin/users').then((d) => setUsers(d.items || [])).catch(() => {});
    api('/api/admin/listings').then((d) => setListings(d.items || [])).catch(() => {});
    api('/api/admin/reports').then((d) => setReports(d.items || [])).catch(() => {});
    api('/api/admin/categories').then((d) => setCats(d.items || [])).catch(() => {});
    api('/api/admin/publications').then((d) => setPubs(d.items || [])).catch(() => {});
    api('/api/admin/payments').then((d) => setPays(d.items || [])).catch(() => {});
    api('/api/admin/promos').then((d) => setPromos(d.items || [])).catch(() => {});
    api('/api/admin/reviews').then((d) => setReviewsAdmin(d.items || [])).catch(() => {});
    api('/api/admin/acao').then((d) => setActionPosts(d.items || [])).catch(() => {});
    api('/api/admin/orders').then((d) => setOrders(d.items || [])).catch(() => {});
    if (user.role === 'master') {
      api('/api/admin/pix').then((d) => {
        setPix({
          ...d,
          commonFeeEnabled: d.commonFeeEnabled !== undefined ? !!d.commonFeeEnabled : !!d.feeEnabled,
          vipFeeEnabled: !!d.vipFeeEnabled,
          premiumFeeEnabled: d.premiumFeeEnabled !== undefined ? !!d.premiumFeeEnabled : true,
          feeLabel: formatBRLInput(String(Math.round(Number(d.fee || 5) * 100))),
          vipListingFeeLabel: formatBRLInput(String(Math.round(Number(d.vipListingFee || 15) * 100))),
          vipAccessFeeLabel: formatBRLInput(String(Math.round(Number(d.vipAccessFee || 20) * 100))),
          highlightFeeLabel: formatBRLInput(String(Math.round(Number(d.highlightFee || 10) * 100))),
          premiumDayFeeLabel: formatBRLInput(String(Math.round(Number(d.premiumDayFee || 30) * 100))),
        });
      }).catch(() => {});
      api('/api/admin/mail').then((d) => {
        setMail({ ...d, apiKey: '' });
        setMailTestTo((t) => t || user.email || '');
      }).catch(() => {});
      api('/api/admin/appmax').then((d) => setAppmaxCfg({ ...d, clientSecret: '' })).catch(() => {});
      api('/api/admin/banner').then(setBanner).catch(() => {});
      api('/api/admin/assistant').then((d) => setAssist({ ...d, apiKey: '' })).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== 'master') return;
    api('/api/admin/dashboard?period=' + dashFilter.period + '&city=' + encodeURIComponent(dashFilter.city) + '&status=' + encodeURIComponent(dashFilter.status) + '&category=' + encodeURIComponent(dashFilter.category || '')).then(setDash).catch(() => {});
  }, [user, dashFilter.period, dashFilter.city, dashFilter.status, dashFilter.category]);

  if (!user) return <Navigate to="/entrar?next=/admin" replace />;
  if (!isAdminRole(user.role)) return <Navigate to="/" replace />;

  function userProfileLabel(u) {
    if (u.role === 'master') return 'Admin master';
    if (u.role === 'admin') return 'Intermediador';
    if (u.dealerStatus === 'approved') return 'Catireiro';
    return 'Comum';
  }

  const userCities = Array.from(new Set(users.map((u) => u.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const userRows = users.filter((u) => {
    const hay = [u.name, u.email, u.city, u.phone, u.role, u.status].join(' ').toLowerCase();
    if (userQ && !hay.includes(userQ.trim().toLowerCase())) return false;
    if (userRoleFilter === 'user' && (u.role !== 'user' || u.dealerStatus === 'approved')) return false;
    if (userRoleFilter === 'dealer' && !(u.role === 'user' && u.dealerStatus === 'approved')) return false;
    if (userRoleFilter === 'admin' && u.role !== 'admin') return false;
    if (userRoleFilter === 'master' && u.role !== 'master') return false;
    if (userCityFilter && u.city !== userCityFilter) return false;
    if (userStatusFilter && u.status !== userStatusFilter) return false;
    return true;
  });

  async function userStatus(id, status) {
    await api('/api/admin/users/' + id + '/status', { method: 'POST', body: JSON.stringify({ status }) });
    const d = await api('/api/admin/users');
    setUsers(d.items || []);
  }

  async function userRole(id, role) {
    await api('/api/admin/users/' + id + '/role', { method: 'POST', body: JSON.stringify({ role }) });
    const d = await api('/api/admin/users');
    setUsers(d.items || []);
  }

  function adPlan(l) {
    if (l.premium || l.plan === 'premium') return 'premium';
    if (l.vip || l.plan === 'vip' || l.plan === 'destaque' || l.featured) return 'destaque';
    return 'comum';
  }

  const adsCities = Array.from(new Set(listings.map((l) => l.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const adsSellers = Array.from(new Set(listings.map((l) => (l.seller && l.seller.name) || '').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const adsRows = listings.filter((l) => {
    if (adsStatus === 'quick') {
      if (!l.quickOfferEnabled) return false;
    } else if (adsStatus && l.status !== adsStatus) {
      return false;
    }
    const hay = [l.title, l.city, l.seller && l.seller.name, l.seller && l.seller.email, l.id, l.listingType, l.listingTypeLabel].join(' ').toLowerCase();
    if (adsQ && !hay.includes(adsQ.trim().toLowerCase())) return false;
    if (adsCity && l.city !== adsCity) return false;
    if (adsType && (l.listingType || 'venda') !== adsType) return false;
    if (adsPlan && adPlan(l) !== adsPlan) return false;
    if (adsSeller && ((l.seller && l.seller.name) || '') !== adsSeller) return false;
    return true;
  });

  async function listingAct(id, action, extra) {
    await api('/api/admin/listings/' + id + '/action', { method: 'POST', body: JSON.stringify({ action, ...(extra || {}) }) });
    const d = await api('/api/admin/listings');
    setListings(d.items || []);
  }

  function openNote(id, action, current) {
    setNoteId(id);
    setNoteAction(action);
    setNoteText(current || '');
    setNoteErr('');
  }

  function closeNote() {
    setNoteId('');
    setNoteAction('');
    setNoteText('');
    setNoteErr('');
  }

  async function submitNote(e) {
    e.preventDefault();
    const note = noteText.trim();
    if (!note) {
      setNoteErr(noteAction === 'remove'
        ? 'Escreva o motivo da remoção para o anunciante.'
        : 'Escreva o comentário da recusa para o anunciante corrigir.');
      return;
    }
    setNoteErr('');
    await listingAct(noteId, noteAction, { note });
    closeNote();
  }

  async function reportStatus(id, status) {
    await api('/api/admin/reports/' + id + '/status', { method: 'POST', body: JSON.stringify({ status }) });
    const d = await api('/api/admin/reports');
    setReports(d.items || []);
  }

  async function addCat(e) {
    e.preventDefault();
    await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(catForm) });
    setCatForm({ name: '', icon: 'gem' });
    const d = await api('/api/admin/categories');
    setCats(d.items || []);
  }

  async function saveCat(c) {
    await api('/api/admin/categories/' + c.id, { method: 'PUT', body: JSON.stringify(c) });
    const d = await api('/api/admin/categories');
    setCats(d.items || []);
  }

  async function delCat(id) {
    await api('/api/admin/categories/' + id, { method: 'DELETE' });
    const d = await api('/api/admin/categories');
    setCats(d.items || []);
  }

  async function moveCat(i, dir) {
    const next = cats.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    await api('/api/admin/categories/reorder', { method: 'POST', body: JSON.stringify({ ids: next.map((c) => c.id) }) });
    setCats(next.map((c, idx) => ({ ...c, order: idx + 1 })));
  }

  function sortPubs(key) {
    setPubSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }

  function pubVal(row, key) {
    if (key === 'listingId') return (row.listingCode || row.listingId || '').toString();
    if (key === 'title') return row.title || '';
    if (key === 'name') return row.name || '';
    if (key === 'email') return row.email || '';
    if (key === 'phone') return row.phoneFormatted || row.phone || '';
    if (key === 'address') return row.address || '';
    if (key === 'price') return Number(row.price) || 0;
    if (key === 'status') return statusLabel[row.status] || row.status || '';
    return '';
  }

  const pubRows = pubs
    .filter((r) => {
      const hay = [r.name, r.email, r.phone, r.address, r.listingId, r.title].join(' ').toLowerCase();
      if (pubQ && !hay.includes(pubQ.toLowerCase())) return false;
      if (pubStatus && r.status !== pubStatus) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const av = pubVal(a, pubSort.key);
      const bv = pubVal(b, pubSort.key);
      if (typeof av === 'number' && typeof bv === 'number') {
        return pubSort.dir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return pubSort.dir === 'asc' ? -1 : 1;
      if (as > bs) return pubSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

  function pubHead(key, label) {
    const on = pubSort.key === key;
    return (
      <th className="sortable" onClick={() => sortPubs(key)}>
        {label}{on ? (pubSort.dir === 'asc' ? ' ^' : ' v') : ''}
      </th>
    );
  }

  return (
    <>
      <Top title={isMaster ? 'Admin master' : 'Admin'} />
      <div className="page">
        <div className="brand-center"><BrandLogo size="sm" /></div>
        <div className="chips">
          {(isMaster
            ? [['dash', 'Catira Intelligence'], ['pix', 'PIX'], ['appmax', 'Appmax'], ['mail', 'E-mail'], ['assist', 'Assistente'], ['leilao', 'Leilão'], ['lance', 'Oportunidades'], ['banner', 'Banner'], ['promo', 'Cupons'], ['pays', 'Pagamentos'], ['pedidos', 'Pedidos'], ['rel', 'Relatórios'], ['users', 'Usuários'], ['ads', 'Anúncios'], ['acao', 'Em Ação'], ['rep', 'Denúncias'], ['rev', 'Avaliações'], ['cat', 'Categorias'], ['oficial', 'Oficial']]
            : [['leilao', 'Leilão'], ['lance', 'Oportunidades'], ['promo', 'Cupons'], ['pays', 'Pagamentos'], ['pedidos', 'Pedidos'], ['rel', 'Relatórios'], ['users', 'Usuários'], ['ads', 'Anúncios'], ['acao', 'Em Ação'], ['rep', 'Denúncias'], ['rev', 'Avaliações'], ['cat', 'Categorias'], ['oficial', 'Oficial']]
          ).map(([k, l]) => (
            <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === 'dash' && isMaster && (
          <AdminIntelligence
            dash={dash}
            dashFilter={dashFilter}
            setDashFilter={setDashFilter}
            dashCities={dashCities}
            cats={cats}
            user={user}
          />
        )}

        {tab === 'pix' && isMaster && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Cobrança e PIX</h2>
            <p className="lead">Ative só os planos que devem cobrar. Os demais publicam grátis. A plaquinha da home aparece só com anúncio comum cobrado.</p>
            {pixErr && <div className="error">{pixErr}</div>}
            {pixMsg && <div className="okbox">{pixMsg}</div>}
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              pixSaveY.current = window.scrollY || 0;
              setPixErr('');
              setPixMsg('');
              try {
                const d = await api('/api/admin/pix', {
                  method: 'PUT',
                  body: JSON.stringify({
                    commonFeeEnabled: !!pix.commonFeeEnabled,
                    vipFeeEnabled: !!pix.vipFeeEnabled,
                    premiumFeeEnabled: !!pix.premiumFeeEnabled,
                    pixKey: pix.pixKey,
                    pixKeyType: pix.pixKeyType,
                    merchantName: pix.merchantName,
                    merchantCity: pix.merchantCity,
                    fee: parseBRL(pix.feeLabel),
                    vipListingFee: parseBRL(pix.vipListingFeeLabel),
                     vipAccessFee: parseBRL(pix.vipAccessFeeLabel),
                     vipDays: pix.vipDays,
                     vipWhatsappGroup: pix.vipWhatsappGroup || '',
                     highlightFee: parseBRL(pix.highlightFeeLabel),
                     highlightDays: pix.highlightDays,
                     premiumDayFee: parseBRL(pix.premiumDayFeeLabel),
                   }),
                 });
                 setPix({
                   ...d,
                   commonFeeEnabled: !!d.commonFeeEnabled,
                   vipFeeEnabled: !!d.vipFeeEnabled,
                   premiumFeeEnabled: !!d.premiumFeeEnabled,
                   feeLabel: formatBRLInput(String(Math.round(Number(d.fee || 5) * 100))),
                   vipListingFeeLabel: formatBRLInput(String(Math.round(Number(d.vipListingFee || 15) * 100))),
                   vipAccessFeeLabel: formatBRLInput(String(Math.round(Number(d.vipAccessFee || 20) * 100))),
                   highlightFeeLabel: formatBRLInput(String(Math.round(Number(d.highlightFee || 10) * 100))),
                   premiumDayFeeLabel: formatBRLInput(String(Math.round(Number(d.premiumDayFee || 30) * 100))),
                 });
                setPixMsg('PIX e taxas salvos. O valor e o código de pagamento já valem em todo o site.');
                requestAnimationFrame(() => {
                  window.scrollTo(0, pixSaveY.current);
                });
              } catch (ex) {
                setPixErr(ex.message);
                requestAnimationFrame(() => {
                  window.scrollTo(0, pixSaveY.current);
                });
              }
            }}>
              <div className="field">
                <label>Cobrança por tipo de anúncio</label>
                <div className="fee-toggles">
                  {[
                    { key: 'commonFeeEnabled', name: 'Anúncio comum', desc: 'Anúncio normal do dia a dia', price: pix.feeLabel },
                     { key: 'vipFeeEnabled', name: 'Anúncio em destaque', desc: 'Aparece na frente na home e na busca', price: pix.vipListingFeeLabel },
                    { key: 'premiumFeeEnabled', name: 'Anúncio Premium', desc: 'Aparece no domingo, por dia escolhido', price: pix.premiumDayFeeLabel },
                  ].map((plan) => (
                    <label key={plan.key} className={'fee-toggle' + (pix[plan.key] ? ' on' : '')}>
                      <span className="fee-toggle-info">
                        <strong>{plan.name}</strong>
                        <small>{plan.desc}</small>
                        <span className={'fee-toggle-price' + (pix[plan.key] ? ' charged' : '')}>
                          {pix[plan.key] ? (plan.price ? 'Cobra R$ ' + plan.price : 'Cobrança ligada') : 'Grátis'}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={!!pix[plan.key]}
                        onChange={(e) => {
                          const patch = { [plan.key]: e.target.checked };
                          if (plan.key === 'commonFeeEnabled') patch.feeEnabled = e.target.checked;
                          setPix({ ...pix, ...patch });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="hint">
                  {pix.commonFeeEnabled || pix.vipFeeEnabled || pix.premiumFeeEnabled
                    ? 'Só os planos ligados pedem PIX. Os desligados publicam de graça. Você pode mudar cada um sem mexer nos outros.'
                    : 'Nenhum plano cobra. Publicar qualquer anúncio é grátis e a plaquinha da home some.'}
                </div>
              </div>
              <div className="field">
                <label>Tipo da chave</label>
                <select value={pix.pixKeyType} onChange={(e) => setPix({ ...pix, pixKeyType: e.target.value })}>
                  <option value="email">E-mail</option>
                  <option value="phone">Celular</option>
                  <option value="cpf">CPF</option>
                  <option value="cnpj">CNPJ</option>
                  <option value="random">Chave aleatória</option>
                </select>
              </div>
              <div className="field">
                <label>Chave PIX</label>
                <input
                  value={pix.pixKey}
                  onChange={(e) => setPix({ ...pix, pixKey: e.target.value })}
                  required={!!(pix.commonFeeEnabled || pix.vipFeeEnabled || pix.premiumFeeEnabled)}
                  placeholder="Sua chave para receber a taxa"
                />
              </div>
              <div className="field">
                <label>Valor da taxa (R$)</label>
                <input
                  value={pix.feeLabel || ''}
                  onChange={(e) => setPix({ ...pix, feeLabel: formatBRLInput(e.target.value) })}
                  inputMode="numeric"
                  required
                  placeholder="0,00"
                />
                <div className="hint">Esse valor atualiza a plaquinha, os textos e o código PIX automaticamente.</div>
              </div>
              <div className="field">
                <label>Taxa do anúncio em destaque (R$)</label>
                <input
                  value={pix.vipListingFeeLabel || ''}
                  onChange={(e) => setPix({ ...pix, vipListingFeeLabel: formatBRLInput(e.target.value) })}
                  inputMode="numeric"
                  required
                  placeholder="0,00"
                />
              </div>
              <div className="field">
                  <label>Preço do destaque (R$)</label>
                <input
                  value={pix.highlightFeeLabel || ''}
                  onChange={(e) => setPix({ ...pix, highlightFeeLabel: formatBRLInput(e.target.value) })}
                  inputMode="numeric"
                  required
                  placeholder="0,00"
                />
              </div>
              <div className="field">
                <label>Duração do destaque (dias)</label>
                <input
                  value={pix.highlightDays || ''}
                  onChange={(e) => setPix({ ...pix, highlightDays: e.target.value.replace(/\D/g, '') })}
                  inputMode="numeric"
                  required
                  placeholder="7"
                />
                <div className="hint">Dias em que o anúncio fica na seção de destaque e no topo da listagem.</div>
              </div>
              <div className="field">
                <label>Valor do dia Premium (R$)</label>
                <input
                  value={pix.premiumDayFeeLabel || ''}
                  onChange={(e) => setPix({ ...pix, premiumDayFeeLabel: formatBRLInput(e.target.value) })}
                  inputMode="numeric"
                  required
                  placeholder="0,00"
                />
                <div className="hint">Domingo cobra o valor cheio. Sábado 2/3. Segunda a sexta 1/3. A pessoa escolhe os dias na hora de anunciar.</div>
              </div>
              <div className="field">
                <label>Nome no PIX (até 25 caracteres)</label>
                <input value={pix.merchantName} onChange={(e) => setPix({ ...pix, merchantName: e.target.value })} />
              </div>
              <div className="field">
                <label>Cidade</label>
                <input value={pix.merchantCity} onChange={(e) => setPix({ ...pix, merchantCity: e.target.value })} />
              </div>
              <button className="btn btn-primary">Salvar PIX e taxa</button>
            </form>
            <p className="hint">{pix.configured ? 'PIX configurado. QR Code e copia e cola já usam esta chave.' : 'Ainda não há chave. Sem ela o anunciante não consegue pagar.'}</p>
          </>
        )}

        {tab === 'appmax' && isMaster && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Appmax</h2>
            <p className="lead">Cole Client ID, Client Secret e External ID do painel Merchant da Appmax (produção). O Catira gera o token do webhook. Checkout público continua fechado.</p>
            {appmaxErr && <div className="error">{appmaxErr}</div>}
            {appmaxMsg && <div className="okbox">{appmaxMsg}</div>}
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              setAppmaxErr('');
              setAppmaxMsg('');
              try {
                const body = {
                  clientId: appmaxCfg.clientId,
                  externalId: appmaxCfg.externalId,
                };
                if (appmaxCfg.clientSecret && appmaxCfg.clientSecret.trim()) body.clientSecret = appmaxCfg.clientSecret.trim();
                const d = await api('/api/admin/appmax', { method: 'PUT', body: JSON.stringify(body) });
                setAppmaxCfg({ ...d, clientSecret: '' });
                if (d.authTest && d.authTest.ok) setAppmaxMsg('Login na Appmax ok.');
                else setAppmaxMsg((d.authTest && d.authTest.error) || 'Configuração salva, mas o login na Appmax falhou.');
              } catch (ex) {
                setAppmaxErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Client ID</label>
                <input
                  value={appmaxCfg.clientId || ''}
                  onChange={(e) => setAppmaxCfg({ ...appmaxCfg, clientId: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label>Client Secret</label>
                <input
                  type="password"
                  value={appmaxCfg.clientSecret || ''}
                  onChange={(e) => setAppmaxCfg({ ...appmaxCfg, clientSecret: e.target.value })}
                  placeholder={appmaxCfg.clientSecretHint || ''}
                  autoComplete="off"
                />
                <div className="hint">{appmaxCfg.clientSecretSet ? 'Secret salvo: ' + appmaxCfg.clientSecretHint + '. Deixe em branco para manter.' : 'Copie o Client Secret no card da loja (admin.appmax.com.br, menu API). Aparece uma vez; não é o External ID.'}</div>
              </div>
              <div className="field">
                <label>External ID</label>
                <input
                  value={appmaxCfg.externalId || ''}
                  onChange={(e) => setAppmaxCfg({ ...appmaxCfg, externalId: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <button className="btn btn-primary">Salvar Appmax</button>
            </form>
            {appmaxCfg.webhookUrl ? (
              <div className="field">
                <label>URL do webhook (cole no painel Appmax)</label>
                <input readOnly value={appmaxCfg.webhookUrl} />
                <div className="hint">Troque SEU-DOMINIO pelo endereço HTTPS público quando existir. Localhost a Appmax não alcança.</div>
              </div>
            ) : null}
            <p className="hint">
              Client ID: {appmaxCfg.clientId ? 'salvo' : 'faltando'}.
              Secret: {appmaxCfg.clientSecretSet ? 'salvo' : 'faltando'}.
              External ID: {appmaxCfg.externalId ? 'salvo' : 'faltando'}.
              Webhook: {appmaxCfg.webhookConfigured ? 'salvo' : 'faltando'}.
            </p>
          </>
        )}

        {tab === 'mail' && isMaster && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>E-mail (Resend)</h2>
            <p className="lead">Cole a API key do Resend e o e-mail remetente. Com isso ativo, o código de confirmação chega no e-mail do usuário.</p>
            {mailErr && <div className="error">{mailErr}</div>}
            {mailMsg && <div className="okbox">{mailMsg}</div>}
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              setMailErr('');
              setMailMsg('');
              try {
                const body = {
                  enabled: !!mail.enabled,
                  fromEmail: mail.fromEmail,
                  fromName: mail.fromName,
                };
                if (mail.apiKey && mail.apiKey.trim()) body.apiKey = mail.apiKey.trim();
                const d = await api('/api/admin/mail', { method: 'PUT', body: JSON.stringify(body) });
                setMail({ ...d, apiKey: '' });
                setMailMsg(d.enabled && d.configured ? 'Resend salvo e ativo.' : 'Configuração salva.');
              } catch (ex) {
                setMailErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Envio pelo Resend</label>
                <div className="cond">
                  <label><input type="radio" name="mailEnabled" checked={!mail.enabled} onChange={() => setMail({ ...mail, enabled: false })} /><span>Desligado</span></label>
                  <label><input type="radio" name="mailEnabled" checked={!!mail.enabled} onChange={() => setMail({ ...mail, enabled: true })} /><span>Ativo</span></label>
                </div>
                <div className="hint">
                  {mail.enabled
                    ? 'Ativo: o código de confirmação vai pelo Resend.'
                    : 'Desligado: o código aparece na tela se o e-mail não sair.'}
                </div>
              </div>
              <div className="field">
                <label>API key</label>
                <input
                  type="password"
                  value={mail.apiKey || ''}
                  onChange={(e) => setMail({ ...mail, apiKey: e.target.value })}
                  placeholder={mail.apiKeyHint || 're_xxxxxxxx'}
                  autoComplete="off"
                />
                <div className="hint">{mail.apiKeySet ? 'Key salva: ' + mail.apiKeyHint + '. Deixe em branco para manter.' : 'Crie em resend.com, em API Keys.'}</div>
              </div>
              <div className="field">
                <label>E-mail remetente</label>
                <input
                  type="email"
                  value={mail.fromEmail || ''}
                  onChange={(e) => setMail({ ...mail, fromEmail: e.target.value })}
                  placeholder="nao-responda@seudominio.com"
                />
                <div className="hint">Tem de ser um remetente verificado no Resend. No plano grátis use o de teste, tipo voce@seusite.com.</div>
              </div>
              <div className="field">
                <label>Nome do remetente</label>
                <input value={mail.fromName || ''} onChange={(e) => setMail({ ...mail, fromName: e.target.value })} placeholder="CATIRA" />
              </div>
              <button className="btn btn-primary">Salvar Resend</button>
            </form>
            <form className="filters" style={{ marginTop: 12 }} onSubmit={async (e) => {
              e.preventDefault();
              setMailErr('');
              setMailMsg('');
              try {
                const d = await api('/api/admin/mail/test', { method: 'POST', body: JSON.stringify({ to: mailTestTo }) });
                setMailMsg(d.message);
              } catch (ex) {
                setMailErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Enviar e-mail de teste</label>
                <input type="email" value={mailTestTo} onChange={(e) => setMailTestTo(e.target.value)} placeholder="seu@email.com" required />
              </div>
              <button className="btn btn-ghost" type="submit">Enviar teste</button>
            </form>
            <p className="hint">{mail.configured ? (mail.enabled ? 'Resend configurado e ativo.' : 'Resend salvo, mas ainda desligado.') : 'Ainda falta API key e remetente.'}</p>
          </>
        )}

        {tab === 'leilao' && <AdminAuctions user={user} />}

        {tab === 'lance' && <AdminLance user={user} />}
        {tab === 'oficial' && <AdminOfficial user={user} />}

        {tab === 'assist' && isMaster && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Assistente de anúncio</h2>
            <p className="lead">
              Com o assistente ativo, o anunciante envia a foto primeiro e recebe sugestão de título, descrição e categoria.
              Use uma API compatível com OpenAI (chat completions) que aceite imagem, como GPT-4o mini.
            </p>
            {assistErr && <div className="error">{assistErr}</div>}
            {assistMsg && <div className="okbox">{assistMsg}</div>}
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              setAssistErr('');
              setAssistMsg('');
              try {
                const body = {
                  enabled: !!assist.enabled,
                  baseUrl: assist.baseUrl,
                  model: assist.model,
                };
                if (assist.apiKey && assist.apiKey.trim()) body.apiKey = assist.apiKey.trim();
                const d = await api('/api/admin/assistant', { method: 'PUT', body: JSON.stringify(body) });
                setAssist({ ...d, apiKey: '' });
                setAssistMsg(d.enabled && d.apiKeySet ? 'Assistente salvo e ativo.' : 'Configuração salva.');
              } catch (ex) {
                setAssistErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Assistente nos anúncios</label>
                <div className="cond">
                  <label><input type="radio" name="assistEnabled" checked={!assist.enabled} onChange={() => setAssist({ ...assist, enabled: false })} /><span>Desligado</span></label>
                  <label><input type="radio" name="assistEnabled" checked={!!assist.enabled} onChange={() => setAssist({ ...assist, enabled: true })} /><span>Ativo</span></label>
                </div>
                <div className="hint">
                  {assist.enabled
                    ? 'Ativo: o anunciante vê o assistente ao criar o anúncio.'
                    : 'Desligado: o assistente não aparece para o anunciante.'}
                </div>
              </div>
              <div className="field">
                <label>API key</label>
                <input
                  type="password"
                  value={assist.apiKey || ''}
                  onChange={(e) => setAssist({ ...assist, apiKey: e.target.value })}
                  placeholder={assist.apiKeyHint || 'sk-xxxxxxxx'}
                  autoComplete="off"
                />
                <div className="hint">{assist.apiKeySet ? 'Key salva: ' + assist.apiKeyHint + '. Deixe em branco para manter.' : 'Use a chave da sua conta na provedora de IA.'}</div>
              </div>
              <div className="field">
                <label>URL da API</label>
                <input value={assist.baseUrl || ''} onChange={(e) => setAssist({ ...assist, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
                <div className="hint">Endereço base compatível com OpenAI. O código chama /chat/completions.</div>
              </div>
              <div className="field">
                <label>Modelo</label>
                <input value={assist.model || ''} onChange={(e) => setAssist({ ...assist, model: e.target.value })} placeholder="gpt-4o-mini" />
                <div className="hint">Precisa enxergar imagens. Ex.: gpt-4o-mini.</div>
              </div>
              <button className="btn btn-primary">Salvar assistente</button>
            </form>
          </>
        )}

        {tab === 'banner' && isMaster && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Banner da home</h2>
            <p className="lead">Aparece acima das categorias. Desligar esconde na home, mas a imagem, o link e o texto continuam salvos para reativar depois.</p>
            {bannerErr && <div className="error">{bannerErr}</div>}
            {bannerMsg && <div className="okbox">{bannerMsg}</div>}
            {banner.imageUrl && (
              <div className="home-ad-preview">
                <img src={banner.imageUrl} alt={banner.title || 'Banner'} />
              </div>
            )}
            {banner.imageUrl && (
              <p className="hint">{banner.enabled ? 'Este banner está na home.' : 'Banner salvo e oculto. Escolha Ativo e salve para mostrar de novo, sem enviar a imagem outra vez.'}</p>
            )}
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              setBannerErr('');
              setBannerMsg('');
              try {
                const fd = new FormData();
                fd.append('enabled', banner.enabled ? 'true' : 'false');
                fd.append('link', banner.link || '');
                fd.append('title', banner.title || '');
                if (bannerFile) fd.append('image', bannerFile);
                const d = await api('/api/admin/banner', { method: 'PUT', body: fd });
                setBanner(d);
                setBannerFile(null);
                e.target.querySelector('input[type="file"]').value = '';
                setBannerMsg(d.enabled ? 'Banner ativo na home. Imagem e link ficam salvos.' : 'Banner salvo e oculto. Você pode reativar quando quiser, sem enviar a imagem de novo.');
              } catch (ex) {
                setBannerErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Exibir na home</label>
                <div className="cond">
                  <label><input type="radio" name="bannerEnabled" checked={!banner.enabled} onChange={() => setBanner({ ...banner, enabled: false })} /><span>Desligado</span></label>
                  <label><input type="radio" name="bannerEnabled" checked={!!banner.enabled} onChange={() => setBanner({ ...banner, enabled: true })} /><span>Ativo</span></label>
                </div>
                <div className="hint">
                  {banner.enabled
                    ? 'Ativo: o banner aparece acima das categorias.'
                    : 'Desligado: a home fica sem o banner. A arte e o link continuam guardados.'}
                </div>
              </div>
              <div className="field">
                <label>Imagem</label>
                <input type="file" accept="image/*" onChange={(e) => setBannerFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                <div className="hint">JPG ou PNG. Largura larga fica melhor no celular. {banner.imageUrl ? 'Imagem já está salva. Só envie outra se quiser trocar.' : 'Obrigatório para ativar.'}</div>
              </div>
              <div className="field">
                <label>Link ao clicar</label>
                <input value={banner.link || ''} onChange={(e) => setBanner({ ...banner, link: e.target.value })} placeholder="https://... ou /anuncio/ID" />
                <div className="hint">Página interna (ex.: /anunciar) ou site externo (https://...).</div>
              </div>
              <div className="field">
                <label>Texto alternativo (opcional)</label>
                <input value={banner.title || ''} onChange={(e) => setBanner({ ...banner, title: e.target.value })} placeholder="Nome da campanha" />
              </div>
              <button className="btn btn-primary">Salvar banner</button>
            </form>
          </>
        )}

        {tab === 'promo' && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Códigos promocionais</h2>
            <p className="lead">Crie a chave e o percentual de desconto na taxa. 100% publica o anúncio sem PIX.</p>
            {promoErr && <div className="error">{promoErr}</div>}
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              setPromoErr('');
              try {
                await api('/api/admin/promos', {
                  method: 'POST',
                  body: JSON.stringify({
                    code: promoForm.code,
                    discountPercent: Number(String(promoForm.discountPercent).replace(',', '.')),
                    maxUses: promoForm.maxUses,
                  }),
                });
                setPromoForm({ code: '', discountPercent: '100', maxUses: '' });
                const d = await api('/api/admin/promos');
                setPromos(d.items || []);
              } catch (ex) {
                setPromoErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Chave do código</label>
                <input value={promoForm.code} onChange={(e) => setPromoForm({ ...promoForm, code: e.target.value.toUpperCase() })} required placeholder="Ex.: CATIRA100" />
              </div>
              <div className="field">
                <label>Desconto (%)</label>
                <input value={promoForm.discountPercent} onChange={(e) => setPromoForm({ ...promoForm, discountPercent: e.target.value })} inputMode="numeric" required placeholder="100" />
              </div>
              <div className="field">
                <label>Limite de usos (0 = ilimitado)</label>
                <input value={promoForm.maxUses} onChange={(e) => setPromoForm({ ...promoForm, maxUses: e.target.value })} inputMode="numeric" placeholder="0" />
              </div>
              <button className="btn btn-primary">Criar código</button>
            </form>
            {promos.map((p) => (
              <div key={p.id} className="list-item" style={{ flexDirection: 'column' }}>
                <strong>{p.code}</strong>
                <div className="meta">{p.discountPercent}% de desconto · usados {p.usedCount || 0}{p.maxUses ? ' / ' + p.maxUses : ''}</div>
                <span className={'status ' + (p.active === false ? 'paused' : 'published')}>{p.active === false ? 'Inativo' : 'Ativo'}</span>
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={async () => {
                  await api('/api/admin/promos/' + p.id + '/toggle', { method: 'POST', body: JSON.stringify({}) });
                  const d = await api('/api/admin/promos');
                  setPromos(d.items || []);
                }}>{p.active === false ? 'Ativar' : 'Desativar'}</button>
              </div>
            ))}
          </>
        )}

        {tab === 'pays' && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Pagamentos PIX</h2>
            <p className="lead">Confirme só depois que a taxa cair na sua conta. Anúncio pago vai para revisão na aba Anúncios.</p>
            {pays.map((p) => (
              <div key={p.id} className="list-item" style={{ flexDirection: 'column' }}>
                <strong>
                  {(p.listing?.title || 'Anúncio') + (p.kind === 'vip_listing' || p.listing?.vip || p.listing?.featured ? ' (Destaque)' : '')}
                </strong>
                <div className="meta">{money(p.amount)} · {p.user?.name} · {p.user?.email} · {p.user?.phone}</div>
                <div className="hint">ID pagamento: {p.id} · Tx: {p.transactionId}</div>
                <span className={'status ' + (p.status === 'awaiting_confirmation' ? 'awaiting_payment' : p.status)}>
                  {statusLabel[p.status] || p.status}
                </span>
                {p.status !== 'paid' && (
                  <div className="row-btns" style={{ marginTop: 8 }}>
                    <button className="btn btn-green" onClick={async () => {
                      await api('/api/admin/payments/' + p.id + '/confirm', { method: 'POST', body: JSON.stringify({}) });
                      const d = await api('/api/admin/payments');
                      setPays(d.items || []);
                      api('/api/admin/publications').then((x) => setPubs(x.items || [])).catch(() => {});
                      api('/api/admin/users').then((x) => setUsers(x.items || [])).catch(() => {});
                      const ads = await api('/api/admin/listings');
                      setListings(ads.items || []);
                      setTab('ads');
                      setAdsStatus('awaiting_review');
                      setOpenAd(p.listingId || (p.listing && p.listing.id) || '');
                    }}>Confirmar pagamento</button>
                    <button className="btn btn-ghost" onClick={async () => {
                      await api('/api/admin/payments/' + p.id + '/reject', { method: 'POST', body: JSON.stringify({}) });
                      const d = await api('/api/admin/payments');
                      setPays(d.items || []);
                    }}>Recusar</button>
                  </div>
                )}
              </div>
            ))}
            {!pays.length && <p className="hint">Nenhum pagamento ainda.</p>}
          </>
        )}

        {tab === 'pedidos' && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Pedidos Catira</h2>
            <p className="lead">Consulta interna. Compra pelo Catira ainda não está disponível.</p>
            {orders.map((o) => (
              <div key={o.id} className="list-item" style={{ flexDirection: 'column' }}>
                <strong>{o.productTitle || 'Pedido'}</strong>
                <div className="meta">{money((o.totalCents || 0) / 100)} · qtd {o.quantity} · {o.status}</div>
                <div className="hint">
                  {o.paymentMethod === 'credit_card' ? 'Cartão' : o.paymentMethod === 'pix' ? 'Pix' : 'Sem cobrança'}
                  {o.appmaxOrderId != null ? ' · Pedido Appmax ' + o.appmaxOrderId : ''}
                  {o.appmaxPaymentStatus ? ' · Status Appmax ' + o.appmaxPaymentStatus : ''}
                  {o.cardInstallments ? ' · Parcelas ' + o.cardInstallments : ''}
                </div>
                <div className="hint">ID {o.id}</div>
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={async () => {
                  const d = await api('/api/admin/orders/' + o.id);
                  setOrderDetail(d);
                }}>Ver detalhes</button>
              </div>
            ))}
            {!orders.length && <p className="hint">Nenhum pedido ainda.</p>}
            {orderDetail && orderDetail.order && (
              <div className="card" style={{ marginTop: 12 }}>
                <strong>Pedido {orderDetail.order.id}</strong>
                <p className="hint">{orderDetail.order.status} · {money((orderDetail.order.totalCents || 0) / 100)}</p>
                {orderDetail.order.address && (
                  <p className="hint">
                    {orderDetail.order.address.recipientName} · {orderDetail.order.address.street}, {orderDetail.order.address.number} · {orderDetail.order.address.city}/{orderDetail.order.address.state}
                  </p>
                )}
                {orderDetail.order.payment && (
                  <>
                    <p className="hint">Método: {orderDetail.order.payment.method === 'credit_card' ? 'Cartão' : orderDetail.order.payment.method === 'pix' ? 'Pix' : '—'}</p>
                    <p className="hint">Pedido Appmax: {orderDetail.order.payment.appmaxOrderId == null ? '—' : orderDetail.order.payment.appmaxOrderId}</p>
                    <p className="hint">Pagamento Appmax: {orderDetail.order.payment.appmaxPaymentId == null ? '—' : orderDetail.order.payment.appmaxPaymentId}</p>
                    <p className="hint">Status Appmax: {orderDetail.order.payment.appmaxPaymentStatus || '—'}</p>
                    <p className="hint">Estado Catira: {orderDetail.order.payment.catiraStatus}</p>
                    {orderDetail.order.payment.cardInstallments != null && (
                      <p className="hint">Parcelas: {orderDetail.order.payment.cardInstallments}</p>
                    )}
                  </>
                )}
                <p className="hint">Eventos:</p>
                {(orderDetail.events || []).map((e) => (
                  <p key={e.id} className="hint">
                    {e.at} · {e.type}{e.fromStatus || e.toStatus ? ' · ' + (e.fromStatus || '—') + ' → ' + (e.toStatus || '—') : ''}
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'rel' && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Relatório de publicações</h2>
            <p className="lead">Nome, e-mail, telefone, endereço e identificador de cada anúncio. Acesso restrito ao administrador.</p>
            <div className="filters">
              <div className="field">
                <label>Buscar</label>
                <input value={pubQ} onChange={(e) => setPubQ(e.target.value)} placeholder="Nome, e-mail, telefone ou ID" />
              </div>
              <div className="field">
                <label>Status</label>
                <select value={pubStatus} onChange={(e) => setPubStatus(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="published">Publicado</option>
                  <option value="awaiting_payment">Aguardando pagamento</option>
                  <option value="paused">Pausado</option>
                  <option value="sold">Vendido</option>
                  <option value="expired">Expirado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
              <button className="btn btn-ghost" type="button" onClick={() => {
                const rows = pubRows;
                 const header = ['ID do anúncio', 'Código', 'Anúncio', 'Preço', 'Nome', 'E-mail', 'Telefone', 'Endereço', 'Status'];
                const csv = [header.join(';')].concat(rows.map((r) =>
                  [r.listingId, r.listingCode, r.title, money(r.price), r.name, r.email, r.phoneFormatted || r.phone, r.address, r.status]
                    .map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(';')
                )).join('\n');
                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'relatorio-publicacoes-catira.csv';
                a.click();
              }}>Exportar CSV</button>
            </div>
            <div className="report-wrap">
              <table className="table report-table">
                <thead>
                  <tr>
                    {pubHead('listingId', 'ID do anúncio')}
                    {pubHead('title', 'Anúncio')}
                    {pubHead('price', 'Preço')}
                    {pubHead('name', 'Nome')}
                    {pubHead('email', 'E-mail')}
                    {pubHead('phone', 'Telefone')}
                    {pubHead('address', 'Cidade')}
                    {pubHead('status', 'Status')}
                  </tr>
                </thead>
                <tbody>
                  {pubRows.map((r) => (
                    <tr key={r.listingId}>
                      <td>
                        <code className="id-code">{r.listingCode}</code>
                        <div className="tiny">{r.listingId}</div>
                      </td>
                      <td><Link to={'/anuncio/' + r.listingId}>{r.title}</Link></td>
                      <td>{money(r.price)}</td>
                      <td>{r.name}</td>
                      <td>{r.email}</td>
                      <td>{r.phoneFormatted || r.phone}</td>
                      <td>{r.address}</td>
                      <td><span className={'status ' + r.status}>{statusLabel[r.status] || r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'users' && (
          <div style={{ overflowX: 'auto' }}>
            {isMaster && <p className="lead">Só o admin master pode promover um usuário a administrador.</p>}
            <div className="filters">
              <div className="field">
                <label>Buscar</label>
                <input value={userQ} onChange={(e) => setUserQ(e.target.value)} placeholder="Nome, e-mail, cidade ou telefone" />
              </div>
              <div className="grid2">
                <div className="field">
                  <label>Perfil</label>
                  <select value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="user">Comum</option>
                    <option value="dealer">Catireiro</option>
                    <option value="admin">Intermediador</option>
                    <option value="master">Admin master</option>
                  </select>
                </div>
                <div className="field">
                  <label>Cidade</label>
                  <select value={userCityFilter} onChange={(e) => setUserCityFilter(e.target.value)}>
                    <option value="">Todas</option>
                    {userCities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={userStatusFilter} onChange={(e) => setUserStatusFilter(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="active">Ativo</option>
                    <option value="blocked">Bloqueado</option>
                  </select>
                </div>
              </div>
            </div>
            <p className="hint">{userRows.length} de {users.length} usuário{users.length === 1 ? '' : 's'}</p>
            <table className="table">
              <thead><tr><th>Nome</th><th>Perfil</th><th>Cidade</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {userRows.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}<div className="tiny">{u.email}</div></td>
                    <td>{userProfileLabel(u)}</td>
                    <td>{u.city}</td>
                    <td>{u.status}</td>
                    <td>
                      {!isAdminRole(u.role) && (
                        <button className="chip" onClick={() => userStatus(u.id, u.status === 'blocked' ? 'active' : 'blocked')}>
                          {u.status === 'blocked' ? 'Desbloquear' : 'Bloquear'}
                        </button>
                      )}
                      {isMaster && u.role === 'user' && (
                        <button className="chip" onClick={() => userRole(u.id, 'admin')}>Promover a intermediador</button>
                      )}
                      {isMaster && u.role === 'admin' && (
                        <button className="chip" onClick={() => userRole(u.id, 'user')}>Remover intermediador</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!userRows.length && <p className="hint">Nenhum usuário com esses filtros.</p>}
          </div>
        )}

        {tab === 'ads' && (
          <>
            <div className="chips" style={{ marginBottom: 12 }}>
              {[
                ['', 'Todos'],
                ['published', 'Ativos'],
                ['quick', 'Proposta rápida'],
                ['awaiting_payment', 'Pagamento'],
                ['awaiting_confirmation', 'Confirmação'],
                ['payment_expired', 'Pag. expirado'],
                ['awaiting_review', 'Revisão'],
                ['changes_requested', 'Correção'],
                ['paused', 'Pausados'],
                ['sold', 'Vendidos'],
                ['traded', 'Trocados'],
                ['negotiated', 'Negociados'],
                ['expired', 'Expirados'],
                ['cancelled', 'Encerrados'],
              ].map(([k, lab]) => (
                <button key={k || 'all'} type="button" className={'chip' + (adsStatus === k ? ' on' : '')} onClick={() => setAdsStatus(k)}>{lab}</button>
              ))}
            </div>
            <div className="filters">
              <div className="field">
                <label>Buscar</label>
                <input value={adsQ} onChange={(e) => setAdsQ(e.target.value)} placeholder="Título, vendedor, cidade ou ID" />
              </div>
              <div className="grid2">
                <div className="field">
                  <label>Cidade</label>
                  <select value={adsCity} onChange={(e) => setAdsCity(e.target.value)}>
                    <option value="">Todas</option>
                    {adsCities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Tipo</label>
                  <select value={adsType} onChange={(e) => setAdsType(e.target.value)}>
                    <option value="">Todos</option>
                    {listingTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Plano</label>
                  <select value={adsPlan} onChange={(e) => setAdsPlan(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="comum">Comum</option>
                    <option value="destaque">Destaque</option>
                    <option value="premium">Premium</option>
                  </select>
                </div>
                <div className="field">
                  <label>Vendedor</label>
                  <select value={adsSeller} onChange={(e) => setAdsSeller(e.target.value)}>
                    <option value="">Todos</option>
                    {adsSellers.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <p className="hint">{adsRows.length} de {listings.length} anúncio{listings.length === 1 ? '' : 's'}</p>
            {adsRows.map((l) => (
          <div key={l.id} className="list-item ad-card" style={{ flexDirection: 'column' }}>
            <button type="button" className="ad-summary" onClick={() => setOpenAd(openAd === l.id ? '' : l.id)}>
              <Link to={'/anuncio/' + l.id} onClick={(e) => e.stopPropagation()}><strong>{l.title}</strong></Link>
              <div className="meta">{money(l.price)} · {l.city}/MG · {l.seller?.name} · {l.listingTypeLabel || ''}</div>
              <div className="ad-tags">
                {l.premium || l.plan === 'premium'
                  ? <span className="status premium">Premium</span>
                  : l.vip || l.plan === 'vip' || l.plan === 'destaque' || l.featured
                    ? <span className="status featured">Destaque</span>
                    : <span className="status comum">Comum</span>}
                <span className={'status ' + l.status}>{statusLabel[l.status]}</span>
                {l.quickOfferEnabled && <span className="status published">Proposta rápida</span>}
              </div>
            </button>
            {l.adminNote && <p className="admin-note">Comentário: {l.adminNote}</p>}
            {openAd === l.id && (
            <>
            <form className="filters" style={{ marginTop: 8 }} onSubmit={(e) => {
              e.preventDefault();
              if (editingAd !== l.id) {
                setEditingAd(l.id);
                return;
              }
              const fd = new FormData(e.target);
              setSaveDraft({
                id: l.id,
                title: fd.get('title'),
                price: fd.get('price'),
                status: fd.get('status'),
                city: fd.get('city'),
              });
              setSavePassword('');
              setSaveErr('');
            }}>
              <div className="field"><label>Título</label><input name="title" defaultValue={l.title} disabled={editingAd !== l.id} /></div>
              <div className="field"><label>Preço</label><input name="price" defaultValue={l.price} inputMode="decimal" disabled={editingAd !== l.id} /></div>
              <div className="field"><label>Cidade</label><input name="city" defaultValue={l.city} disabled={editingAd !== l.id} /></div>
              <div className="field">
                <label>Status</label>
                <select name="status" defaultValue={l.status} disabled={editingAd !== l.id}>
                   {['published', 'paused', 'sold', 'traded', 'negotiated', 'cancelled', 'awaiting_payment', 'awaiting_confirmation', 'payment_expired', 'awaiting_review', 'changes_requested'].map((st) => (
                     <option key={st} value={st}>{statusLabel[st] || st}</option>
                   ))}
                </select>
              </div>
              <button className="btn btn-ghost" type="submit">{editingAd === l.id ? 'Salvar' : 'Editar'}</button>
              {editingAd === l.id && (
                <button className="btn btn-ghost" type="button" onClick={() => setEditingAd('')}>Cancelar</button>
              )}
            </form>
            <div className="row-btns" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost" type="button" onClick={() => { setPreviewAd(l); setPreviewPhoto(0); }}>Prévia</button>
              {l.quickOfferEnabled && (
                <button className="btn btn-green" type="button" onClick={() => setTab('lance')}>Ver na fila</button>
              )}
              <button className={'btn ' + (l.featured ? 'btn-green' : 'btn-ghost')} onClick={() => listingAct(l.id, l.featured ? 'unfeature' : 'feature')}>{l.featured ? 'Tirar destaque' : 'Destacar'}</button>
              <button className="btn btn-ghost" disabled={l.status === 'published'} onClick={() => listingAct(l.id, 'approve')}>Aprovar</button>
              {l.status !== 'cancelled' && (
                <button className="btn btn-ghost" type="button" disabled={l.status === 'published'} onClick={() => openNote(l.id, 'reject', l.adminNote)}>Recusar</button>
              )}
              {l.status !== 'cancelled' && (
                <button className="btn btn-ghost" type="button" onClick={() => openNote(l.id, 'remove', '')}>Remover</button>
              )}
            </div>
            {noteId === l.id && (
              <form className="reject-box" onSubmit={submitNote}>
                <div className="field">
                  <label>{noteAction === 'remove' ? 'Motivo da remoção' : 'Comentário da recusa'}</label>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder={noteAction === 'remove' ? 'Diga por que o anúncio foi removido.' : 'Diga o que o anunciante precisa corrigir.'}
                    rows={3}
                    required
                  />
                </div>
                {noteErr && <div className="error">{noteErr}</div>}
                <div className="row-btns">
                  <button className="btn btn-primary" type="submit">{noteAction === 'remove' ? 'Confirmar remoção' : 'Enviar recusa'}</button>
                  <button className="btn btn-ghost" type="button" onClick={closeNote}>Cancelar</button>
                </div>
              </form>
            )}
            </>
            )}
          </div>
        ))}
            {!adsRows.length && <p className="hint">Nenhum anúncio com esses filtros.</p>}
          </>
        )}

        {tab === 'acao' && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Catira em Ação</h2>
            <p className="lead">Publicações de atividade. Ocultar tira do feed; remover impede republicar o mesmo anúncio.</p>
            {actionPosts.map((p) => (
              <div key={p.id} className="list-item" style={{ flexDirection: 'column' }}>
                <strong>{p.author?.name || 'Usuário'} · {p.listingTitle || 'Sem anúncio'}</strong>
                <p className="hint">{p.text}</p>
                {p.audioUrl && (
                  <div className="acao-audio compact">
                    <audio controls preload="none" src={p.audioUrl}>Seu navegador não toca este áudio.</audio>
                    {p.audioTranscript ? <p className="acao-transcript">{p.audioTranscript}</p> : <p className="hint">Áudio sem transcrição.</p>}
                  </div>
                )}
                <span className={'status ' + p.status}>{p.status}</span>
                <div className="row-btns" style={{ marginTop: 8 }}>
                  {p.status === 'published' && (
                    <button className="btn btn-ghost" onClick={async () => {
                      await api('/api/admin/acao/' + p.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'hide' }) });
                      const d = await api('/api/admin/acao');
                      setActionPosts(d.items || []);
                    }}>Ocultar</button>
                  )}
                  {p.status === 'hidden' && (
                    <button className="btn btn-ghost" onClick={async () => {
                      await api('/api/admin/acao/' + p.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'restore' }) });
                      const d = await api('/api/admin/acao');
                      setActionPosts(d.items || []);
                    }}>Restaurar</button>
                  )}
                  {p.status !== 'removed' && (
                    <button className="btn btn-ghost" onClick={async () => {
                      await api('/api/admin/acao/' + p.id + '/action', { method: 'POST', body: JSON.stringify({ action: 'remove' }) });
                      const d = await api('/api/admin/acao');
                      setActionPosts(d.items || []);
                    }}>Remover</button>
                  )}
                </div>
              </div>
            ))}
            {!actionPosts.length && <p className="hint">Nenhuma publicação.</p>}
          </>
        )}

        {tab === 'rep' && reports.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: 'column' }}>
            <strong>{r.kind === 'action' ? 'Catira em Ação' : (r.listing?.title || 'Anúncio')}</strong>
            <div className="hint">{r.reason} · {r.reporter?.name} · {statusLabel[r.status] || r.status}</div>
            {r.description && <p className="hint">{r.description}</p>}
            <div className="row-btns">
              <button className="btn btn-ghost" onClick={() => reportStatus(r.id, 'reviewed')}>Analisar</button>
              <button className="btn btn-ghost" onClick={() => reportStatus(r.id, 'resolved')}>Resolver</button>
              <button className="btn btn-ghost" onClick={() => reportStatus(r.id, 'dismissed')}>Descartar</button>
            </div>
          </div>
        ))}

        {tab === 'rev' && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Avaliações</h2>
            {reviewsAdmin.map((r) => (
              <div key={r.id} className="list-item" style={{ flexDirection: 'column' }}>
                <strong>{r.reviewer?.name || 'Usuário'} · {r.kind === 'listing' ? 'anúncio' : 'negociação'}</strong>
                <div>{'★'.repeat(r.rating || 0)}</div>
                {r.comment && <p className="hint">{r.comment}</p>}
                <button className="btn btn-ghost" onClick={async () => {
                  await api('/api/admin/reviews/' + r.id, { method: 'DELETE' });
                  const d = await api('/api/admin/reviews');
                  setReviewsAdmin(d.items || []);
                }}>Remover</button>
              </div>
            ))}
            {!reviewsAdmin.length && <p className="hint">Nenhuma avaliação.</p>}
          </>
        )}

        {tab === 'cat' && (
          <>
            <form onSubmit={addCat} className="filters">
              <div className="field"><label>Nova categoria</label><input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} required /></div>
              <button className="btn btn-primary">Criar</button>
            </form>
            {cats.map((c, i) => (
              <div key={c.id} className="list-item" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <input value={c.name} onChange={(e) => {
                    const n = cats.slice();
                    n[i] = { ...c, name: e.target.value };
                    setCats(n);
                  }} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 6, width: '100%' }} />
                  <div className="hint">{c.slug} · ordem {c.order}{c.active === false ? ' · inativa' : ''}</div>
                </div>
                <button className="chip" onClick={() => moveCat(i, -1)}>Sobe</button>
                <button className="chip" onClick={() => moveCat(i, 1)}>Desce</button>
                <button className="chip" onClick={() => saveCat(cats[i])}>Salvar</button>
                <button className="chip" onClick={() => delCat(c.id)}>Excluir</button>
              </div>
            ))}
          </>
        )}
      </div>
      {previewAd && (
        <div className="modal-bg" onClick={() => setPreviewAd(null)}>
          <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Prévia do anúncio</h3>
            {previewAd.images && previewAd.images.length > 0 && (
              <>
                <div className="preview-main">
                  <img src={(previewAd.images[previewPhoto] || previewAd.images[0]).url} alt="" />
                  <button
                    type="button"
                    className="preview-del"
                    disabled={previewAd.listingType !== 'procuro' && previewAd.images.length <= 3}
                    onClick={async () => {
                      const img = previewAd.images[previewPhoto] || previewAd.images[0];
                      if (!img || !img.id) return;
                      if (!window.confirm('Excluir esta foto?')) return;
                      try {
                        const updated = await api('/api/admin/listings/' + previewAd.id + '/images/' + img.id, { method: 'DELETE' });
                        setPreviewAd(updated);
                        setPreviewPhoto((n) => Math.min(n, Math.max(0, (updated.images || []).length - 1)));
                        setListings((prev) => prev.map((x) => x.id === updated.id ? updated : x));
                      } catch (ex) {
                        window.alert(ex.message);
                      }
                    }}
                  >Excluir foto</button>
                </div>
                {previewAd.images.length > 1 && (
                  <div className="preview-thumbs">
                    {previewAd.images.map((img, i) => (
                      <button key={img.id || img.url} type="button" className={i === previewPhoto ? 'on' : ''} onClick={() => setPreviewPhoto(i)}>
                        <img src={img.url} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <strong>{previewAd.title}</strong>
            <div className="price">{money(previewAd.price)}</div>
            <p className="hint">{previewAd.listingTypeLabel} · {previewAd.category?.name || ''} · {previewAd.city}/MG</p>
            <div className="ad-tags" style={{ margin: '6px 0' }}>
              {previewAd.premium || previewAd.plan === 'premium'
                ? <span className="status premium">Premium</span>
                : previewAd.vip || previewAd.plan === 'vip' || previewAd.plan === 'destaque' || previewAd.featured
                  ? <span className="status featured">Destaque</span>
                  : <span className="status comum">Comum</span>}
            </div>
            <p className="hint">{previewAd.seller?.name} · {previewAd.seller?.email || ''}</p>
            <span className={'status ' + previewAd.status}>{statusLabel[previewAd.status]}</span>
            {previewAd.tradeWishes && <p className="hint">Procura por: {previewAd.tradeWishes}</p>}
            <p style={{ marginTop: 8, fontSize: 14, whiteSpace: 'pre-wrap' }}>{previewAd.description}</p>
            {previewAd.adminNote && <p className="admin-note">Comentário: {previewAd.adminNote}</p>}
            <div className="row-btns" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" type="button" disabled={previewAd.status === 'published'} onClick={() => { listingAct(previewAd.id, 'approve'); setPreviewAd(null); }}>Aprovar</button>
              <button className="btn btn-ghost" type="button" disabled={previewAd.status === 'published'} onClick={() => { openNote(previewAd.id, 'reject', previewAd.adminNote); setPreviewAd(null); }}>Recusar</button>
              <button className="btn btn-ghost" type="button" onClick={() => { openNote(previewAd.id, 'remove', ''); setPreviewAd(null); }}>Remover</button>
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} type="button" onClick={() => setPreviewAd(null)}>Fechar</button>
          </div>
        </div>
      )}
      {saveDraft && (
        <div className="modal-bg" onClick={() => { setSaveDraft(null); setSavePassword(''); setSaveErr(''); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirmar alteração</h3>
            <p className="hint">Digite a senha do administrador para salvar.</p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!savePassword.trim()) {
                setSaveErr('Informe a senha.');
                return;
              }
              try {
                await api('/api/admin/listings/' + saveDraft.id, {
                  method: 'PUT',
                  body: JSON.stringify({ ...saveDraft, password: savePassword }),
                });
                const d = await api('/api/admin/listings');
                setListings(d.items || []);
                setEditingAd('');
                setSaveDraft(null);
                setSavePassword('');
                setSaveErr('');
              } catch (ex) {
                setSaveErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Senha</label>
                <input type="password" value={savePassword} onChange={(e) => setSavePassword(e.target.value)} autoFocus required />
              </div>
              {saveErr && <div className="error">{saveErr}</div>}
              <button className="btn btn-primary" type="submit">Confirmar e salvar</button>
              <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={() => { setSaveDraft(null); setSavePassword(''); setSaveErr(''); }}>Cancelar</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
