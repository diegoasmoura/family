import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'fin-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readTheme(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // A barra do navegador (e a de baixo, no iPhone) acompanha o fundo do app, não o verde da marca.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', dark ? '#121212' : '#ffffff'));
}

/** Acompanha a troca de tema do aparelho enquanto a preferência for "system". */
export function initTheme() {
  applyTheme(readTheme());
  media().addEventListener('change', () => readTheme() === 'system' && applyTheme('system'));
}

/** Preferência salva no aparelho; "system" segue o tema do celular ou computador. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readTheme);
  useEffect(() => {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
    applyTheme(pref);
  }, [pref]);
  return [pref, setPref] as const;
}
