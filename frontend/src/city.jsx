import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const KEY = 'catira_city';
const Ctx = createContext({ city: '', cities: [], setCity: () => {} });

export function CityProvider({ children }) {
  const [city, setCityState] = useState('');
  const [cities, setCities] = useState([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setCityState(saved);
    } catch {}
    api('/api/auth/cities').then(setCities).catch(() => {});
  }, []);

  function setCity(next) {
    const value = next || '';
    setCityState(value);
    try {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch {}
  }

  function cityQuery() {
    return city ? 'city=' + encodeURIComponent(city) : '';
  }

  return (
    <Ctx.Provider value={{ city, cities, setCity, cityQuery }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCity() {
  return useContext(Ctx);
}
