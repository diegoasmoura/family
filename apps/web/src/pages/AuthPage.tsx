import { useEffect, useState, type FormEvent } from 'react';
import { api, useAction, useApi } from '../api';
import { ErrorText, Icon, Seg } from '../ui';

export function AuthPage() {
  const options = useApi<{ register_open: boolean }>('/auth/options');
  const canRegister = options.data?.register_open === true;
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', household_name: '' });
  const [show, setShow] = useState(false);
  const [confirmPw, setConfirmPw] = useState('');
  const mismatch = mode === 'register' && confirmPw !== '' && confirmPw !== form.password;
  useEffect(() => {
    if (!canRegister && mode === 'register') setMode('login');
  }, [canRegister, mode]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const action = useAction(() =>
    mode === 'login'
      ? api('/auth/login', { body: { email: form.email, password: form.password } })
      : api('/auth/register', { body: { ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.mutate(undefined);
  };

  return (
    <main className="auth">
      <div className="logo" aria-hidden>
        R$
      </div>
      <h1 style={{ fontSize: 26 }}>Finanças do casal</h1>
      <p className="muted" style={{ margin: 0 }}>
        Quanto temos, quanto já foi, quanto ainda vai e como o mês vai fechar.
      </p>
      {canRegister && (
        <Seg
          label="Acesso"
          value={mode}
          onChange={setMode}
          options={[
            ['login', 'Entrar'],
            ['register', 'Criar casa'],
          ]}
        />
      )}
      <form className="stack" onSubmit={submit}>
        {mode === 'register' && (
          <>
            <label className="f">
              <span>Nome da casa</span>
              <input value={form.household_name} onChange={set('household_name')} placeholder="Ex.: Diego e Jhersyka" required />
            </label>
            <label className="f">
              <span>Seu nome</span>
              <input value={form.name} onChange={set('name')} autoComplete="name" required />
            </label>
          </>
        )}
        <label className="f">
          <span>E-mail</span>
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </label>
        <label className="f">
          <span>Senha</span>
          <span className="pw">
            <input
              type={show ? 'text' : 'password'}
              value={form.password}
              onChange={set('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />
            <button type="button" className="ic" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show} onClick={() => setShow((s) => !s)}>
              {show ? <Icon.eyeOff /> : <Icon.eye />}
            </button>
          </span>
        </label>
        {mode === 'register' && (
          <label className="f">
            <span>Repita a senha</span>
            <input type={show ? 'text' : 'password'} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {mismatch && <p className="err">As senhas não conferem.</p>}
        <ErrorText error={action.error} />
        <button className="btn big" disabled={action.isPending || mismatch}>
          {mode === 'login' ? 'Entrar' : 'Criar e entrar'}
        </button>
      </form>
    </main>
  );
}
