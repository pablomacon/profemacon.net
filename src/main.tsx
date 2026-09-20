import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Unit0 } from "./courses/programacion-i/unidad-0/lesson";
import { Unit0Activity } from "./courses/programacion-i/unidad-0/activity";
import { Unit1 } from "./courses/programacion-i/unidad-1/lesson";
import { VariablesJavaActivity1 } from "./courses/programacion-i/unidad-1/activity-variables-01";
import { Login } from "./login";
import { ActivationManagement } from "./activation-management";
import { StudentImportWizard } from "./student-import-wizard";
import { MyCourses } from "./my-courses";
import "./styles.css";

type Route = "/" | "/ingresar" | "/mis-cursos" | "/historial" | "/docente" | "/docente/importar-estudiantes" | "/docente/activaciones" | "/practicante" | "/curso/programacion-i/unidad-0" | "/curso/programacion-i/unidad-0/actividad" | "/curso/programacion-i/unidad-1" | "/curso/programacion-i/unidad-1/actividad/variables-java-01";
type Theme = "dark" | "light";
type SessionUser = { id: number; username: string; displayName: string; email: string | null; roles: string[] };
type SessionState =
  | { status: "checking" }
  | { status: "authenticated"; user: SessionUser }
  | { status: "anonymous"; reason: "missing" | "expired" }
  | { status: "error"; message: string };

const navigation: { label: string; path: Route; icon: string }[] = [
  { label: "Inicio", path: "/", icon: "⌂" },
  { label: "Mis cursos", path: "/mis-cursos", icon: "▦" },
  { label: "Historial", path: "/historial", icon: "◷" },
  { label: "Docente", path: "/docente", icon: "□" },
  { label: "Practicante", path: "/practicante", icon: "◇" },
];

const supportedRoutes: Route[] = ["/", "/ingresar", "/mis-cursos", "/historial", "/docente", "/docente/importar-estudiantes", "/docente/activaciones", "/practicante", "/curso/programacion-i/unidad-0", "/curso/programacion-i/unidad-0/actividad", "/curso/programacion-i/unidad-1", "/curso/programacion-i/unidad-1/actividad/variables-java-01"];

