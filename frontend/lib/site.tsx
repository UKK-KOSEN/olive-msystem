'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, SiteSettings } from '@/lib/api';

const DEFAULT_SITE: SiteSettings = {
  name: 'olive-msystem',
  subtitle: 'オリーブ管理ダッシュボード',
  accent: '#2b2b2b',
};

interface SiteContextValue {
  site: SiteSettings;
  refresh: () => Promise<void>;
}

const SiteContext = createContext<SiteContextValue>({
  site: DEFAULT_SITE,
  refresh: async () => {},
});

function applySite(site: SiteSettings) {
  if (typeof document === 'undefined') return;
  document.title = site.name;
  const root = document.documentElement;
  root.style.setProperty('--accent', site.accent);
  root.style.setProperty('--accent-soft', site.accent + '1a');
}

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [site, setSite] = useState<SiteSettings>(DEFAULT_SITE);

  const refresh = useCallback(async () => {
    try {
      const res = await api.siteSettings();
      const merged = {
        name: res.site?.name || DEFAULT_SITE.name,
        subtitle: res.site?.subtitle || DEFAULT_SITE.subtitle,
        accent: res.site?.accent || DEFAULT_SITE.accent,
      };
      setSite(merged);
      applySite(merged);
    } catch {
      applySite(DEFAULT_SITE);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      applySite(DEFAULT_SITE);
    };
  }, [refresh]);

  const value = useMemo(() => ({ site, refresh }), [site, refresh]);

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite() {
  return useContext(SiteContext);
}