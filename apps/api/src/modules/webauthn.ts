import { isIP } from 'node:net';
import type { Request, RequestHandler, Router } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { decodeClientDataJSON } from '@simplewebauthn/server/helpers';
import type { Db } from '@fin/db';
import type { Config } from '../config';
import { badRequest, insert, notFound, nowIso } from '../core';
import { publicUser, requireAuth, setSession } from './auth';

const RP_NAME = 'Finanças do casal';
const CHALLENGE_MS = 5 * 60_000;
const NEED_NAME = 'A digital e o Face ID pedem um endereço https com nome.';

interface StoredCredential {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
}

function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function b64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** Host da página. IP e http fora de localhost não servem para a cerimônia. */
export function relyingParty(req: Request, config: Config): { rpID: string; origin: string } {
  if (config.webauthnRpId && config.webauthnOrigin) {
    return { rpID: config.webauthnRpId, origin: config.webauthnOrigin };
  }
  const header = req.get('origin');
  let url: URL | null = null;
  try {
    if (header) url = new URL(header);
  } catch {
    url = null;
  }
  if (!url) throw badRequest(NEED_NAME);
  const host = url.hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if ((!local && isIP(host) !== 0) || (!local && url.protocol !== 'https:')) throw badRequest(NEED_NAME);
  return { rpID: host, origin: url.origin };
}

async function dropExpired(db: Db) {
  await db.run('DELETE FROM webauthn_challenges WHERE expires_at < ?', [nowIso()]);
}

async function saveChallenge(db: Db, challenge: string, kind: 'register' | 'login', userId: number | null) {
  await dropExpired(db);
  const expires = new Date(Date.now() + CHALLENGE_MS).toISOString();
  await db.run('INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?, ?, ?, ?)', [challenge, userId, kind, expires]);
}

async function takeChallenge(db: Db, challenge: string, kind: 'register' | 'login', userId?: number) {
  const row = await db.get<{ user_id: number | null; kind: string; expires_at: string }>(
    'SELECT user_id, kind, expires_at FROM webauthn_challenges WHERE challenge = ?',
    [challenge],
  );
  const fresh = row && row.kind === kind && row.expires_at >= nowIso() && (kind !== 'register' || row.user_id === userId);
  if (row) await db.run('DELETE FROM webauthn_challenges WHERE challenge = ?', [challenge]);
  if (!fresh) throw badRequest('Esse pedido expirou. Tente de novo.');
}

function challengeFrom(clientDataJSON: unknown): string {
  if (typeof clientDataJSON !== 'string' || !clientDataJSON) throw badRequest('Dados inválidos');
  try {
    return decodeClientDataJSON(clientDataJSON).challenge;
  } catch {
    throw badRequest('Dados inválidos');
  }
}

export function mountWebauthn(r: Router, db: Db, config: Config, limiter: RequestHandler) {
  r.post('/webauthn/register/options', requireAuth(db, config), async (req, res) => {
    const { rpID } = relyingParty(req, config);
    const user = await db.get<{ id: number; email: string; name: string }>('SELECT id, email, name FROM users WHERE id = ?', [req.ctx.userId]);
    if (!user) throw notFound('Usuário');
    const existing = await db.all<{ credential_id: string }>('SELECT credential_id FROM webauthn_credentials WHERE user_id = ?', [user.id]);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: user.email,
      userID: new TextEncoder().encode(String(user.id)),
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: existing.map((row) => ({ id: row.credential_id })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      preferredAuthenticatorType: 'localDevice',
    });
    await saveChallenge(db, options.challenge, 'register', user.id);
    res.json(options);
  });

  r.post('/webauthn/register/verify', requireAuth(db, config), async (req, res) => {
    const { origin, rpID } = relyingParty(req, config);
    const response = req.body?.response as RegistrationResponseJSON | undefined;
    const label = String(req.body?.device_label ?? 'Este celular').trim().slice(0, 40) || 'Este celular';
    const challenge = challengeFrom(response?.response?.clientDataJSON);
    await takeChallenge(db, challenge, 'register', req.ctx.userId);
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: response!,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      throw badRequest('Não foi possível confirmar a digital ou o Face ID.');
    }
    if (!verified.verified) throw badRequest('Não foi possível confirmar a digital ou o Face ID.');
    const credential = verified.registrationInfo.credential;
    const id = await insert(db, 'webauthn_credentials', {
      user_id: req.ctx.userId,
      credential_id: credential.id,
      public_key: bytesToB64(credential.publicKey),
      counter: credential.counter,
      device_label: label,
      created_at: nowIso(),
    });
    res.status(201).json({ id, credential_id: credential.id, device_label: label });
  });

  r.post('/webauthn/login/options', limiter, async (req, res) => {
    const { rpID } = relyingParty(req, config);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    await saveChallenge(db, options.challenge, 'login', null);
    res.json(options);
  });

  r.post('/webauthn/login/verify', limiter, async (req, res) => {
    const { origin, rpID } = relyingParty(req, config);
    const response = req.body?.response as AuthenticationResponseJSON | undefined;
    const challenge = challengeFrom(response?.response?.clientDataJSON);
    await takeChallenge(db, challenge, 'login');
    const stored = response?.id
      ? await db.get<StoredCredential>('SELECT id, user_id, credential_id, public_key, counter FROM webauthn_credentials WHERE credential_id = ?', [
          response.id,
        ])
      : undefined;
    if (!stored) throw badRequest('Não foi possível entrar com a digital ou o Face ID.');
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: response!,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: stored.credential_id,
          publicKey: b64ToBytes(stored.public_key),
          counter: stored.counter,
        },
      });
    } catch {
      throw badRequest('Não foi possível entrar com a digital ou o Face ID.');
    }
    if (!verified.verified) throw badRequest('Não foi possível entrar com a digital ou o Face ID.');
    await db.run('UPDATE webauthn_credentials SET counter = ? WHERE id = ?', [verified.authenticationInfo.newCounter, stored.id]);
    setSession(res, config, stored.user_id);
    res.json(await publicUser(db, stored.user_id));
  });

  r.get('/webauthn', requireAuth(db, config), async (req, res) => {
    const rows = await db.all(
      'SELECT id, credential_id, device_label, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY id',
      [req.ctx.userId],
    );
    res.json(rows);
  });

  r.delete('/webauthn/:id', requireAuth(db, config), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Identificador inválido');
    const result = await db.run('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?', [id, req.ctx.userId]);
    if (result.changes === 0) throw notFound('Celular');
    res.status(204).end();
  });
}
