import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import unit1Source from "../../../../content/programacion-i/unidad-1/material.md?raw";
import { MermaidDiagram, type Theme } from "../../shared/mermaid-diagram";
import { VideoEmbed, type LessonVideo } from "../../shared/video-embed";

const videos: LessonVideo[] = [
  { id: "video-1", title: "Video 1 · Entorno de trabajo, Java y primer programa", description: "Identificá el archivo .java, la terminal, el comando de ejecución y el resultado del programa.", youtubeId: "iZTONYPJPs8" },
  { id: "video-2", title: "Video 2 · Qué son las variables", description: "Contrastá cada ejemplo: nombre de la variable, tipo de dato y valor antes y después de una instrucción.", youtubeId: "76xkPICOb8c" },
  { id: "video-3", title: "Video 3 · Operaciones aritméticas con variables", description: "Antes de cada resultado, anticipá el valor de las variables y luego comprobalo con tus propios ejemplos.", youtubeId: "CbBvBZ9JSas" },
  { id: "video-4", title: "Video 4 · Intercambio del valor de dos variables", description: "Trazá primero los valores de a, b y auxiliar; el video confirma el razonamiento paso a paso.", youtubeId: "fIWleE2f0tE" },
];

const lessonSource = unit1Source
  .replace(/^---[\s\S]*?---\s*/, "")
  .replace(/^# .*?\n+/, "")
  .replace(/> \*\*Video 1[\s\S]*?\[Abrir video]\([^\n]+\)/, "@@video-1@@")
  .replace(/> \*\*Video 2[\s\S]*?\[Abrir video]\([^\n]+\)/, "@@video-2@@")
  .replace(/> \*\*Video 3[\s\S]*?\[Abrir video]\([^\n]+\)/, "@@video-3@@")
  .replace(/> \*\*Video 4[\s\S]*?\[Abrir video]\([^\n]+\)/, "@@video-4@@");

function textId(children: unknown) {
  return String(children).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function MarkdownSection({ source, theme }: { source: string; theme: Theme }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    h1({ children }) { return <h2 id={textId(children)}>{children}</h2>; },
    h2({ children }) { return <h3 id={textId(children)}>{children}</h3>; },
    a({ href, children }) { return <a href={href} target="_blank" rel="noreferrer">{children}</a>; },
    code({ className, children, ...props }) {
      if (className?.includes("language-mermaid")) return <MermaidDiagram chart={String(children).replace(/\n$/, "")} theme={theme} />;
      return <code className={className} {...props}>{children}</code>;
    },
  }}>{source}</ReactMarkdown>;
}

export function Unit1({ onBack, onOpenActivity, theme }: { onBack: () => void; onOpenActivity: () => void; theme: Theme }) {
  const sections = lessonSource.split(/(@@video-[1-4]@@)/);

  return <section className="unit-view">
    <button className="back-link" onClick={onBack}>← Mis cursos</button>
    <header className="unit-hero">
      <p className="eyebrow">Programación I · Unidad 1 · Borrador local</p>
      <h1>Variables, tipos de datos y operadores</h1>
      <p>Del primer programa en Java a los cálculos y algoritmos que permiten transformar datos sin perder información.</p>
      <div className="unit-meta"><span>4 clases</span><span>90 min c/u</span><span>4 videos integrados</span><span>2 actividades</span></div>
    </header>
    <nav className="unit-context-nav" aria-label="Recorrido de la unidad"><a href="#recorrido">Recorrido</a><a href="#1-que-necesitamos-para-programar-en-java">Entorno</a><a href="#3-por-que-necesitamos-variables">Variables</a><a href="#6-variables-que-participan-en-calculos">Operadores</a><a href="#8-el-problema">Algoritmo</a><a href="#actividades">Actividades</a></nav>
    <section className="learning-plan is-four" id="recorrido" aria-label="Recorrido de las cuatro clases">
      <article><span>Clase 1</span><h2>Primer programa</h2><p>Entorno de trabajo, JDK, Visual Studio Code, consola y salida por pantalla.</p></article>
      <article><span>Clase 2</span><h2>Variables y tipos</h2><p>Declaración, asignación, tipos primitivos y nombres significativos.</p></article>
      <article><span>Clase 3</span><h2>Operaciones</h2><p>Expresiones aritméticas, resultados, división y conversión de tipos.</p></article>
      <article><span>Clase 4</span><h2>Intercambio de valores</h2><p>Variable auxiliar, trazado y la importancia del orden de las instrucciones.</p></article>
    </section>
    <article className="lesson-content markdown-content unit1-content">
      {sections.map((section, index) => {
        const video = videos.find((item) => section === `@@${item.id}@@`);
        return video ? <VideoEmbed key={video.id} video={video} /> : <MarkdownSection key={index} source={section} theme={theme} />;
      })}
    </article>
    <section className="unit-activities" id="actividades" aria-labelledby="unit-activities-title">
      <div><p className="eyebrow">Actividades de la unidad</p><h2 id="unit-activities-title">Práctica y profundización</h2><p>Las actividades se organizan dentro de esta unidad y conservan sus propios intentos, resultados y habilitaciones.</p></div>
      <div className="unit-activity-list">
        <article className="unit-activity-card is-available"><div><span>Actividad 1</span><h3>Variables en Java</h3><p>12 consignas sobre tipos, declaración, asignación, actualización y lectura de código.</p><small>2 intentos · mejor resultado · aprobado desde 50 %</small></div><button className="button-primary" onClick={onOpenActivity}>Abrir actividad</button></article>
        <article className="unit-activity-card is-pending"><div><span>Actividad 2</span><h3>Profundización de variables</h3><p>Segunda actividad de la unidad, destinada a ampliar y consolidar los contenidos trabajados.</p><small>Contenido pendiente de incorporar</small></div><button className="button-secondary" disabled>Próximamente</button></article>
      </div>
    </section>
    <section className="unit-draft-note" aria-label="Estado del borrador"><p className="eyebrow">Próximo paso</p><h2>Entrega segura de la actividad</h2><p>La sesión propia ya funciona. Falta conectar las preguntas, el límite de intentos y la corrección del Worker antes de habilitar la resolución.</p></section>
  </section>;
}
