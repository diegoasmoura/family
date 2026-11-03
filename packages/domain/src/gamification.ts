import { addDays, type ISODate } from './dates';

export type XpEventType = 'tx_logged' | 'week_review' | 'month_closed' | 'mission_done' | 'goal_done';

export const XP_VALUES: Record<Exclude<XpEventType, 'mission_done'>, number> = {
  tx_logged: 10,
  week_review: 20,
  month_closed: 50,
  goal_done: 100,
};

/** Nível derivado do XP total (não é armazenado). */
export function levelFromXp(totalXp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, totalXp) / 50)) + 1;
}

/** XP mínimo para atingir um nível. */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) ** 2;
}

export function levelProgress(totalXp: number) {
  const level = levelFromXp(totalXp);
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, total_xp: totalXp, level_floor_xp: floor, next_level_xp: next, ratio: (totalXp - floor) / (next - floor) };
}

/** Títulos do avatar: vale o maior nível já alcançado. */
export const AVATAR_TITLES: [number, string][] = [
  [1, 'Iniciante'],
  [2, 'Aprendiz'],
  [3, 'Organizado'],
  [5, 'Poupador'],
  [7, 'Investidor'],
  [10, 'Mestre das finanças'],
];

export function avatarTitle(level: number): string {
  return AVATAR_TITLES.filter(([min]) => level >= min).at(-1)![1];
}

/** Doze tons nomeados, na mesma ordem do Dihan. Fundo e texto vêm juntos. */
export const AVATAR_TONES: { name: string; bg: string; fg: string }[] = [
  { name: 'Sálvia', bg: '#6ED4A4', fg: '#1A4A38' },
  { name: 'Azul', bg: '#5B8FE8', fg: '#1E3A8A' },
  { name: 'Pêssego', bg: '#E8956A', fg: '#7A3210' },
  { name: 'Roxo', bg: '#9B7AED', fg: '#3B1A7A' },
  { name: 'Mostarda', bg: '#D4C03A', fg: '#4A4200' },
  { name: 'Rosa', bg: '#E85A7A', fg: '#7A1230' },
  { name: 'Teal', bg: '#2AAAA0', fg: '#0A4540' },
  { name: 'Coral', bg: '#E84545', fg: '#7A1515' },
  { name: 'Oliva', bg: '#9AAA3A', fg: '#3A4210' },
  { name: 'Lilás', bg: '#C85AD4', fg: '#5A1860' },
  { name: 'Âmbar', bg: '#E07A20', fg: '#6A3200' },
  { name: 'Ameixa', bg: '#A06090', fg: '#4A2048' },
];

/** Os mesmos 14 desenhos do seletor do Dihan: DiceBear Open Peeps e Big Smile. */
export const AVATAR_PRESETS: { style: 'open-peeps' | 'big-smile'; seed: string }[] = [
  { style: 'open-peeps', seed: 'Jasper' },
  { style: 'open-peeps', seed: 'Aiden' },
  { style: 'open-peeps', seed: 'Nadia' },
  { style: 'open-peeps', seed: 'Isla' },
  { style: 'open-peeps', seed: 'Kai' },
  { style: 'open-peeps', seed: 'Bianca' },
  { style: 'open-peeps', seed: 'Dante' },
  { style: 'big-smile', seed: 'Jasper' },
  { style: 'big-smile', seed: 'Aiden' },
  { style: 'big-smile', seed: 'Nadia' },
  { style: 'big-smile', seed: 'Isla' },
  { style: 'big-smile', seed: 'Kai' },
  { style: 'big-smile', seed: 'Bianca' },
  { style: 'big-smile', seed: 'Dante' },
];

export interface Avatar {
  tone: number;
  /** Índice em AVATAR_PRESETS. Sem desenho, o avatar fica nas iniciais. */
  preset: number | null;
}

/** Primeira letra do primeiro nome e do último. Um nome só usa as duas primeiras. */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  const one = parts[0] ?? '';
  return (one.slice(0, 2) || '•').toUpperCase();
}

function hashName(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Tom estável quando a pessoa ainda não escolheu uma cor. */
export function toneFromName(name: string): number {
  return hashName(name.trim()) % AVATAR_TONES.length;
}

function readTone(value: unknown, name: string): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < AVATAR_TONES.length ? value : toneFromName(name);
}

function readPreset(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < AVATAR_PRESETS.length ? value : null;
}

/** Lê o avatar salvo. Sem `tone` válido, cai na cor estável do nome. Sem desenho válido, ficam as iniciais. */
export function normalizeAvatar(raw: unknown, name: string): Avatar {
  let tone: unknown;
  let preset: unknown;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (v && typeof v === 'object') {
      tone = (v as { tone?: unknown }).tone;
      preset = (v as { preset?: unknown }).preset;
    }
  } catch {
    tone = undefined;
    preset = undefined;
  }
  return { tone: readTone(tone, name), preset: readPreset(preset) };
}

export interface StreakState {
  current_days: number;
  longest_days: number;
  last_activity_date: ISODate | null;
}

/** Atualiza a sequência para uma atividade em `day` (fuso do household). */
export function nextStreak(state: StreakState, day: ISODate): StreakState {
  if (state.last_activity_date === day) return state;
  if (state.last_activity_date && state.last_activity_date > day) return state;
  const continues = state.last_activity_date === addDays(day, -1);
  const current = continues ? state.current_days + 1 : 1;
  return { current_days: current, longest_days: Math.max(state.longest_days, current), last_activity_date: day };
}

/** Sequência exibida: se o último dia ativo foi antes de ontem, ela já quebrou. */
export function visibleStreak(state: StreakState, today: ISODate): number {
  if (!state.last_activity_date) return 0;
  return state.last_activity_date >= addDays(today, -1) ? state.current_days : 0;
}
