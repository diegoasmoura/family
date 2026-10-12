import { Router } from 'express';
import { z } from 'zod';
import {
  AVATAR_COLORS,
  AVATAR_ITEMS,
  AVATAR_SKINS,
  XP_VALUES,
  addMonths,
  avatarTitle,
  daysInMonth,
  isoWeek,
  levelFromXp,
  levelProgress,
  normalizeAvatar,
  monthOf,
  nextStreak,
  visibleStreak,
  type StreakState,
  type XpEventType,
} from '@fin/domain';
import { badRequest, insert, nowIso, num, parse, zMonth, type Ctx } from '../core';
import { monthTotals, spentWithChildren } from './queries';

export interface XpResult {
  xp: number;
  achievements: string[];
  /** Novo nível, quando o XP fez o usuário subir. */
  level_up?: number;
}

async function totalXp(ctx: Ctx, userId: number) {
  const row = await ctx.db.get<{ total: number }>('SELECT SUM(xp) AS total FROM xp_events WHERE user_id = ?', [userId]);
  return num(row?.total);
}

/** Avatares do household, com o usuário atual primeiro. */
export async function householdAvatars(ctx: Ctx) {
  const users = await ctx.db.all<{ id: number; name: string; avatar: string | null }>('SELECT id, name, avatar FROM users WHERE household_id = ? ORDER BY id', [
    ctx.householdId,
  ]);
  const out = [];
  for (const u of users) {
    const progress = levelProgress(await totalXp(ctx, Number(u.id)));
    out.push({
      id: Number(u.id),
      name: u.name,
      me: Number(u.id) === ctx.userId,
      ...progress,
      title: avatarTitle(progress.level),
      avatar: normalizeAvatar(u.avatar, progress.level, Number(u.id)),
    });
  }
  return out.sort((a, b) => Number(b.me) - Number(a.me));
}

async function unlock(ctx: Ctx, userId: number, code: string): Promise<boolean> {
  const has = await ctx.db.get('SELECT 1 AS x FROM user_achievements WHERE user_id = ? AND code = ?', [userId, code]);
  if (has) return false;
  await ctx.db.run('INSERT INTO user_achievements (user_id, code, unlocked_at) VALUES (?, ?, ?)', [userId, code, nowIso()]);
  return true;
}

async function touchStreak(ctx: Ctx, userId: number): Promise<StreakState> {
  const row = await ctx.db.get<StreakState>('SELECT current_days, longest_days, last_activity_date FROM streaks WHERE user_id = ?', [userId]);
  const state = row ?? { current_days: 0, longest_days: 0, last_activity_date: null };
  const next = nextStreak(state, ctx.today);
  if (!row) {
    await ctx.db.run('INSERT INTO streaks (user_id, current_days, longest_days, last_activity_date) VALUES (?, ?, ?, ?)', [
      userId,
      next.current_days,
      next.longest_days,
      next.last_activity_date,
    ]);
  } else if (next !== state) {
    await ctx.db.run('UPDATE streaks SET current_days = ?, longest_days = ?, last_activity_date = ? WHERE user_id = ?', [
      next.current_days,
      next.longest_days,
      next.last_activity_date,
      userId,
    ]);
  }
  return next;
}

/**
 * Registra XP (fonte da verdade) e atualiza a sequência. Com refKey o evento
 * vale uma vez só por usuário.
 */
export async function awardXp(
  ctx: Ctx,
  type: XpEventType,
  xp: number,
  opts: { refId?: number; refKey?: string; userId?: number } = {},
): Promise<XpResult> {
  const userId = opts.userId ?? ctx.userId;
  if (opts.refKey) {
    const dup = await ctx.db.get('SELECT id FROM xp_events WHERE user_id = ? AND type = ? AND ref_key = ?', [userId, type, opts.refKey]);
    if (dup) return { xp: 0, achievements: [] };
  }
  const before = levelFromXp(await totalXp(ctx, userId));
  await insert(ctx.db, 'xp_events', {
    user_id: userId,
    type,
    xp,
    ref_id: opts.refId ?? null,
    ref_key: opts.refKey ?? null,
    activity_on: ctx.today,
    created_at: nowIso(),
  });
  const achievements: string[] = [];
  const streak = await touchStreak(ctx, userId);
  if (streak.current_days >= 7 && (await unlock(ctx, userId, 'streak_7'))) achievements.push('streak_7');
  if (streak.current_days >= 30 && (await unlock(ctx, userId, 'streak_30'))) achievements.push('streak_30');
  if (type === 'tx_logged' && (await unlock(ctx, userId, 'first_tx'))) achievements.push('first_tx');
  if (type === 'goal_done' && (await unlock(ctx, userId, 'first_goal'))) achievements.push('first_goal');
  const after = levelFromXp(await totalXp(ctx, userId));
  return after > before ? { xp, achievements, level_up: after } : { xp, achievements };
}

