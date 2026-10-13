function normalizeHex(hex: string) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return h.length === 6 ? h.toLowerCase() : null;
}

export function sameColor(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const left = normalizeHex(a);
  const right = normalizeHex(b);
  return Boolean(left && right && left === right);
}

function hashName(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function hexToHsl(hex: string): [number, number, number] {
  const raw = normalizeHex(hex) ?? '8e9aaf';
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, s, l];
}

function hslToHex(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const part = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Cor da mesma família do grupo, estável pelo nome e diferente da cor do pai. */
export function relatedColor(parentHex: string, name: string) {
  const [hue, sat] = hexToHsl(parentHex);
  const n = hashName(name || 'sub');
  const step = 1 + (n % 8);
  const light = 0.46 + (n % 3) * 0.06;
  return hslToHex((hue + step * 36) % 360, Math.min(0.78, Math.max(0.55, sat || 0.65)), light);
}

/** Texto escuro em fundo claro e claro em fundo escuro. */
export function inkOn(hex: string) {
  const raw = normalizeHex(hex) ?? '8e9aaf';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return y > 0.64 ? '#12330a' : '#ffffff';
}
