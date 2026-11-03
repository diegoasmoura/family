import { useState } from 'react';
import { AVATAR_PRESETS, AVATAR_TONES, type Avatar } from '@fin/domain';
import { AvatarFigure, avatarSrc } from '../Avatar';
import { api, useAction, useApi, type Member } from '../api';
import { useAppState } from '../state';
import { BackButton, ErrorText, Loading } from '../ui';

function sameAvatar(a: Avatar, b: Avatar) {
  return a.tone === b.tone && a.preset === b.preset;
}

function Editor({ me }: { me: Member }) {
  const { toast } = useAppState();
  const [draft, setDraft] = useState<Avatar>(me.avatar);
  const changed = !sameAvatar(draft, me.avatar);
  const save = useAction(
    () => api('/gamification/avatar', { method: 'PUT', body: draft }),
    () => toast('Avatar salvo'),
  );

  return (
    <>
      <section className="card soft avatar-hero">
        <AvatarFigure name={me.name} avatar={draft} size={96} label={`Avatar de ${me.name}`} />
        <b style={{ fontSize: 22 }}>{me.name.split(' ')[0]}</b>
      </section>

      <section className="card">
        <h2>Desenho</h2>
        <div className="avatar-picks" role="radiogroup" aria-label="Desenho do avatar">
          <button type="button" role="radio" aria-checked={draft.preset == null} aria-label="Iniciais" className={draft.preset == null ? 'on' : undefined} onClick={() => setDraft({ ...draft, preset: null })}>
            <AvatarFigure name={me.name} avatar={{ ...draft, preset: null }} fill />
          </button>
          {AVATAR_PRESETS.map((drawing, i) => (
            <button
              key={`${drawing.style}-${drawing.seed}-${i}`}
              type="button"
              role="radio"
              aria-checked={draft.preset === i}
              aria-label={`${drawing.style === 'open-peeps' ? 'Open Peeps' : 'Big Smile'} ${drawing.seed}`}
              className={draft.preset === i ? 'on' : undefined}
              onClick={() => setDraft({ ...draft, preset: i })}
            >
              <img src={avatarSrc(i)} alt="" />
            </button>
          ))}
        </div>
        <small>Open Peeps, de Pablo Stanley. Big Smile, de Ashley Seo, via DiceBear.</small>
        <h2>Cor</h2>
        <div className="color-row" role="radiogroup" aria-label="Cor das iniciais">
          {AVATAR_TONES.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="radio"
              aria-checked={draft.tone === i}
              aria-label={c.name}
              className={draft.tone === i ? 'on' : undefined}
              style={{ background: c.bg }}
              onClick={() => setDraft({ ...draft, tone: i })}
            />
          ))}
        </div>
        <ErrorText error={save.error} />
        <button className="btn block" disabled={!changed || save.isPending} onClick={() => save.mutate(undefined)}>
          Salvar avatar
        </button>
      </section>
    </>
  );
}

export function ProgressoPage() {
  const q = useApi<{ members: Member[] }>('/gamification');
  const members = q.data?.members ?? [];
  const me = members.find((m) => m.me);
  const others = members.filter((m) => !m.me);

  return (
    <main className="page">
      <div className="title-row">
        <BackButton />
        <h1>Avatar</h1>
      </div>
      <ErrorText error={q.error} />
      {!me ? (
        <Loading />
      ) : (
        <>
          <Editor key={`${me.avatar.tone}:${me.avatar.preset}`} me={me} />
          {others.length > 0 && (
            <section className="card">
              <h2>O casal</h2>
              {others.map((m) => (
                <div key={m.id} className="row" style={{ gap: 12 }}>
                  <AvatarFigure name={m.name} avatar={m.avatar} size={52} label={m.name} />
                  <b>{m.name}</b>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
