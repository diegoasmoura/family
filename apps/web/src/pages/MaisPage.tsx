import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Me } from '../api';
import { useTheme } from '../theme';
import { Icon, Seg } from '../ui';

const LINKS: [string, string, string][] = [
  ['/contas', 'Contas e transferências', 'Saldos, saldo inicial e transferências'],
  ['/categorias', 'Categorias', 'Categorias e subcategorias'],
  ['/recorrencias', 'Fixas', 'Receitas e despesas que se repetem'],
  ['/parcelamentos', 'Parcelamentos', 'Compras parceladas em conta ou cartão'],
  ['/orcamento', 'Orçamento', 'Planejado por categoria no mês'],
  ['/metas', 'Metas', 'Objetivos de economia'],
  ['/progresso', 'Avatar', 'Nível, XP e itens do seu avatar'],
  ['/config', 'Casa e usuários', 'Membros, fuso horário e acesso'],
];

export function MaisPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [theme, setTheme] = useTheme();
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
      <div className="list">
        {LINKS.map(([to, title, sub]) => (
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
      <small>
        Conectado como {me.name} ({me.role === 'admin' ? 'administrador' : 'membro'})
      </small>
      <button className="btn ghost block" onClick={logout}>
        Sair
      </button>
    </main>
  );
}
