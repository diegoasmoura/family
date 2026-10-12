import { useId, type ReactElement } from 'react';
import type { Avatar as AvatarConfig } from '@fin/domain';

const INK = '#2d2d2d';

const HATS: Record<string, ReactElement> = {
  cap: (
    <>
      <path d="M27 41C27 26 38 20 50 20s23 6 23 21z" fill="#2B70C9" />
      <path d="M62 37c10 0 19 2 22 7H62z" fill="#1d5aa8" />
      <circle cx="50" cy="21" r="2.5" fill="#1d5aa8" />
    </>
  ),
  beanie: (
    <>
      <path d="M27 42C27 24 38 18 50 18s23 6 23 24z" fill="#FF4B4B" />
      <rect x="25" y="36" width="50" height="9" rx="4.5" fill="#d93a3a" />
      <circle cx="50" cy="16" r="5.5" fill="#fff" />
    </>
  ),
  tophat: (
    <>
      <rect x="35" y="3" width="30" height="31" rx="3" fill={INK} />
      <rect x="35" y="25" width="30" height="5" fill="#FF4B4B" />
      <rect x="24" y="31" width="52" height="7" rx="3.5" fill={INK} />
    </>
  ),
  crown: (
    <>
      <path d="M29 37l2-22 9.5 10L50 11l9.5 14L69 15l2 22z" fill="#FFC800" stroke="#e0a800" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="50" cy="29" r="3" fill="#FF4B4B" />
      <circle cx="38" cy="31" r="2.2" fill="#1CB0F6" />
      <circle cx="62" cy="31" r="2.2" fill="#58CC02" />
    </>
  ),
};

const FACES: Record<string, ReactElement> = {
  glasses: (
    <g fill="rgba(255,255,255,.25)" stroke={INK} strokeWidth="2">
      <circle cx="41" cy="48" r="6.5" />
      <circle cx="59" cy="48" r="6.5" />
      <path d="M47.5 48h5" fill="none" />
    </g>
  ),
  sunglasses: (
    <g fill="#1e1e1e">
      <rect x="33" y="43" width="15" height="10" rx="4" />
      <rect x="52" y="43" width="15" height="10" rx="4" />
      <path d="M48 46h4" stroke="#1e1e1e" strokeWidth="2" />
      <path d="M36 45.5h5" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ),
};

const NECKS: Record<string, ReactElement> = {
  bowtie: (
    <>
      <path d="M50 75l-11-6v12zM50 75l11-6v12z" fill="#FF4B4B" />
      <circle cx="50" cy="75" r="3" fill="#d93a3a" />
    </>
  ),
  medal: (
    <>
      <path d="M43 70l7 12 7-12" fill="none" stroke="#1CB0F6" strokeWidth="4" strokeLinejoin="round" />
      <circle cx="50" cy="86" r="7" fill="#FFC800" stroke="#e0a800" strokeWidth="1.5" />
      <path d="M50 82.5l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z" fill="#fff" />
    </>
  ),
};

export function AvatarFigure({ avatar, size = 40, level, label }: { avatar: AvatarConfig; size?: number; level?: number; label?: string }) {
  const clip = useId();
  return (
    <span className="avatar" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 100 100">
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          <rect width="100" height="100" fill={avatar.color} />
          <circle cx="50" cy="50" r="50" fill="#fff" opacity=".12" />
          <path d="M16 100c0-20 15-30 34-30s34 10 34 30z" fill="#fff" opacity=".9" />
          <rect x="44" y="60" width="12" height="12" rx="4" fill={avatar.skin} />
          <circle cx="50" cy="46" r="22" fill={avatar.skin} />
          {!avatar.hat && <path d="M28 44c0-16 10-22 22-22s22 6 22 22c-6-8-14-11-22-11s-16 3-22 11z" fill="#4a3426" />}
          <circle cx="41" cy="48" r="2.6" fill={INK} />
          <circle cx="59" cy="48" r="2.6" fill={INK} />
          <circle cx="36" cy="55" r="3.2" fill="#ff8a8a" opacity=".45" />
          <circle cx="64" cy="55" r="3.2" fill="#ff8a8a" opacity=".45" />
          <path d="M43 56q7 6 14 0" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          {avatar.face && FACES[avatar.face]}
          {avatar.neck && NECKS[avatar.neck]}
          {avatar.hat && HATS[avatar.hat]}
        </g>
      </svg>
      {level != null && <b className="avatar-lv">{level}</b>}
    </span>
  );
}
