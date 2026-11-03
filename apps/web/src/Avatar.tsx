import { AVATAR_PRESETS, AVATAR_TONES, initialsFromName, type Avatar as AvatarConfig } from '@fin/domain';

export function avatarSrc(preset: number): string {
  const drawing = AVATAR_PRESETS[preset];
  return `/avatars/${drawing.style}-${drawing.seed.toLowerCase()}.svg`;
}

/** Quadrado arredondado: o desenho escolhido, ou as iniciais no tom. */
export function AvatarFigure({ name, avatar, size = 40, label, fill = false }: { name: string; avatar: AvatarConfig; size?: number; label?: string; fill?: boolean }) {
  const paint = AVATAR_TONES[avatar.tone] ?? AVATAR_TONES[0];
  const drawing = avatar.preset != null ? AVATAR_PRESETS[avatar.preset] : null;
  return (
    <span
      className="avatar"
      style={{
        ...(fill ? { width: '100%', height: '100%' } : { width: size, height: size }),
        background: drawing ? 'transparent' : paint.bg,
        color: paint.fg,
        fontSize: fill ? undefined : Math.round(size * 0.38),
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {drawing ? <img src={avatarSrc(avatar.preset as number)} alt="" /> : initialsFromName(name)}
    </span>
  );
}
