import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import { api } from './api';

const ID_KEY = 'fin_passkey';
const SKIP_KEY = 'fin_passkey_skip';

/** O celular só aceita a cerimônia em https com nome, ou em localhost. */
export function canUsePasskey(): boolean {
  if (typeof window === 'undefined' || !window.isSecureContext || typeof window.PublicKeyCredential === 'undefined') return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return window.location.protocol === 'https:';
}

export function savedPasskeyId(): string | null {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}

export function passkeyOfferDismissed(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return true;
  }
}

export function dismissPasskeyOffer() {
  localStorage.setItem(SKIP_KEY, '1');
}

export function forgetLocalPasskey() {
  localStorage.removeItem(ID_KEY);
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Este aparelho';
}

function cancelled(err: unknown): boolean {
  if (!(err instanceof WebAuthnError)) return false;
  if (err.code === 'ERROR_CEREMONY_ABORTED') return true;
  const cause = err.cause as { name?: string } | undefined;
  return cause?.name === 'NotAllowedError';
}

export async function loginWithPasskey() {
  const options = await api('/auth/webauthn/login/options');
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    if (cancelled(err)) return null;
    throw err;
  }
  const user = await api('/auth/webauthn/login/verify', { body: { response } });
  localStorage.setItem(ID_KEY, response.id);
  localStorage.removeItem(SKIP_KEY);
  return user;
}

export async function registerPasskey() {
  const options = await api('/auth/webauthn/register/options');
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (err) {
    if (cancelled(err)) return null;
    throw err;
  }
  const saved = await api<{ credential_id: string }>('/auth/webauthn/register/verify', {
    body: { response, device_label: deviceLabel() },
  });
  localStorage.setItem(ID_KEY, saved.credential_id);
  localStorage.removeItem(SKIP_KEY);
  return saved;
}
