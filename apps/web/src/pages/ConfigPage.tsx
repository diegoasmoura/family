import { useState } from 'react';
import { api, useAction, useApi, type Me } from '../api';
import { canUsePasskey, forgetLocalPasskey, registerPasskey, savedPasskeyId } from '../passkey';
import { useAppState } from '../state';
import { ErrorText, Loading, Sheet } from '../ui';

const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Rio_Branco', 'America/Noronha'];

function PasskeyCard() {
  const { toast } = useAppState();
  const available = canUsePasskey();
  const keys = useApi<{ id: number; credential_id: string; device_label: string }[]>(available ? '/auth/webauthn' : null);
  const mine = keys.data?.find((key) => key.credential_id === savedPasskeyId());
  const enable = useAction(registerPasskey, (saved) => {
    if (saved) toast('Digital ou Face ID ativados neste celular');
  });
  const disable = useAction(
    () => api(`/auth/webauthn/${mine?.id}`, { method: 'DELETE' }),
    () => {
      forgetLocalPasskey();
      toast('Desligado neste celular');
    },
  );
  if (!available) return null;
  return (
    <section className="card">
      <b>Digital ou Face ID</b>
      <small>Neste celular, o app pede a digital ou o Face ID que já estão no aparelho. A senha continua como reserva.</small>
      {mine ? (
        <button className="btn block" type="button" disabled={disable.isPending} onClick={() => disable.mutate(undefined)}>
          Desligar neste celular
        </button>
      ) : (
        <button className="btn block" type="button" disabled={enable.isPending} onClick={() => enable.mutate(undefined)}>
          Ativar neste celular
        </button>
      )}
      <ErrorText error={enable.error || disable.error} />
    </section>
  );
}

