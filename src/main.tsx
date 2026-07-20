import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Route = "/" | "/ingresar" | "/mis-cursos" | "/historial" | "/docente" | "/practicante";
type Theme = "dark" | "light";

const navigation: { label: string; path: Route; icon: string }[] = [
  { label: "Inicio", path: "/", icon: "⌂" },
  { label: "Mis cursos", path: "/mis-cursos", icon: "▦" },
  { label: "Historial", path: "/historial", icon: "◷" },
  { label: "Docente", path: "/docente", icon: "□" },
  { label: "Practicante", path: "/practicante", icon: "◇" },
];

const navigate = (path: Route) => {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

function Layout({ route, theme, onThemeChange, children }: { route: Route; theme: Theme; onThemeChange: () => void; children: ReactNode }) {
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
            <button className="sign-in" onClick={() => navigate("/ingresar")}>Ingresar</button>
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

function App() {
  const [route, setRoute] = useState<Route>(() => (navigation.some((item) => item.path === window.location.pathname) || window.location.pathname === "/ingresar" ? window.location.pathname as Route : "/"));
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("profemacon-theme") === "light" ? "light" : "dark");
  useEffect(() => { const listener = () => setRoute(window.location.pathname as Route); window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); }, []);
  useEffect(() => { localStorage.setItem("profemacon-theme", theme); }, [theme]);

  const view = route === "/" ? <Home />
    : route === "/ingresar" ? <Placeholder section="Acceso" title="Ingresar" detail="La autenticación se incorporará en una etapa posterior, con sesiones y permisos definidos." />
    : route === "/mis-cursos" ? <Placeholder section="Cursos" title="Mis cursos" detail="Aquí se mostrarán los grupos y materiales correspondientes a cada usuario." />
    : route === "/historial" ? <Placeholder section="Archivo" title="Historial" detail="Los cursos archivados, resultados y materiales de solo lectura aparecerán en esta vista." />
    : route === "/docente" ? <Placeholder section="Administración" title="Panel docente" detail="La gestión de grupos, inscripciones y resultados se integrará sobre la base D1 local." />
    : <Placeholder section="Acompañamiento" title="Panel de practicante" detail="Esta vista se limitará a los grupos asignados explícitamente." />;

  return <Layout route={route} theme={theme} onThemeChange={() => setTheme(theme === "dark" ? "light" : "dark")}>{view}</Layout>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
