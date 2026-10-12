import { Router } from 'express';
import { z } from 'zod';
import { todayIn } from '@fin/domain';
import { badRequest, idParam, insert, notFound, nowIso, parse, requireAdmin, update } from '../core';
import { hashPassword } from './auth';

export function householdsRouter(): Router {
  const r = Router();

  r.get('/me', async (req, res) => {
    res.json(await req.ctx.db.get('SELECT id, name, timezone, created_at FROM households WHERE id = ?', [req.ctx.householdId]));
  });

  r.patch('/me', async (req, res) => {
    requireAdmin(req.ctx);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), timezone: z.string().optional() }), req.body);
    if (body.timezone) {
      try {
        todayIn(body.timezone);
      } catch {
        throw badRequest('Fuso horário inválido');
      }
    }
    await update(req.ctx.db, 'households', req.ctx.householdId, body);
    res.json(await req.ctx.db.get('SELECT id, name, timezone, created_at FROM households WHERE id = ?', [req.ctx.householdId]));
  });

  return r;
}

export function usersRouter(): Router {
  const r = Router();
  const cols = 'id, name, email, role, created_at';

  r.get('/', async (req, res) => {
    res.json(await req.ctx.db.all(`SELECT ${cols} FROM users WHERE household_id = ? ORDER BY id`, [req.ctx.householdId]));
  });

  r.post('/', async (req, res) => {
    requireAdmin(req.ctx);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80),
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres'),
        role: z.enum(['admin', 'member']).default('member'),
      }),
      req.body,
    );
    if (await req.ctx.db.get('SELECT id FROM users WHERE email = ?', [body.email])) throw badRequest('Este e-mail já está cadastrado');
    const id = await insert(req.ctx.db, 'users', {
      household_id: req.ctx.householdId,
      name: body.name,
      email: body.email,
      password_hash: await hashPassword(body.password),
      role: body.role,
      created_at: nowIso(),
    });
    res.status(201).json(await req.ctx.db.get(`SELECT ${cols} FROM users WHERE id = ?`, [id]));
  });

  r.patch('/:id', async (req, res) => {
    requireAdmin(req.ctx);
    const id = idParam(req.params.id);
    const body = parse(z.object({ role: z.enum(['admin', 'member']).optional(), name: z.string().trim().min(1).optional() }), req.body);
    const user = await req.ctx.db.get('SELECT id FROM users WHERE id = ? AND household_id = ?', [id, req.ctx.householdId]);
    if (!user) throw notFound('Usuário');
    if (body.role === 'member') {
      const admins = await req.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE household_id = ? AND role = 'admin' AND id <> ?", [
        req.ctx.householdId,
        id,
      ]);
      if (!admins || Number(admins.n) === 0) throw badRequest('O household precisa de pelo menos um administrador');
    }
    await update(req.ctx.db, 'users', id, body);
    res.json(await req.ctx.db.get(`SELECT ${cols} FROM users WHERE id = ?`, [id]));
  });

  r.post('/:id/password', async (req, res) => {
    requireAdmin(req.ctx);
    const id = idParam(req.params.id);
    if (id === req.ctx.userId) throw badRequest('Para a sua senha, use a troca com a senha atual');
    const body = parse(z.object({ password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(200) }), req.body);
    const user = await req.ctx.db.get('SELECT id FROM users WHERE id = ? AND household_id = ?', [id, req.ctx.householdId]);
    if (!user) throw notFound('Usuário');
    await update(req.ctx.db, 'users', id, { password_hash: await hashPassword(body.password) });
    res.status(204).end();
  });

  return r;
}
