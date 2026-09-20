import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import unit0Source from "../../../../content/programacion-i/unidad-0/material.md?raw";
import { ImageGallery, type GalleryImage } from "../../../image-gallery";
import { MermaidDiagram, type Theme } from "../../shared/mermaid-diagram";

const unitVisuals: GalleryImage[] = [
  { src: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Personal_computer,_exploded_4.svg", alt: "Computadora personal con sus principales componentes separados", title: "Componentes de una PC.", credit: "Wikimedia Commons", sourceUrl: "https://commons.wikimedia.org/wiki/File:Personal_computer,_exploded_4.svg" },
  { src: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Asus_Zenbook_UX31E_-_motherboard-48216.jpg", alt: "Placa madre de computadora portátil", title: "Placa madre.", credit: "Raimond Spekking, CC BY-SA 4.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:Asus_Zenbook_UX31E_-_motherboard-48216.jpg" },
];

const lessonSource = unit0Source
  .replace(/^---[\s\S]*?---\s*/, "")
  .split("\n# Actividad 0")[0]
  .replace(/^# .*?\n+/, "")
  .replace(/!\[Vista esquemática de una computadora personal con sus principales componentes\][\s\S]*?Licencia\/condiciones:[^\n]*\n?/i, "")
  .replace(/\n# 23\. Imágenes sugeridas para ampliar el material[\s\S]*$/, "");

function textId(children: unknown) {
  return String(children).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function Unit0({ onBack, onStartActivity, theme }: { onBack: () => void; onStartActivity: () => void; theme: Theme }) {
  return <section className="unit-view">
    <button className="back-link" onClick={onBack}>← Mis cursos</button>
    <header className="unit-hero"><p className="eyebrow">Programación I · Unidad 0</p><h1>Introducción a la programación</h1><p>Cómo una computadora procesa instrucciones y por qué los programas deben construirse mediante algoritmos precisos.</p><div className="unit-meta"><span>3 clases</span><span>90 min c/u</span><span>Material formativo</span></div><button className="button-primary" onClick={onStartActivity}>Ver actividad 0</button></header>
    <nav className="unit-context-nav" aria-label="Recorrido de la unidad"><a href="#recorrido">Recorrido</a><a href="#que-vamos-a-comprender-en-esta-unidad">Fundamentos</a><a href="#4-cpu-memoria-ram-y-almacenamiento">CPU y memoria</a><a href="#9-de-un-problema-a-un-algoritmo">Algoritmos</a><a href="#15-donde-aparece-java">Java</a><button onClick={onStartActivity}>Actividad</button></nav>
    <section className="learning-plan" id="recorrido" aria-label="Recorrido de las tres clases"><article><span>Clase 1</span><h2>La computadora</h2><p>Hardware, software, entrada, procesamiento, salida y almacenamiento.</p></article><article><span>Clase 2</span><h2>Instrucciones y algoritmos</h2><p>CPU, ejecución secuencial, control del flujo y solución de problemas.</p></article><article><span>Clase 3</span><h2>Lenguajes y Java</h2><p>Código fuente, compilación, bytecode, JVM y preparación de la actividad.</p></article></section>
    <ImageGallery images={unitVisuals} />
    <article className="lesson-content markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1({ children }) { return <h2 id={textId(children)}>{children}</h2>; }, h2({ children }) { return <h3 id={textId(children)}>{children}</h3>; }, code({ className, children, ...props }) { if (className?.includes("language-mermaid")) return <MermaidDiagram chart={String(children).replace(/\n$/, "")} theme={theme} />; return <code className={className} {...props}>{children}</code>; } }}>{lessonSource}</ReactMarkdown></article>
    <section className="unit-activity-prompt" aria-labelledby="activity-prompt-title"><div><p className="eyebrow">Actividad 0</p><h2 id="activity-prompt-title">Fundamentos de la programación</h2><p>Material formativo en revisión. La autocorrección local fue retirada para no distribuir respuestas dentro del frontend.</p></div><button className="button-primary" onClick={onStartActivity}>Ver información</button></section>
  </section>;
}

export function Unit0Activity({ onBack }: { onBack: () => void }) {
  return <section className="activity-page">
    <button className="back-link" onClick={onBack}>← Volver a la Unidad 0</button>
    <header className="activity-page-hero"><p className="eyebrow">Programación I · Unidad 0 · Actividad 0</p><h1>Fundamentos de la programación</h1><p>Esta actividad histórica queda disponible únicamente como referencia formativa.</p></header>
    <section className="activity" aria-labelledby="actividad-title">
      <div className="activity-heading"><div><p className="eyebrow">Material formativo</p><h2 id="actividad-title">Actividad en revisión</h2><p>La autocorrección local fue retirada. Repasá los contenidos de la unidad y consultá al docente por la próxima propuesta de práctica.</p></div></div>
    </section>
  </section>;
}
