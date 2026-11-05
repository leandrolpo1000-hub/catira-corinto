import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';

const emptyBanner = { enabled: false, imageUrl: '', link: '', title: '' };
const emptyCfg = {
  fee: 5,
  vipListingFee: 15,
  vipAccessFee: 20,
  vipDays: 30,
  highlightFee: 10,
  highlightDays: 7,
  premiumDayFee: 30,
  feeEnabled: false,
  commonFeeEnabled: false,
  vipFeeEnabled: false,
  premiumFeeEnabled: true,
  homeBanner: emptyBanner,
  premiumBanner: null,
  assistantEnabled: false,
  auctionEnabled: false,
  auction: { flags: {}, enabled: false, settings: {} },
  appmax: { scriptUrl: '', externalId: '', env: 'production' },
};
const Ctx = createContext(emptyCfg);

export function ConfigProvider({ children }) {
  const [cfg, setCfg] = useState(emptyCfg);
  const loadedAt = useRef(0);

  useEffect(() => {
    function load() {
      if (loadedAt.current && Date.now() - loadedAt.current < 60_000) return;
      api('/api/config').then((d) => {
        if (!d) return;
        loadedAt.current = Date.now();
        setCfg({
          fee: d.fee > 0 ? Number(d.fee) : 5,
          vipListingFee: d.vipListingFee > 0 ? Number(d.vipListingFee) : 15,
          vipAccessFee: d.vipAccessFee > 0 ? Number(d.vipAccessFee) : 20,
          vipDays: d.vipDays > 0 ? Number(d.vipDays) : 30,
          highlightFee: d.highlightFee > 0 ? Number(d.highlightFee) : 10,
          highlightDays: d.highlightDays > 0 ? Number(d.highlightDays) : 7,
          premiumDayFee: d.premiumDayFee > 0 ? Number(d.premiumDayFee) : 30,
          feeEnabled: d.commonFeeEnabled !== undefined ? !!d.commonFeeEnabled : !!d.feeEnabled,
          commonFeeEnabled: d.commonFeeEnabled !== undefined ? !!d.commonFeeEnabled : !!d.feeEnabled,
          vipFeeEnabled: !!d.vipFeeEnabled,
          premiumFeeEnabled: d.premiumFeeEnabled !== undefined ? !!d.premiumFeeEnabled : true,
          homeBanner: d.homeBanner && d.homeBanner.imageUrl
            ? {
                enabled: !!d.homeBanner.enabled,
                imageUrl: d.homeBanner.imageUrl,
                link: d.homeBanner.link || '',
                title: d.homeBanner.title || '',
              }
            : emptyBanner,
          premiumBanner: d.premiumBanner && d.premiumBanner.imageUrl
            ? {
                listingId: d.premiumBanner.listingId || '',
                imageUrl: d.premiumBanner.imageUrl,
                link: d.premiumBanner.link || '',
                title: d.premiumBanner.title || '',
              }
            : null,
          assistantEnabled: !!d.assistantEnabled,
          auctionEnabled: !!d.auctionEnabled,
          auction: d.auction && d.auction.flags
            ? d.auction
            : { flags: {}, enabled: !!d.auctionEnabled, settings: {} },
          appmax: d.appmax && d.appmax.scriptUrl ? d.appmax : { scriptUrl: '', externalId: '', env: 'production' },
        });
      }).catch(() => {});
    }
    load();
    function onVis() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return <Ctx.Provider value={cfg}>{children}</Ctx.Provider>;
}

export function useConfig() {
  return useContext(Ctx);
}
