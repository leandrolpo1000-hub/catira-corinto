import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        const d = await api('/api/auth/me');
        setUser(d.user);
      } catch {
        setToken(null);
      }
      setReady(true);
    })();
  }, []);

  async function login(email, password) {
    const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }

  async function register(payload) {
    const d = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    setToken(d.token);
    setUser(d.user);
    return d;
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <Ctx.Provider value={{ user, ready, login, register, logout, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}

export function isAdminRole(role) {
  return role === 'admin' || role === 'master';
}

export function isMasterRole(role) {
  return role === 'master';
}