const navigate = (path: Route) => {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

function Layout({ route, theme, user, onThemeChange, onLogout, children }: { route: Route; theme: Theme; user: SessionUser | null; onThemeChange: () => void; onLogout: () => Promise<void>; children: ReactNode }) {
  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("/")} aria-label="Ir al inicio">
          <img src={theme === "dark" ? "/logo-profe-macon-dark.svg?v=2" : "/logo-profe-macon.svg"} alt="Profe Macón" />
        </button>

        <nav aria-label="Navegación principal">
          <p className="nav-label">Plataforma</p>
          {navigation.map((item) => (
            <button
              className={`nav-link ${route === item.path ? "is-active" : ""}`}
              key={item.path}
              onClick={() => navigate(item.path)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          Entorno local
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="mobile-brand" onClick={() => navigate("/")} aria-label="Ir al inicio">
            <img src={theme === "dark" ? "/logo-profe-macon-dark.svg?v=2" : "/logo-profe-macon.svg"} alt="PM" />
          </button>
          <div className="topbar-actions">
            <span className="environment">Beta privada</span>
            <button className="theme-toggle" onClick={onThemeChange} aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"} title={theme === "dark" ? "Modo claro" : "Modo oscuro"}>
              <span aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>
            </button>
            {user ? <div className="session-summary"><span>{user.displayName}</span><button className="sign-in" onClick={() => void onLogout()}>Salir</button></div> : <button className="sign-in" onClick={() => navigate("/ingresar")}>Ingresar</button>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function Home() {
  return (
    <section className="home-view">
      <div className="intro">
        <p className="eyebrow">Plataforma educativa</p>
        <h1>Profe Macón <span>2.0</span></h1>
        <p className="lead">Espacio central para cursos, materiales, actividades y seguimiento.</p>
        <div className="intro-actions">
          <button className="button-primary" onClick={() => navigate("/ingresar")}>Ingresar</button>
          <button className="button-secondary" onClick={() => navigate("/mis-cursos")}>Ver estructura</button>
        </div>
      </div>

      <section className="overview" aria-label="Módulos de la plataforma">
        <div className="section-heading"><p>Áreas</p><span>Etapa inicial</span></div>
        <div className="module-grid">
          <article className="module-card featured">
            <span className="module-icon">▦</span>
            <div><h2>Cursos</h2><p>Asignaturas, ediciones anuales y grupos.</p></div>
            <button onClick={() => navigate("/mis-cursos")} aria-label="Ver cursos">→</button>
          </article>
          <article className="module-card">
            <span className="module-icon">□</span>
            <div><h2>Gestión docente</h2><p>Grupos, inscripciones y habilitaciones.</p></div>
            <button onClick={() => navigate("/docente")} aria-label="Ir a gestión docente">→</button>
          </article>
          <article className="module-card">
            <span className="module-icon">◇</span>
            <div><h2>Practicantes</h2><p>Acceso acotado a grupos asignados.</p></div>
            <button onClick={() => navigate("/practicante")} aria-label="Ir a practicantes">→</button>
          </article>
        </div>
      </section>
    </section>
  );
}

function Placeholder({ title, section, detail }: { title: string; section: string; detail: string }) {
  return (
    <section className="placeholder-view">
      <p className="eyebrow">{section}</p>
      <h1>{title}</h1>
      <div className="placeholder-card">
        <div className="placeholder-mark">PM</div>
        <div><h2>Vista en preparación</h2><p>{detail}</p></div>
      </div>
    </section>
  );
}

function TeacherPanel({ user }: { user: SessionUser | null }) {
  if (!user) return <section className="placeholder-view"><p className="eyebrow">Administración</p><h1>Panel docente</h1><div className="placeholder-card"><div className="placeholder-mark">PM</div><div><h2>Sesión requerida</h2><p>Ingresá con una cuenta docente para administrar los grupos asignados.</p><button className="button-primary" onClick={() => navigate("/ingresar")}>Ingresar</button></div></div></section>;
  if (!user.roles.some((role) => role === "docente" || role === "administrador")) return <section className="placeholder-view"><p className="eyebrow">Administración</p><h1>Acceso restringido</h1><div className="placeholder-card"><div className="placeholder-mark">PM</div><div><h2>Esta cuenta no administra grupos</h2><p>El panel está disponible únicamente para docentes y administradores autorizados.</p></div></div></section>;
  return <section className="teacher-view"><p className="eyebrow">Administración</p><h1>Panel docente</h1><p className="lead">Herramientas operativas para los grupos asignados.</p><div className="teacher-actions"><article className="module-card featured"><span className="module-icon">⇧</span><div><h2>Importar estudiantes</h2><p>Leer un portafolio, validar documentos y preparar cuentas con activación.</p></div><button onClick={() => navigate("/docente/importar-estudiantes")} aria-label="Importar estudiantes">→</button></article><article className="module-card"><span className="module-icon">↻</span><div><h2>Reemitir activación</h2><p>Revocar un código perdido o vencido y entregar uno nuevo de forma individual.</p></div><button onClick={() => navigate("/docente/activaciones")} aria-label="Administrar activaciones">→</button></article><article className="module-card"><span className="module-icon">□</span><div><h2>Grupos y actividades</h2><p>La habilitación de actividades y consulta de resultados se incorporará en el siguiente recorrido.</p></div></article></div></section>;
}

function App() {
  const [route, setRoute] = useState<Route>(() => supportedRoutes.includes(window.location.pathname as Route) ? window.location.pathname as Route : "/");
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("profemacon-theme") === "light" ? "light" : "dark");
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const sessionRequestId = useRef(0);
  const user = session.status === "authenticated" ? session.user : null;
  useEffect(() => { const listener = () => setRoute(window.location.pathname as Route); window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); }, []);
  useEffect(() => { localStorage.setItem("profemacon-theme", theme); }, [theme]);

  const checkSession = useCallback(async (navigateOnSuccess = false, signal?: AbortSignal): Promise<boolean> => {
    const requestId = ++sessionRequestId.current;
    setSession({ status: "checking" });
    try {
      const response = await fetch("/api/session", { headers: { Accept: "application/json" }, signal });
      if (signal?.aborted || requestId !== sessionRequestId.current) return false;
      if (response.status === 401) {
        setSession({ status: "anonymous", reason: "missing" });
        return false;
      }
      if (!response.ok) throw new Error("El servidor no pudo verificar tu sesión.");
      const data = await response.json() as { user: SessionUser };
      if (signal?.aborted || requestId !== sessionRequestId.current) return false;
      setSession({ status: "authenticated", user: data.user });
      if (navigateOnSuccess) navigate("/mis-cursos");
      return true;
    } catch (error) {
      if (signal?.aborted || requestId !== sessionRequestId.current || (error instanceof DOMException && error.name === "AbortError")) return false;
      setSession({
        status: "error",
        message: error instanceof Error ? error.message : "No fue posible verificar tu sesión.",
      });
      return false;
    }
  }, []);
  const expireSession = useCallback(() => {
    sessionRequestId.current += 1;
    setSession({ status: "anonymous", reason: "expired" });
  }, []);

  async function refreshSession() {
    const confirmed = await checkSession(true);
    if (!confirmed) throw new Error("No pudimos confirmar tu sesión. Intentá nuevamente.");
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      sessionRequestId.current += 1;
      setSession({ status: "anonymous", reason: "missing" });
      navigate("/");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(false, controller.signal);
    return () => controller.abort();
  }, [checkSession]);

  const view = route === "/" ? <Home />
    : route === "/ingresar" ? user ? <section className="placeholder-view"><p className="eyebrow">Sesión activa</p><h1>{user.displayName}</h1><div className="placeholder-card"><div className="placeholder-mark">PM</div><div><h2>Ya ingresaste</h2><p>Podés continuar a tus cursos o cerrar la sesión desde la barra superior.</p><button className="button-primary" onClick={() => navigate("/mis-cursos")}>Ir a mis cursos</button></div></div></section> : <Login onAuthenticated={refreshSession} />
    : route === "/mis-cursos" ? <MyCourses
      session={session.status === "authenticated" ? { status: "authenticated" } : session}
      onLogin={() => navigate("/ingresar")}
      onOpenCourse={(path) => navigate(path)}
      onRetrySession={() => void checkSession()}
      onSessionExpired={expireSession}
    />
    : route === "/curso/programacion-i/unidad-0" ? <Unit0 onBack={() => navigate("/mis-cursos")} onStartActivity={() => navigate("/curso/programacion-i/unidad-0/actividad")} theme={theme} />
    : route === "/curso/programacion-i/unidad-0/actividad" ? <Unit0Activity onBack={() => navigate("/curso/programacion-i/unidad-0")} />
    : route === "/curso/programacion-i/unidad-1" ? <Unit1 onBack={() => navigate("/mis-cursos")} onOpenActivity={() => navigate("/curso/programacion-i/unidad-1/actividad/variables-java-01")} theme={theme} />
    : route === "/curso/programacion-i/unidad-1/actividad/variables-java-01" ? <VariablesJavaActivity1 onBack={() => navigate("/curso/programacion-i/unidad-1")} />
    : route === "/historial" ? <Placeholder section="Archivo" title="Historial" detail="Los cursos archivados, resultados y materiales de solo lectura aparecerán en esta vista." />
    : route === "/docente" ? <TeacherPanel user={user} />
    : route === "/docente/importar-estudiantes" ? user?.roles.some((role) => role === "docente" || role === "administrador") ? <StudentImportWizard onBack={() => navigate("/docente")} /> : <TeacherPanel user={user} />
    : route === "/docente/activaciones" ? user?.roles.some((role) => role === "docente" || role === "administrador") ? <ActivationManagement onBack={() => navigate("/docente")} /> : <TeacherPanel user={user} />
    : <Placeholder section="Acompañamiento" title="Panel de practicante" detail="Esta vista se limitará a los grupos asignados explícitamente." />;

  return <Layout route={route} theme={theme} user={user} onLogout={logout} onThemeChange={() => setTheme(theme === "dark" ? "light" : "dark")}>{view}</Layout>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
