import { useState } from 'react';
import { AVATAR_COLORS, AVATAR_ITEMS, AVATAR_SKINS, XP_VALUES, avatarTitle, type Avatar, type AvatarSlot } from '@fin/domain';
import { AvatarFigure } from '../Avatar';
import { api, useAction, useApi, type Member } from '../api';
import { useAppState } from '../state';
import { Bar, ErrorText, Loading } from '../ui';

const SLOTS: [AvatarSlot, string][] = [
  ['hat', 'Na cabeça'],
  ['face', 'No rosto'],
  ['neck', 'No pescoço'],
];

function Editor({ me }: { me: Member }) {
  const { toast } = useAppState();
  const [draft, setDraft] = useState<Avatar>(me.avatar);
  const changed = JSON.stringify(draft) !== JSON.stringify(me.avatar);
  const save = useAction(() => api('/gamification/avatar', { method: 'PUT', body: draft }), () => toast('Avatar salvo'));
  const next = AVATAR_ITEMS.find((i) => i.level > me.level);

  return (
    <>
      <section className="card soft avatar-hero">
        <AvatarFigure avatar={draft} size={128} label={`Avatar de ${me.name}`} />
        <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <div>
            <b style={{ fontSize: 22 }}>{me.name.split(' ')[0]}</b>
            <br />
            <span className="badge">{me.title}</span>
          </div>
          <div className="hd">
            <b>Nível {me.level}</b>
            <small className="num">{me.total_xp} XP</small>
          </div>
          <Bar ratio={me.ratio} kind="xp" />
          <small>
            Faltam {me.next_level_xp - me.total_xp} XP para o nível {me.level + 1}
            {next ? ` · no nível ${next.level} libera ${next.name.toLowerCase()}` : ''}
          </small>
        </div>
      </section>

      <section className="card">
        <h2>Personalizar</h2>
        <small>Cor</small>
        <div className="color-row" role="radiogroup" aria-label="Cor do fundo">
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={`Fundo ${c}`} className={draft.color === c ? 'on' : undefined} style={{ background: c }} onClick={() => setDraft({ ...draft, color: c })} />
          ))}
        </div>
        <small>Pele</small>
        <div className="color-row" role="radiogroup" aria-label="Tom de pele">
          {AVATAR_SKINS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={draft.skin === c} aria-label={`Pele ${c}`} className={draft.skin === c ? 'on' : undefined} style={{ background: c }} onClick={() => setDraft({ ...draft, skin: c })} />
          ))}
        </div>
        {SLOTS.map(([slot, label]) => (
          <div key={slot} className="stack" style={{ gap: 8 }}>
            <small>{label}</small>
            <div className="item-grid">
              {AVATAR_ITEMS.filter((i) => i.slot === slot).map((item) => {
                const locked = item.level > me.level;
                const on = draft[slot] === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`item-card${on ? ' on' : ''}${locked ? ' locked' : ''}`}
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => setDraft({ ...draft, [slot]: on ? null : item.id })}
                  >
                    <AvatarFigure avatar={{ ...draft, [slot]: item.id }} size={56} />
                    <span>{item.name}</span>
                    <small>{locked ? `Nível ${item.level}` : on ? 'Usando' : 'Liberado'}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
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
      <h1>Avatar</h1>
      <ErrorText error={q.error} />
      {!me ? (
        <Loading />
      ) : (
        <>
          <Editor key={JSON.stringify(me.avatar)} me={me} />
          {others.length > 0 && (
            <section className="card">
              <h2>O casal</h2>
              {others.map((m) => (
                <div key={m.id} className="row" style={{ gap: 12 }}>
                  <AvatarFigure avatar={m.avatar} size={52} level={m.level} />
                  <div>
                    <b>{m.name}</b>
                    <br />
                    <small>
                      {avatarTitle(m.level)} · nível {m.level} · {m.total_xp} XP
                    </small>
                  </div>
                </div>
              ))}
            </section>
          )}
          <small>
            Cada lançamento vale {XP_VALUES.tx_logged} XP e cada meta concluída vale {XP_VALUES.goal_done} XP. Subir de nível libera novos itens para o avatar.
          </small>
        </>
      )}
    </main>
  );
}
