import { useSyncExternalStore } from 'react';

const HIDE_KEY = 'fin-hide-money';
const AUTO_KEY = 'fin-hide-auto';
const listeners = new Set<() => void>();

const read = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const write = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignora */
  }
};

let hidden = read(HIDE_KEY) || read(AUTO_KEY);

function apply() {
  document.documentElement.dataset.hideMoney = hidden ? '1' : '0';
}

export function setHidden(on: boolean) {
  hidden = on;
  write(HIDE_KEY, on);
  apply();
  listeners.forEach((l) => l());
}

export const useHidden = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => hidden,
  );

export const isAutoHide = () => read(AUTO_KEY);
export const setAutoHide = (on: boolean) => write(AUTO_KEY, on);

export function initPrivacy() {
  apply();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isAutoHide()) setHidden(true);
  });
}
