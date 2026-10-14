import { Component, useEffect, useState, type ReactNode } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ApiError, useAction, useApi, type Me } from "./api";
import { AppStateProvider } from "./state";
import { canUsePasskey, dismissPasskeyOffer, passkeyOfferDismissed, registerPasskey, savedPasskeyId } from "./passkey";
import { ErrorText, Icon, Loading, Sheet } from "./ui";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { LancamentosPage } from "./pages/LancamentosPage";
import { LancarPage } from "./pages/LancarPage";
import { CartoesPage } from "./pages/CartoesPage";
import { AnoPage } from "./pages/AnoPage";
import { MaisPage } from "./pages/MaisPage";
import { ContasPage } from "./pages/ContasPage";
import { CategoriasPage } from "./pages/CategoriasPage";
import { RecorrenciasPage, ParcelamentosPage } from "./pages/PlanosPage";
import { OrcamentoPage } from "./pages/OrcamentoPage";
import { MetasPage } from "./pages/MetasPage";
import { ProgressoPage } from "./pages/ProgressoPage";
import { ConfigPage } from "./pages/ConfigPage";
import { CalendarioPage } from "./pages/CalendarioPage";

function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const tab = (to: string, label: string, short: string, icon: JSX.Element, end = false) => (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) => (isActive ? "active" : "")}
    >
      {icon}
      <span className="tab-short">{short}</span>
      <span className="tab-long">{label}</span>
    </NavLink>
  );
  return (
    <nav className="tabbar" aria-label="Navegação principal">
      <span className="brand">Finanças do casal</span>
      {tab("/", "Início", "Início", <Icon.home />, true)}
      {tab("/lancamentos", "Lançamentos", "Lançar", <Icon.list />)}
      <span className="fab-wrap">
        <button
          className="fab"
          aria-label="Novo lançamento"
          onClick={() =>
            navigate("/lancar", {
              state: { from: location.pathname + location.search },
            })
          }
        >
          +
        </button>
      </span>
      {tab("/cartoes", "Cartões", "Cartão", <Icon.card />)}
      {tab("/ano", "Ano", "Ano", <Icon.year />)}
      {tab("/mais", "Mais", "Mais", <Icon.more />)}
    </nav>
  );
}

class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <p className="empty">
          Algo deu errado nesta tela. Volte ao início ou recarregue a página.
        </p>
      );
    return this.props.children;
  }
}

function PasskeyOffer() {
  const [open, setOpen] = useState(() => canUsePasskey() && !savedPasskeyId() && !passkeyOfferDismissed());
  const action = useAction(registerPasskey, (saved) => {
    if (saved) setOpen(false);
  });
  if (!open) return null;
  const close = () => {
    dismissPasskeyOffer();
    setOpen(false);
  };
  return (
    <Sheet title="Entrar mais rápido neste celular" onClose={close}>
      <p>Na próxima vez, o aparelho pede a digital ou o Face ID que já estão salvos nele. A senha continua valendo.</p>
      <ErrorText error={action.error} />
      <button className="btn big" type="button" disabled={action.isPending} onClick={() => action.mutate(undefined)}>
        Ativar neste celular
      </button>
      <button className="btn ghost block" type="button" onClick={close}>
        Agora não
      </button>
    </Sheet>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online ? null : <p className="offline">Sem conexão. Os dados não atualizam até a rede voltar.</p>;
}

export function App() {
  const me = useApi<Me>("/auth/me", { retry: false, staleTime: 60_000 });
  const location = useLocation();

  if (me.isLoading) return <Loading />;
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401)) {
    return (
      <p className="empty">
        Não foi possível conectar à API. Tente recarregar a página.
      </p>
    );
  }
  if (!me.data) return <AuthPage />;

  return (
    <AppStateProvider today={me.data.today}>
      <PasskeyOffer />
      <OfflineBanner />
      <div className="app">
        <PageBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<HomePage me={me.data} />} />
            <Route path="/lancamentos" element={<LancamentosPage />} />
            <Route path="/lancar" element={<LancarPage />} />
            <Route path="/cartoes" element={<CartoesPage />} />
            <Route path="/ano" element={<AnoPage />} />
            <Route path="/mais" element={<MaisPage me={me.data} />} />
            <Route path="/contas" element={<ContasPage me={me.data} />} />
            <Route path="/categorias" element={<CategoriasPage />} />
            <Route path="/recorrencias" element={<RecorrenciasPage />} />
            <Route path="/parcelamentos" element={<ParcelamentosPage />} />
            <Route path="/orcamento" element={<OrcamentoPage />} />
            <Route path="/metas" element={<MetasPage />} />
            <Route path="/progresso" element={<ProgressoPage />} />
            <Route path="/config" element={<ConfigPage me={me.data} />} />
            <Route path="/calendario" element={<CalendarioPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PageBoundary>
        <TabBar />
      </div>
    </AppStateProvider>
  );
}