export const logTransactionXp = (ctx: Ctx, txId: number) => awardXp(ctx, 'tx_logged', XP_VALUES.tx_logged, { refId: txId, refKey: `tx:${txId}` });

async function householdUsers(ctx: Ctx): Promise<number[]> {
  return (await ctx.db.all<{ id: number }>('SELECT id FROM users WHERE household_id = ?', [ctx.householdId])).map((u) => u.id);
}

/** Cria as missões padrão do mês e atualiza progresso e conclusão. */
export async function syncMissions(ctx: Ctx, month: string) {
  const db = ctx.db;
  const budget = await db.get<{ total: number }>('SELECT SUM(planned_cents) AS total FROM budgets WHERE household_id = ? AND month = ?', [
    ctx.householdId,
    month,
  ]);
  const budgetTotal = num(budget?.total);
  const ensure = async (type: string, target: number, reward: number) => {
    const row = await db.get('SELECT id FROM missions WHERE household_id = ? AND month = ? AND type = ?', [ctx.householdId, month, type]);
    if (!row) await insert(db, 'missions', { household_id: ctx.householdId, month, type, target, progress: 0, xp_reward: reward });
    else await db.run('UPDATE missions SET target = ? WHERE id = ? AND completed_at IS NULL', [target, row.id]);
  };
  if (budgetTotal > 0) await ensure('stay_under_budget', budgetTotal, 50);
  await ensure('log_every_day', daysInMonth(month), 100);

  const missions = await db.all('SELECT * FROM missions WHERE household_id = ? AND month = ? ORDER BY id', [ctx.householdId, month]);
  const currentMonth = monthOf(ctx.today);
  const users = await householdUsers(ctx);

  for (const m of missions) {
    if (m.completed_at) continue;
    let progress = m.progress;
    let done = false;
    if (m.type === 'stay_under_budget') {
      const budgets = await db.all<{ category_id: number }>('SELECT category_id FROM budgets WHERE household_id = ? AND month = ?', [ctx.householdId, month]);
      const spent = await spentWithChildren(ctx, month);
      progress = budgets.reduce((acc, b) => acc + (spent.get(b.category_id) ?? 0), 0);
      done = month < currentMonth && m.target > 0 && progress <= m.target;
    } else if (m.type === 'log_every_day') {
      const placeholders = users.map(() => '?').join(',');
      const row = await db.get<{ n: number }>(
        `SELECT COUNT(DISTINCT activity_on) AS n FROM xp_events
          WHERE type = 'tx_logged' AND user_id IN (${placeholders}) AND activity_on >= ? AND activity_on <= ?`,
        [...users, `${month}-01`, `${month}-31`],
      );
      progress = num(row?.n);
      done = progress >= m.target;
    }
    await db.run('UPDATE missions SET progress = ? WHERE id = ?', [progress, m.id]);
    if (done) {
      await db.run('UPDATE missions SET completed_at = ? WHERE id = ?', [nowIso(), m.id]);
      for (const uid of users) {
        await awardXp(ctx, 'mission_done', m.xp_reward, { refId: m.id, refKey: `mission:${m.id}`, userId: uid });
        if (m.type === 'stay_under_budget') await unlock(ctx, uid, 'budget_master');
      }
    }
  }
  return db.all('SELECT * FROM missions WHERE household_id = ? AND month = ? ORDER BY id', [ctx.householdId, month]);
}

