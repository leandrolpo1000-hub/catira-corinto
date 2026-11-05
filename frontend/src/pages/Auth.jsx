import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, money } from '../api';
import { useAuth } from '../auth';
import { BrandLogo, Top } from '../components';
import { useConfig } from '../config';
import { formatPhoneBr } from '../masks';

export function Login() {
  const { login, user } = useAuth();
  const { fee } = useConfig();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    if (!user.emailVerified && (next.startsWith('/anunciar') || next.startsWith('/pagar'))) {
      nav('/confirmar-email?next=' + encodeURIComponent(next), { replace: true });
      return;
    }
    nav(next, { replace: true });
  }, [user]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    try {
      const u = await login(email, password);
      if (u && !u.emailVerified && (next.startsWith('/anunciar') || next.startsWith('/pagar'))) {
        nav('/confirmar-email?next=' + encodeURIComponent(next));
      } else {
        nav(next);
      }
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <>
      <Top back />
      <div className="page">
        <div className="brand-center"><BrandLogo size="lg" /></div>
        <h1>Entrar</h1>
        <p className="lead">Comprar é grátis. Anunciar custa {money(fee)}.</p>
        {err && <div className="error">{err}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>E-mail</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></div>
          <div className="field"><label>Senha</label><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></div>
          <button className="btn btn-primary">Entrar</button>
        </form>
        <p style={{ marginTop: 14 }}><Link className="link" to="/recuperar">Esqueci a senha</Link></p>
        <p style={{ marginTop: 8 }}>Não tem conta? <Link className="link" to={'/cadastro?next=' + encodeURIComponent(next)}>Criar conta</Link></p>
        <p className="hint" style={{ marginTop: 18 }}>Demo: joao@email.com / 123456 · admin@catira.com / admin123 (master)</p>
      </div>
    </>
  );
}

export function Register() {
  const { register, user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';
  const [cities, setCities] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', emailConfirm: '', phone: '', city: 'Corinto', password: '', passwordConfirm: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    if (user && user.emailVerified) nav(next, { replace: true });
  }, [user]);
  useEffect(() => { api('/api/auth/cities').then(setCities).catch(() => {}); }, []);

  function set(k, v) { setForm({ ...form, [k]: v }); }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (form.email.trim().toLowerCase() !== form.emailConfirm.trim().toLowerCase()) {
      setErr('Os e-mails não coincidem.');
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setErr('As senhas não coincidem.');
      return;
    }
    try {
      const city = cities.find((c) => c.name === form.city);
      const d = await register({ ...form, cityId: city?.id || '' });
      const qs = new URLSearchParams();
      if (next && next !== '/') qs.set('next', next);
      if (d.demoCode) qs.set('code', d.demoCode);
      nav('/confirmar-email' + (qs.toString() ? '?' + qs.toString() : ''));
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <>
      <Top back />
      <div className="page">
        <div className="brand-center"><BrandLogo size="lg" /></div>
        <h1>Criar conta</h1>
        <p className="lead">Só o básico. Sem documento. Depois confirme o e-mail para anunciar.</p>
        {err && <div className="error">{err}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>Nome</label><input value={form.name} onChange={(e) => set('name', e.target.value)} required /></div>
          <div className="field"><label>E-mail</label><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></div>
          <div className="field"><label>Confirme o e-mail</label><input type="email" value={form.emailConfirm} onChange={(e) => set('emailConfirm', e.target.value)} required /></div>
          <div className="field">
            <label>Telefone / WhatsApp</label>
            <input
              value={form.phone}
              onChange={(e) => set('phone', formatPhoneBr(e.target.value))}
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="(38) 99999-9999"
            />
          </div>
          <div className="field">
            <label>Cidade</label>
            <select value={form.city} onChange={(e) => set('city', e.target.value)}>
              {cities.map((c) => <option key={c.id || c.name} value={c.name}>{c.name}-{c.state || 'MG'}</option>)}
            </select>
          </div>
          <div className="field"><label>Senha</label><input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required minLength={6} /></div>
          <div className="field"><label>Confirme a senha</label><input type="password" value={form.passwordConfirm} onChange={(e) => set('passwordConfirm', e.target.value)} required minLength={6} /></div>
          <button className="btn btn-primary">Cadastrar</button>
        </form>
        <p style={{ marginTop: 12 }}>Já tem conta? <Link className="link" to={'/entrar?next=' + encodeURIComponent(next)}>Entrar</Link></p>
      </div>
    </>
  );
}

export function VerifyEmail() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';
  const [code, setCode] = useState(sp.get('code') || '');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && user.emailVerified) nav(next, { replace: true });
  }, [user, next, nav]);

  if (!user) return (
    <>
      <Top back />
      <div className="page">
        <h1>Confirme seu e-mail</h1>
        <p className="lead">Entre na conta para informar o código.</p>
        <Link className="btn btn-primary" to={'/entrar?next=' + encodeURIComponent('/confirmar-email' + (next !== '/' ? '?next=' + encodeURIComponent(next) : ''))}>Entrar</Link>
      </div>
    </>
  );

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const d = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ code }) });
      setUser(d.user);
      nav(next);
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  async function resend() {
    setErr('');
    setMsg('');
    try {
      const d = await api('/api/auth/resend-verification', { method: 'POST' });
      setMsg(d.message + (d.demoCode ? ' Código: ' + d.demoCode : ''));
      if (d.demoCode) setCode(d.demoCode);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <>
      <Top back />
      <div className="page">
        <div className="brand-center"><BrandLogo size="lg" /></div>
        <h1>Confirme seu e-mail</h1>
        <p className="lead">Enviamos um código de 6 dígitos para {user.email}. Sem essa confirmação você não publica anúncio.</p>
        {err && <div className="error">{err}</div>}
        {msg && <div className="okbox">{msg}</div>}
        {sp.get('code') && !msg && <div className="okbox">Código de confirmação: {sp.get('code')}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>Código</label><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" required /></div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Confirmando...' : 'Confirmar e-mail'}</button>
        </form>
        <p style={{ marginTop: 12 }}><button type="button" className="link" onClick={resend}>Reenviar código</button></p>
      </div>
    </>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState(1);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();

  async function send(e) {
    e.preventDefault();
    setErr('');
    try {
      const d = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
      setMsg(d.message + (d.demoCode ? ' Código: ' + d.demoCode : ''));
      setStep(2);
    } catch (ex) { setErr(ex.message); }
  }

  async function reset(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/auth/reset', { method: 'POST', body: JSON.stringify({ email, code, password }) });
      nav('/entrar');
    } catch (ex) { setErr(ex.message); }
  }

  return (
    <>
      <Top back />
      <div className="page">
        <div className="brand-center"><BrandLogo size="lg" /></div>
        <h1>Recuperar senha</h1>
        {err && <div className="error">{err}</div>}
        {msg && <div className="okbox">{msg}</div>}
        {step === 1 ? (
          <form onSubmit={send}>
            <div className="field"><label>E-mail</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <button className="btn btn-primary">Enviar código</button>
          </form>
        ) : (
          <form onSubmit={reset}>
            <div className="field"><label>Código</label><input value={code} onChange={(e) => setCode(e.target.value)} required /></div>
            <div className="field"><label>Nova senha</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <button className="btn btn-primary">Redefinir</button>
          </form>
        )}
      </div>
    </>
  );
}
