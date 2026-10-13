import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Db } from '@fin/db';
import { todayIn } from '@fin/domain';
import type { Config } from '../config';
import { HttpError, badRequest, insert, nowIso, parse, type Role } from '../core';
import { seedDefaultCategories } from './categories';
import { mountWebauthn } from './webauthn';

export const SESSION_COOKIE = 'fin_session';
const SESSION_DAYS = 30;

interface SessionPayload {
  uid: number;
}

const zEmail = z.string().trim().toLowerCase().email('E-mail inválido');
const zPassword = z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(200);

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

export function setSession(res: Response, config: Config, userId: number) {
  const token = jwt.sign({ uid: userId } satisfies SessionPayload, config.sessionSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
}

export async function publicUser(db: Db, userId: number) {
  return db.get(
    `SELECT u.id, u.name, u.email, u.role, u.household_id, h.name AS household_name, h.timezone
       FROM users u JOIN households h ON h.id = u.household_id WHERE u.id = ?`,
    [userId],
  );
}

export function authRouter(db: Db, config: Config): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

  r.get('/options', (_req, res) => {
    res.json({ register_open: config.allowRegister });
  });

  r.post('/register', limiter, async (req, res) => {
    if (!config.allowRegister) throw new HttpError(403, 'O cadastro de novas casas está fechado');
    const body = parse(
      z.object({
        household_name: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(80),
        email: zEmail,
        password: zPassword,
        timezone: z.string().optional(),
      }),
      req.body,
    );
    const exists = await db.get('SELECT id FROM users WHERE email = ?', [body.email]);
    if (exists) throw badRequest('Este e-mail já está cadastrado');
    const timezone = body.timezone ?? 'America/Sao_Paulo';
    try {
      todayIn(timezone);
    } catch {
      throw badRequest('Fuso horário inválido');
    }
    const passwordHash = await hashPassword(body.password);
    const userId = await db.tx(async (t) => {
      const now = nowIso();
      const householdId = await insert(t, 'households', { name: body.household_name, timezone, created_at: now });
      const uid = await insert(t, 'users', {
        household_id: householdId,
        name: body.name,
        email: body.email,
        password_hash: passwordHash,
        role: 'admin',
        created_at: now,
      });
      await seedDefaultCategories(t, householdId);
      return uid;
    });
    setSession(res, config, userId);
    res.status(201).json(await publicUser(db, userId));
  });

  r.post('/login', limiter, async (req, res) => {
    const body = parse(z.object({ email: zEmail, password: z.string().min(1) }), req.body);
    const user = await db.get<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', [body.email]);
    const ok = user ? await bcrypt.compare(body.password, user.password_hash) : false;
    if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos');
    setSession(res, config, user.id);
    res.json(await publicUser(db, user.id));
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  r.get('/me', requireAuth(db, config), async (req, res) => {
    res.json({ ...(await publicUser(db, req.ctx.userId)), today: req.ctx.today });
  });

  mountWebauthn(r, db, config, limiter);

  r.post('/password', requireAuth(db, config), async (req, res) => {
    const body = parse(
      z.object({
        current_password: z.string().min(1),
        new_password: zPassword,
      }),
      req.body,
    );
    const user = await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [req.ctx.userId]);
    const ok = user ? await bcrypt.compare(body.current_password, user.password_hash) : false;
    if (!user || !ok) throw new HttpError(401, 'Senha atual incorreta');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.new_password), req.ctx.userId]);
    res.status(204).end();
  });

  return r;
}

/**
 * Carrega o usuário a cada requisição. Todas as consultas de negócio usam
 * req.ctx.householdId, então um usuário nunca alcança outro household.
 */
export function requireAuth(db: Db, config: Config) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next(new HttpError(401, 'Faça login para continuar'));
    let payload: SessionPayload;
    try {
      payload = jwt.verify(token, config.sessionSecret) as SessionPayload;
    } catch {
      return next(new HttpError(401, 'Sessão expirada'));
    }
    const user = await db.get<{ id: number; household_id: number; role: Role; timezone: string }>(
      'SELECT u.id, u.household_id, u.role, h.timezone FROM users u JOIN households h ON h.id = u.household_id WHERE u.id = ?',
      [payload.uid],
    );
    if (!user) return next(new HttpError(401, 'Sessão inválida'));
    req.ctx = {
      db,
      userId: user.id,
      householdId: user.household_id,
      role: user.role,
      timezone: user.timezone,
      today: config.fixedToday ?? todayIn(user.timezone),
    };
    next();
  };
}