export async function gamificationSummary(ctx: Ctx) {
  const total = await totalXp(ctx, ctx.userId);
  const streak =
    (await ctx.db.get<StreakState>('SELECT current_days, longest_days, last_activity_date FROM streaks WHERE user_id = ?', [ctx.userId])) ??
    ({ current_days: 0, longest_days: 0, last_activity_date: null } as StreakState);
  return {
    ...levelProgress(total),
    streak: { current_days: visibleStreak(streak, ctx.today), longest_days: streak.longest_days, last_activity_date: streak.last_activity_date },
  };
}

export function gamificationRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const ctx = req.ctx;
    const achievements = await ctx.db.all(
      `SELECT a.code, a.name, a.description, ua.unlocked_at FROM achievements a
         LEFT JOIN user_achievements ua ON ua.code = a.code AND ua.user_id = ? ORDER BY a.code`,
      [ctx.userId],
    );
    const events = await ctx.db.all('SELECT type, xp, created_at FROM xp_events WHERE user_id = ? ORDER BY id DESC LIMIT 20', [ctx.userId]);
    const week = isoWeek(ctx.today);
    const weekDone = await ctx.db.get("SELECT id FROM xp_events WHERE user_id = ? AND type = 'week_review' AND ref_key = ?", [ctx.userId, `week:${week}`]);
    const prevMonth = addMonths(monthOf(ctx.today), -1);
    const monthDone = await ctx.db.get("SELECT id FROM xp_events WHERE user_id = ? AND type = 'month_closed' AND ref_key = ?", [
      ctx.userId,
      `month:${prevMonth}`,
    ]);
    res.json({
      ...(await gamificationSummary(ctx)),
      achievements: achievements.map((a) => ({ ...a, unlocked: Boolean(a.unlocked_at) })),
      missions: await syncMissions(ctx, monthOf(ctx.today)),
      recent_events: events,
      week_review: { week, done: Boolean(weekDone) },
      month_close: { month: prevMonth, done: Boolean(monthDone) },
      members: await householdAvatars(ctx),
    });
  });

  r.put('/avatar', async (req, res) => {
    const slotItem = (slot: string) =>
      z
        .string()
        .nullable()
        .refine((id) => id === null || AVATAR_ITEMS.some((i) => i.id === id && i.slot === slot), 'Item inválido');
    const body = parse(
      z.object({
        color: z.enum(AVATAR_COLORS as [string, ...string[]]),
        skin: z.enum(AVATAR_SKINS as [string, ...string[]]),
        hat: slotItem('hat'),
        face: slotItem('face'),
        neck: slotItem('neck'),
      }),
      req.body,
    );
    const { level } = levelProgress(await totalXp(req.ctx, req.ctx.userId));
    for (const id of [body.hat, body.face, body.neck]) {
      const item = AVATAR_ITEMS.find((i) => i.id === id);
      if (item && item.level > level) throw badRequest(`${item.name} libera no nível ${item.level}`);
    }
    await req.ctx.db.run('UPDATE users SET avatar = ? WHERE id = ?', [JSON.stringify(body), req.ctx.userId]);
    res.json((await householdAvatars(req.ctx)).find((m) => m.me));
  });

  r.post('/week-review', async (req, res) => {
    const week = isoWeek(req.ctx.today);
    const result = await req.ctx.db.tx((db) => awardXp({ ...req.ctx, db }, 'week_review', XP_VALUES.week_review, { refKey: `week:${week}` }));
    res.json({ week, ...result });
  });

  r.post('/close-month', async (req, res) => {
    const body = parse(z.object({ month: zMonth }), req.body);
    if (body.month >= monthOf(req.ctx.today)) throw badRequest('Só é possível fechar meses que já terminaram');
    const result = await req.ctx.db.tx(async (db) => {
      const ctx = { ...req.ctx, db };
      const totals = await monthTotals(ctx, body.month);
      const balanced = totals.income_posted >= totals.expense_posted;
      const awarded = await awardXp(ctx, 'month_closed', XP_VALUES.month_closed, { refKey: `month:${body.month}` });
      if (awarded.xp > 0 && balanced && (await unlock(ctx, ctx.userId, 'month_balanced'))) awarded.achievements.push('month_balanced');
      return { ...awarded, balanced, totals };
    });
    res.json(result);
  });

  return r;
}
