import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AVATAR_COLORS, defaultAvatar } from '@fin/domain';
import { badRequest, insert, notFound, nowIso, parse, update } from '../core';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_DAYS = 7;

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function newCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function orderedPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export function personColor(avatar: string | null, userId: number): string {
  try {
    const parsed = avatar ? JSON.parse(avatar) : null;
    if (parsed && typeof parsed.color === 'string' && AVATAR_COLORS.includes(parsed.color)) return parsed.color;
  } catch {
    /* avatar antigo ou vazio cai na cor padrão */
  }
  return defaultAvatar(userId).color;
}

interface LinkRow {
  id: number;
  household_low_id: number;
  household_high_id: number;
  status: string;
}

export async function activeLink(ctx: { db: { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined> }; householdId: number }) {
  return ctx.db.get<LinkRow>(
    `SELECT id, household_low_id, household_high_id, status FROM couple_links
      WHERE status = 'active' AND (household_low_id = ? OR household_high_id = ?)`,
    [ctx.householdId, ctx.householdId],
  );
}

export function partnerHouseholdId(link: LinkRow, householdId: number): number {
  return link.household_low_id === householdId ? link.household_high_id : link.household_low_id;
}

async function householdHasActiveLink(db: { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined> }, householdId: number) {
  return db.get('SELECT id FROM couple_links WHERE status = \'active\' AND (household_low_id = ? OR household_high_id = ?)', [
    householdId,
    householdId,
  ]);
}

export function coupleRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const link = await activeLink(req.ctx);
    if (!link) {
      res.json({ partner: null });
      return;
    }
    const otherId = partnerHouseholdId(link, req.ctx.householdId);
    const user = await req.ctx.db.get<{ name: string; avatar: string | null; id: number }>(
      'SELECT id, name, avatar FROM users WHERE household_id = ? ORDER BY id LIMIT 1',
      [otherId],
    );
    res.json({
      partner: user ? { name: user.name, color: personColor(user.avatar, user.id) } : null,
    });
  });

  r.post('/invites', async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email().optional() }), req.body ?? {});
    if (await householdHasActiveLink(req.ctx.db, req.ctx.householdId)) throw badRequest('Esta casa já está vinculada');
    const code = newCode();
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
    await insert(req.ctx.db, 'couple_invites', {
      inviter_household_id: req.ctx.householdId,
      inviter_user_id: req.ctx.userId,
      code_hash: hashInviteCode(code),
      invitee_email: body.email ?? null,
      expires_at: expires,
      created_at: nowIso(),
    });
    res.status(201).json({ code, expires_at: expires });
  });

  r.post('/invites/accept', async (req, res) => {
    const body = parse(z.object({ code: z.string().trim().min(4).max(32) }), req.body);
    const hash = hashInviteCode(body.code);
    const invite = await req.ctx.db.get<{
      id: number;
      inviter_household_id: number;
      invitee_email: string | null;
      expires_at: string;
      code_hash: string;
    }>(
      `SELECT id, inviter_household_id, invitee_email, expires_at, code_hash
         FROM couple_invites WHERE code_hash = ? AND accepted_by_user_id IS NULL`,
      [hash],
    );
    const hashBuf = Buffer.from(hash, 'hex');
    const stored = invite ? Buffer.from(invite.code_hash, 'hex') : hashBuf;
    if (!invite || stored.length !== hashBuf.length || !timingSafeEqual(stored, hashBuf) || invite.expires_at <= nowIso()) {
      throw badRequest('Convite inválido ou expirado');
    }
    if (invite.inviter_household_id === req.ctx.householdId) throw badRequest('O convite é para outra casa');
    if (invite.invitee_email) {
      const me = await req.ctx.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [req.ctx.userId]);
      if (!me || me.email.toLowerCase() !== invite.invitee_email) throw badRequest('Este convite foi feito para outro e-mail');
    }
    if (await householdHasActiveLink(req.ctx.db, req.ctx.householdId)) throw badRequest('Esta casa já está vinculada');
    if (await householdHasActiveLink(req.ctx.db, invite.inviter_household_id)) throw badRequest('A outra casa já está vinculada');
    const [low, high] = orderedPair(req.ctx.householdId, invite.inviter_household_id);
    const now = nowIso();
    const linkId = await req.ctx.db.tx(async (db) => {
      const id = await insert(db, 'couple_links', {
        household_low_id: low,
        household_high_id: high,
        status: 'active',
        created_at: now,
        accepted_at: now,
      });
      await update(db, 'couple_invites', invite.id, { accepted_by_user_id: req.ctx.userId, couple_link_id: id });
      return id;
    });
    res.status(201).json({ id: linkId });
  });

  r.delete('/', async (req, res) => {
    const link = await activeLink(req.ctx);
    if (!link) throw notFound('Vínculo');
    await update(req.ctx.db, 'couple_links', link.id, { status: 'revoked', revoked_at: nowIso() });
    res.status(204).end();
  });

  return r;
}
