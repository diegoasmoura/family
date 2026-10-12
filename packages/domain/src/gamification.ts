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

export type AvatarSlot = 'hat' | 'face' | 'neck';

/** Itens que o XP desbloqueia; cada um ocupa um lugar do avatar. */
export const AVATAR_ITEMS: { id: string; slot: AvatarSlot; name: string; level: number }[] = [
  { id: 'cap', slot: 'hat', name: 'Boné', level: 2 },
  { id: 'glasses', slot: 'face', name: 'Óculos', level: 3 },
  { id: 'beanie', slot: 'hat', name: 'Gorro', level: 4 },
  { id: 'bowtie', slot: 'neck', name: 'Gravata borboleta', level: 5 },
  { id: 'sunglasses', slot: 'face', name: 'Óculos escuros', level: 6 },
  { id: 'tophat', slot: 'hat', name: 'Cartola', level: 7 },
  { id: 'medal', slot: 'neck', name: 'Medalha', level: 8 },
  { id: 'crown', slot: 'hat', name: 'Coroa', level: 10 },
];

export const AVATAR_COLORS = ['#58CC02', '#1CB0F6', '#CE82FF', '#FF9600', '#FF4B4B', '#FF86D0', '#00B8A9', '#2B70C9'];
export const AVATAR_SKINS = ['#FFDBB4', '#F1C27D', '#D9A066', '#B07848', '#8D5524', '#5C3A1E'];

export interface Avatar {
  color: string;
  skin: string;
  hat: string | null;
  face: string | null;
  neck: string | null;
}

export function defaultAvatar(seed = 0): Avatar {
  return { color: AVATAR_COLORS[seed % AVATAR_COLORS.length], skin: AVATAR_SKINS[1], hat: null, face: null, neck: null };
}

/** Lê o avatar salvo, descartando valores inválidos ou itens acima do nível. */
export function normalizeAvatar(raw: unknown, level: number, seed = 0): Avatar {
  const base = defaultAvatar(seed);
  let v: Partial<Avatar> = {};
  try {
    v = typeof raw === 'string' ? JSON.parse(raw) : ((raw as Partial<Avatar>) ?? {});
  } catch {
    v = {};
  }
  const item = (slot: AvatarSlot) => {
    const id = v[slot];
    const found = AVATAR_ITEMS.find((i) => i.id === id && i.slot === slot);
    return found && found.level <= level ? found.id : null;
  };
  return {
    color: AVATAR_COLORS.includes(v.color as string) ? (v.color as string) : base.color,
    skin: AVATAR_SKINS.includes(v.skin as string) ? (v.skin as string) : base.skin,
    hat: item('hat'),
    face: item('face'),
    neck: item('neck'),
  };
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
