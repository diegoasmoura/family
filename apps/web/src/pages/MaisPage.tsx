import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Me } from '../api';
import { isAutoHide, setAutoHide, setHidden, useHidden } from '../privacy';
import { useTheme } from '../theme';
import { Icon, Seg } from '../ui';

const SECTIONS: { title: string; links: [string, string, string][] }[] = [
  { title: 'Planejamento', links: [
    ['/orcamento', 'Orçamento', 'Planejado por categoria no mês'],
    ['/metas', 'Metas', 'Objetivos de economia'],
    ['/recorrencias', 'Fixas', 'Receitas e despesas que se repetem'],
    ['/parcelamentos', 'Parcelamentos', 'Compras parceladas em conta ou cartão'],
  ]},
  { title: 'Cadastros', links: [
    ['/contas', 'Contas e transferências', 'Saldos, saldo inicial e transferências'],
    ['/categorias', 'Categorias', 'Categorias e subcategorias'],
  ]},
  { title: 'Casa', links: [
    ['/progresso', 'Avatar', 'Nível, XP e itens do seu avatar'],
    ['/config', 'Casa e usuários', 'Membros, fuso horário e acesso'],
  ]},
];

export function MaisPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [theme, setTheme] = useTheme();
  const hidden = useHidden();
  const [auto, setAuto] = useState(isAutoHide);
  const logout = async () => {
    await api('/auth/logout', { body: {} });
    qc.clear();
    window.location.href = '/';
  };
  return (
    <main className="page">
      <h1>Mais</h1>
      <section className="card">
        <div className="hd">
          <b>Tema</b>
          <span style={{ width: 22, height: 22, display: 'inline-flex', color: 'var(--muted)' }}>{theme === 'dark' ? <Icon.moon /> : <Icon.sun />}</span>
        </div>
        <Seg
          label="Tema"
          value={theme}
          onChange={setTheme}
          options={[
            ['light', 'Claro'],
            ['dark', 'Escuro'],
            ['system', 'Automático'],
          ]}
        />
        {theme === 'system' && <small>Segue o tema do seu celular ou computador.</small>}
      </section>
      <section className="card">
        <b>Privacidade</b>
        <label className="toggle">
          <span>Ocultar valores</span>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        </label>
        <label className="toggle">
          <span>Ocultar ao sair do app</span>
          <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoHide(e.target.checked); }} />
        </label>
        <small>Os valores ficam borrados até você tocar no olho da tela inicial.</small>
      </section>
      {SECTIONS.map((s) => (
        <section key={s.title} className="stack" style={{ gap: 6 }}>
          <h2>{s.title}</h2>
          <div className="list">
            {s.links.map(([to, title, sub]) => (
              <Link key={to} to={to} className="r">
                <div className="m">
                  <span className="t">{title}</span>
                  <small>{sub}</small>
                </div>
                <span style={{ width: 20, color: 'var(--muted)' }}>
                  <Icon.right />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <a className="btn ghost block" href="/api/export/transactions.csv" download>Exportar lançamentos (CSV)</a>
      <PushButton />
      <small>
        Conectado como {me.name} ({me.role === 'admin' ? 'administrador' : 'membro'})
      </small>
      <button className="btn ghost block" onClick={logout}>
        Sair
      </button>
    </main>
  );
}

function PushButton() {
  const [note, setNote] = useState<string | null>(null);
  const secure = typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost');
  const enable = async () => {
    if (!secure || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNote('Avisos pedem HTTPS com nome.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const { key } = await api<{ key: string | null }>('/push/key');
    if (!key) {
      setNote('O servidor ainda não tem a chave de aviso.');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(key) });
    const json = sub.toJSON();
    await api('/push/subscribe', { body: { endpoint: json.endpoint, keys: json.keys } });
    setNote('Avisos ligados neste celular.');
  };
  return (
    <>
      <button className="btn ghost block" type="button" onClick={enable}>Avisos de vencimento</button>
      {note && <small>{note}</small>}
    </>
  );
}

function vapidKey(value: string) {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
