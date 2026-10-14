import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '@fin/db';
import webpush from 'web-push';
import { insert, nowIso, parse } from '../core';

export function pushRouter(): Router {
  const r = Router();
  r.get('/key', (_req, res) => {
    res.json({ key: process.env.VAPID_PUBLIC ?? null });
  });
  r.post('/subscribe', async (req, res) => {
    const body = parse(
      z.object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      }),
      req.body,
    );
    const existing = await req.ctx.db.get('SELECT id FROM push_subscriptions WHERE endpoint = ?', [body.endpoint]);
    if (!existing) {
      await insert(req.ctx.db, 'push_subscriptions', {
        user_id: req.ctx.userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        created_at: nowIso(),
      });
    }
    res.status(204).end();
  });
  r.delete('/subscribe', async (req, res) => {
    const body = parse(z.object({ endpoint: z.string().min(1) }), req.body);
    await req.ctx.db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [req.ctx.userId, body.endpoint]);
    res.status(204).end();
  });
  return r;
}

/** Uma vez por dia, às 8h no fuso da casa, se houver vencimento. O texto não leva valor. */
export function startDailyPush(db: Db) {
  const tick = () => {
    void runDailyPush(db).catch((err) => console.error('[push]', err));
  };
  const timer = setInterval(tick, 15 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function runDailyPush(db: Db) {
  const publicKey = process.env.VAPID_PUBLIC;
  const privateKey = process.env.VAPID_PRIVATE;
  if (!publicKey || !privateKey) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:financas@localhost', publicKey, privateKey);
  const houses = await db.all<{ id: number; timezone: string }>('SELECT id, timezone FROM households');
  for (const house of houses) {
    const tz = house.timezone || 'America/Sao_Paulo';
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (hour !== 8) continue;
    const due = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions
        WHERE household_id = ? AND deleted_at IS NULL AND status = 'planned' AND card_id IS NULL
          AND COALESCE(due_on, occurred_on) = ?`,
      [house.id, date],
    );
    const invoices = await db.all<{ remaining: number }>(
      `SELECT COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.invoice_id = i.id AND t.deleted_at IS NULL), 0)
              + COALESCE(i.adjustment_cents, 0)
              - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0) AS remaining
         FROM invoices i JOIN credit_cards c ON c.id = i.card_id
        WHERE c.household_id = ? AND c.deleted_at IS NULL AND i.due_date = ?`,
      [house.id, date],
    );
    if (Number(due?.n ?? 0) === 0 && !invoices.some((row) => Number(row.remaining) > 0)) continue;
    const subs = await db.all<{ id: number; endpoint: string; p256dh: string; auth: string }>(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
         FROM push_subscriptions s JOIN users u ON u.id = s.user_id
        WHERE u.household_id = ? AND (s.last_notified_on IS NULL OR s.last_notified_on <> ?)`,
      [house.id, date],
    );
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, 'Há vencimentos hoje');
        await db.run('UPDATE push_subscriptions SET last_notified_on = ? WHERE id = ?', [date, sub.id]);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.run('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
      }
    }
  }
}