export function ConfigPage({ me }: { me: Me }) {
  const { toast } = useAppState();
  const admin = me.role === 'admin';
  const household = useApi('/households/me');
  const users = useApi<any[]>('/users');
  const [name, setName] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '' });
  const [resetFor, setResetFor] = useState<{ id: number; name: string } | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const saveHousehold = useAction(
    () => api('/households/me', { method: 'PATCH', body: { name: name ?? undefined, timezone: tz ?? undefined } }),
    () => toast('Casa atualizada'),
  );
  const addUser = useAction(
    () => api('/users', { body: form }),
    () => {
      toast('Membro adicionado');
      setAdding(false);
      setForm({ name: '', email: '', password: '', role: 'member' });
    },
  );
  const setRole = useAction(({ id, role }: { id: number; role: string }) => api(`/users/${id}`, { method: 'PATCH', body: { role } }), () => toast('Permissão atualizada'));
  const changePassword = useAction(
    () => api('/auth/password', { method: 'POST', body: passwordForm }),
    () => {
      setPasswordForm({ current_password: '', new_password: '' });
      toast('Senha alterada');
    },
  );
  const resetMemberPassword = useAction(
    () => api(`/users/${resetFor?.id}/password`, { method: 'POST', body: { password: resetPassword } }),
    () => {
      setResetFor(null);
      setResetPassword('');
      toast('Senha redefinida');
    },
  );

  return (
    <main className="page">
      <h1>Casa e usuários</h1>
      {!household.data ? (
        <Loading />
      ) : (
        <section className="card">
          <label className="f">
            <span>Nome da casa</span>
            <input value={name ?? household.data.name} onChange={(e) => setName(e.target.value)} disabled={!admin} />
          </label>
          <label className="f">
            <span>Fuso horário (define o "hoje" dos vencimentos)</span>
            <select value={tz ?? household.data.timezone} onChange={(e) => setTz(e.target.value)} disabled={!admin}>
              {[...new Set([household.data.timezone, ...TIMEZONES])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {admin && (
            <button className="btn block" onClick={() => saveHousehold.mutate(undefined)} disabled={saveHousehold.isPending || (name === null && tz === null)}>
              Salvar
            </button>
          )}
          <ErrorText error={saveHousehold.error} />
          <small>No Brasil, deixe America/Sao_Paulo. Esse fuso define o hoje dos vencimentos.</small>
        </section>
      )}

      <section className="card">
        <b>Trocar senha</b>
        <label className="f">
          <span>Senha atual</span>
          <input type="password" autoComplete="current-password" value={passwordForm.current_password} onChange={(e) => setPasswordForm((f) => ({ ...f, current_password: e.target.value }))} />
        </label>
        <label className="f">
          <span>Nova senha</span>
          <input type="password" minLength={8} autoComplete="new-password" value={passwordForm.new_password} onChange={(e) => setPasswordForm((f) => ({ ...f, new_password: e.target.value }))} />
        </label>
        <button
          className="btn block"
          disabled={changePassword.isPending || passwordForm.new_password.length < 8 || !passwordForm.current_password}
          onClick={() => changePassword.mutate(undefined)}
        >
          Salvar senha
        </button>
        <ErrorText error={changePassword.error} />
      </section>

      <PasskeyCard />

      <div className="hd">
        <h2>Membros</h2>
        {admin && (
          <button className="btn sm" onClick={() => setAdding(true)}>
            + Membro
          </button>
        )}
      </div>
      <div className="list">
        {users.data?.map((u) => (
          <div key={u.id} className="r">
            <div className="m">
              <span className="t">{u.name}</span>
              <small>{u.email}</small>
            </div>
            {admin && u.id !== me.id ? (
              <span className="row" style={{ gap: 8 }}>
                <button className="btn sm ghost" type="button" onClick={() => { setResetFor({ id: u.id, name: u.name }); setResetPassword(''); }}>
                  Nova senha
                </button>
                <select className="inp" style={{ width: 150 }} value={u.role} onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })} aria-label={`Permissão de ${u.name}`}>
                  <option value="admin">Administrador</option>
                  <option value="member">Membro</option>
                </select>
              </span>
            ) : (
              <span className="badge gray">{u.role === 'admin' ? 'Administrador' : 'Membro'}</span>
            )}
          </div>
        ))}
      </div>
      <ErrorText error={setRole.error} />
      <small>Administradores e membros lançam, pagam faturas e veem tudo da casa. No mês, Nós soma os dois; Eu mostra só o que foi marcado como seu. Só administradores adicionam pessoas, mudam permissões e arquivam contas ou cartões.</small>

      {resetFor && (
        <Sheet title={`Senha de ${resetFor.name}`} onClose={() => setResetFor(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              resetMemberPassword.mutate(undefined);
            }}
          >
            <label className="f">
              <span>Nova senha</span>
              <input type="password" minLength={8} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} autoComplete="new-password" required />
            </label>
            <ErrorText error={resetMemberPassword.error} />
            <button className="btn big" disabled={resetMemberPassword.isPending}>
              Redefinir
            </button>
          </form>
        </Sheet>
      )}

      {adding && (
        <Sheet title="Adicionar membro" onClose={() => setAdding(false)}>
          <form
            className="stack"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
              const fields = [...e.currentTarget.querySelectorAll<HTMLElement>('input, select')];
              const next = fields[fields.indexOf(e.target) + 1];
              if (!next) return;
              e.preventDefault();
              next.focus();
            }}
            onSubmit={(e) => {
              e.preventDefault();
              addUser.mutate(undefined);
            }}
          >
            <label className="f">
              <span>Nome</span>
              <input name="member-name" autoComplete="name" enterKeyHint="next" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </label>
            <label className="f">
              <span>E-mail</span>
              <input name="member-email" type="email" inputMode="email" autoComplete="email" enterKeyHint="next" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
            </label>
            <label className="f">
              <span>Senha inicial</span>
              <input name="member-password" type="password" minLength={8} enterKeyHint="done" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required autoComplete="new-password" />
            </label>
            <label className="f">
              <span>Permissão</span>
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="member">Membro</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <ErrorText error={addUser.error} />
            <button className="btn big" disabled={addUser.isPending}>
              Adicionar
            </button>
          </form>
        </Sheet>
      )}
    </main>
  );
}
