import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const App = () => (
  <main className="portada">
    <section className="tarjeta" aria-labelledby="titulo-principal">
      <div className="logos" aria-label="Identidad visual de Profe Macón">
        <img src="/logo-profe-macon.svg" alt="Logo Profe Macón" className="logo-principal" />
        <img src="/logo-pm.svg" alt="Logo PM" className="logo-secundario" />
      </div>
      <p className="etiqueta">Beta · etapa 1</p>
      <h1 id="titulo-principal">Profe Macón 2.0</h1>
      <p className="descripcion">
        La base técnica local está funcionando con React, TypeScript, Cloudflare Workers y D1.
      </p>
      <p className="estado"><span aria-hidden="true">●</span> Entorno local preparado</p>
    </section>
  </main>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
