import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import unit0Source from "../content/programacion-i/unidad-0-introduccion.md?raw";
import { ImageGallery, type GalleryImage } from "./image-gallery";

type Theme = "dark" | "light";
type Answers = Record<string, string>;

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

function MermaidDiagram({ chart, theme }: { chart: string; theme: Theme }) {
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError(false);
    void import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: theme === "dark" ? {
          background: "#20212a",
          primaryColor: "#302b4c",
          primaryTextColor: "#fbfaff",
          primaryBorderColor: "#b9b0f3",
          secondaryColor: "#26243b",
          secondaryTextColor: "#fbfaff",
          secondaryBorderColor: "#9288d5",
          tertiaryColor: "#1d1e27",
          tertiaryTextColor: "#f5f4fa",
          tertiaryBorderColor: "#5b5870",
          lineColor: "#d1cbed",
          edgeLabelBackground: "#20212a",
          clusterBkg: "#25243a",
          clusterBorder: "#77708f",
          fontFamily: "Montserrat, sans-serif",
        } : {
          background: "#ffffff",
          primaryColor: "#eeeafb",
          primaryTextColor: "#302c42",
          primaryBorderColor: "#766cad",
          secondaryColor: "#f6f4fd",
          secondaryTextColor: "#302c42",
          secondaryBorderColor: "#a9a1ce",
          tertiaryColor: "#f3f2f7",
          tertiaryTextColor: "#302c42",
          tertiaryBorderColor: "#bdbac9",
          lineColor: "#5d5775",
          edgeLabelBackground: "#ffffff",
          clusterBkg: "#f2effb",
          clusterBorder: "#b7b1d3",
          fontFamily: "Montserrat, sans-serif",
        },
        securityLevel: "strict",
        flowchart: { htmlLabels: false, useMaxWidth: true, padding: 18 },
      });
      return mermaid.render(`unit0-diagram-${instanceId}`, chart);
    }).then(({ svg: renderedSvg }) => {
      if (!cancelled) setSvg(renderedSvg);
    }).catch(() => {
      if (!cancelled) setError(true);
    });

    return () => { cancelled = true; };
  }, [chart, instanceId, theme]);

  if (error) return <pre className="diagram-fallback">{chart}</pre>;
  return <div className="mermaid-diagram" aria-label="Diagrama explicativo" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Activity0() {
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);
  const update = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }));
  const normalized = (value: string | undefined) => value?.trim().toLocaleLowerCase("es-UY") ?? "";

  const correct = {
    q1: answers.q1 === "c",
    q2: answers.q2 === "b",
    q3: answers.q3 === "a",
    q4: answers.q4 === "d",
    q5: answers.q5 === "false",
    q6: answers.q6 === "true",
    q7: answers.q7 === "false",
    q8: normalized(answers.q8) === "cpu",
    q9: normalized(answers.q9) === "bytecode",
    q10: normalized(answers.q10) === "jvm" || normalized(answers.q10) === "máquina virtual de java",
    q11: ["cpu", "ram", "almacenamiento", "entrada"].every((value, index) => answers[`q11-${index}`] === value),
    q12: ["maquina", "ensamblador", "alto-nivel", "bytecode", "jvm"].every((value, index) => answers[`q12-${index}`] === value),
    q13: answers["q13-0"] === "1" && answers["q13-1"] === "2" && answers["q13-2"] === "3" && answers["q13-3"] === "4",
  };
  const total = Object.keys(correct).length;
  const score = Object.values(correct).filter(Boolean).length;
  const state = (id: keyof typeof correct) => submitted ? (correct[id] ? "is-correct" : "is-incorrect") : "";
  const feedback = (id: keyof typeof correct, text: string) => submitted && <p className="question-feedback">{correct[id] ? "Correcto. " : "Revisá este concepto. "}{text}</p>;

  const Choice = ({ id, options }: { id: string; options: [string, string][] }) => <div className="choice-list">{options.map(([value, label]) => <label key={value}><input type="radio" name={id} value={value} checked={answers[id] === value} onChange={(event) => update(id, event.target.value)} /><span>{label}</span></label>)}</div>;
  const Select = ({ id, placeholder, options }: { id: string; placeholder: string; options: [string, string][] }) => <select className="select-answer" value={answers[id] ?? ""} onChange={(event) => update(id, event.target.value)}><option value="">{placeholder}</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;

  return <section className="activity" id="actividad-0" aria-labelledby="actividad-title">
    <div className="activity-heading"><div><p className="eyebrow">Actividad 0</p><h2 id="actividad-title">Fundamentos de la programación</h2><p>Una actividad autocorregible para consolidar los conceptos de la unidad.</p></div>{submitted && <p className="score" aria-live="polite">{score} / {total} correctas</p>}</div>
    <div className="questions">
      <article className={`question ${state("q1")}`}><p className="question-number">01</p><div className="question-body"><h3>¿Dónde se guarda un programa para que pueda permanecer cuando apagamos la computadora?</h3><Choice id="q1" options={[["a", "En la CPU"], ["b", "En la memoria RAM"], ["c", "En el almacenamiento: SSD o disco"], ["d", "En el teclado"]]} />{feedback("q1", "El almacenamiento conserva archivos y programas aun cuando se apaga el equipo.")}</div></article>
      <article className={`question ${state("q2")}`}><p className="question-number">02</p><div className="question-body"><h3>¿Cuál de estos ejemplos representa mejor una PC?</h3><Choice id="q2" options={[["a", "Una calculadora simple"], ["b", "Una computadora de escritorio"], ["c", "Un sensor de temperatura"], ["d", "Una impresora"]]} />{feedback("q2", "Una PC es una computadora de propósito general, capaz de ejecutar programas variados.")}</div></article>
      <article className={`question ${state("q3")}`}><p className="question-number">03</p><div className="question-body"><h3>¿Qué ocurre cuando una instrucción indica un salto?</h3><Choice id="q3" options={[["a", "La CPU puede continuar en otra instrucción, no necesariamente en la siguiente"], ["b", "La computadora se apaga"], ["c", "La RAM se convierte en disco"], ["d", "El programa se guarda automáticamente"]]} />{feedback("q3", "Los saltos cambian la próxima instrucción y permiten decisiones, repeticiones y alternativas.")}</div></article>
      <article className={`question ${state("q4")}`}><p className="question-number">04</p><div className="question-body"><h3>¿Cuál describe correctamente el recorrido de un programa Java?</h3><Choice id="q4" options={[["a", "Java se ejecuta directamente como cables y señales"], ["b", "El navegador transforma Java en hardware"], ["c", "La CPU lee el archivo .java sin intermediarios"], ["d", "El compilador produce bytecode y la JVM permite ejecutarlo"]]} />{feedback("q4", "Java se compila a bytecode; la JVM lo ejecuta sobre cada sistema compatible.")}</div></article>
      <article className={`question ${state("q5")}`}><p className="question-number">05</p><div className="question-body"><h3>La memoria RAM conserva su contenido aunque se apague la computadora.</h3><Choice id="q5" options={[["true", "Verdadero"], ["false", "Falso"]]} />{feedback("q5", "La RAM es rápida y temporal: su contenido se pierde al apagar el equipo.")}</div></article>
      <article className={`question ${state("q6")}`}><p className="question-number">06</p><div className="question-body"><h3>El contador de programa ayuda a indicar cuál es la próxima instrucción a ejecutar.</h3><Choice id="q6" options={[["true", "Verdadero"], ["false", "Falso"]]} />{feedback("q6", "Normalmente avanza a la siguiente instrucción; un salto puede modificarlo.")}</div></article>
      <article className={`question ${state("q7")}`}><p className="question-number">07</p><div className="question-body"><h3>Un algoritmo puede escribirse con ambigüedades porque la computadora interpretará la intención.</h3><Choice id="q7" options={[["true", "Verdadero"], ["false", "Falso"]]} />{feedback("q7", "Una computadora necesita instrucciones precisas; no infiere intenciones humanas.")}</div></article>
      <article className={`question ${state("q8")}`}><p className="question-number">08</p><div className="question-body"><h3>La sigla de la unidad que ejecuta instrucciones y realiza cálculos es:</h3><input className="fill-answer" value={answers.q8 ?? ""} onChange={(event) => update("q8", event.target.value)} placeholder="Escribí tu respuesta" />{feedback("q8", "CPU significa Unidad Central de Procesamiento.")}</div></article>
      <article className={`question ${state("q9")}`}><p className="question-number">09</p><div className="question-body"><h3>El resultado de compilar un programa Java se llama:</h3><input className="fill-answer" value={answers.q9 ?? ""} onChange={(event) => update("q9", event.target.value)} placeholder="Escribí tu respuesta" />{feedback("q9", "El compilador javac genera bytecode, habitualmente en archivos .class.")}</div></article>
      <article className={`question ${state("q10")}`}><p className="question-number">10</p><div className="question-body"><h3>La capa que permite ejecutar bytecode Java en sistemas compatibles se llama:</h3><input className="fill-answer" value={answers.q10 ?? ""} onChange={(event) => update("q10", event.target.value)} placeholder="Escribí tu respuesta" />{feedback("q10", "La JVM es la Máquina Virtual de Java.")}</div></article>
      <article className={`question ${state("q11")}`}><p className="question-number">11</p><div className="question-body"><h3>Relacioná cada componente con su función.</h3><div className="match-list">{[["Ejecuta instrucciones", "q11-0"], ["Guarda temporalmente datos e instrucciones en uso", "q11-1"], ["Conserva programas y archivos", "q11-2"], ["Permite ingresar datos", "q11-3"]].map(([label, id]) => <label key={id}><span>{label}</span><Select id={id} placeholder="Elegí un componente" options={[["cpu", "CPU"], ["ram", "Memoria RAM"], ["almacenamiento", "Almacenamiento"], ["entrada", "Periférico de entrada"]]} /></label>)}</div>{feedback("q11", "CPU, RAM, almacenamiento y periféricos cumplen funciones diferentes y complementarias.")}</div></article>
      <article className={`question ${state("q12")}`}><p className="question-number">12</p><div className="question-body"><h3>Relacioná cada concepto con su descripción.</h3><div className="match-list">{[["Lenguaje de 0 y 1", "q12-0"], ["Lenguaje simbólico cercano al hardware", "q12-1"], ["Lenguaje pensado para personas", "q12-2"], ["Resultado de compilar Java", "q12-3"], ["Entorno que ejecuta bytecode", "q12-4"]].map(([label, id]) => <label key={id}><span>{label}</span><Select id={id} placeholder="Elegí un concepto" options={[["maquina", "Código de máquina"], ["ensamblador", "Lenguaje ensamblador"], ["alto-nivel", "Lenguaje de alto nivel"], ["bytecode", "Bytecode"], ["jvm", "JVM"]]} /></label>)}</div>{feedback("q12", "Los lenguajes se diferencian por el nivel de abstracción y por cómo se traducen para ejecutar un programa.")}</div></article>
      <article className={`question ${state("q13")}`}><p className="question-number">13</p><div className="question-body"><h3>Ordená el ciclo básico de ejecución de instrucciones.</h3><div className="order-list">{[["Buscar la instrucción (fetch)", "q13-0"], ["Decodificar la instrucción", "q13-1"], ["Ejecutar la instrucción", "q13-2"], ["Determinar la próxima instrucción", "q13-3"]].map(([label, id]) => <label key={id}><span>{label}</span><Select id={id} placeholder="Orden" options={[["1", "1.º"], ["2", "2.º"], ["3", "3.º"], ["4", "4.º"]]} /></label>)}</div>{feedback("q13", "La CPU busca, decodifica y ejecuta; después determina qué instrucción seguirá.")}</div></article>
    </div>
    <div className="activity-actions"><button className="button-primary" onClick={() => setSubmitted(true)}>Corregir actividad</button>{submitted && <button className="button-secondary" onClick={() => { setAnswers({}); setSubmitted(false); }}>Intentar nuevamente</button>}</div>
  </section>;
}

export function Unit0({ onBack, onStartActivity, theme }: { onBack: () => void; onStartActivity: () => void; theme: Theme }) {
  return <section className="unit-view">
    <button className="back-link" onClick={onBack}>← Mis cursos</button>
    <header className="unit-hero"><p className="eyebrow">Programación I · Unidad 0</p><h1>Introducción a la programación</h1><p>Cómo una computadora procesa instrucciones y por qué los programas deben construirse mediante algoritmos precisos.</p><div className="unit-meta"><span>3 clases</span><span>90 min c/u</span><span>Actividad autocorregible</span></div><button className="button-primary" onClick={onStartActivity}>Ver actividad 0</button></header>
    <nav className="unit-context-nav" aria-label="Recorrido de la unidad"><a href="#recorrido">Recorrido</a><a href="#que-vamos-a-comprender-en-esta-unidad">Fundamentos</a><a href="#4-cpu-memoria-ram-y-almacenamiento">CPU y memoria</a><a href="#9-de-un-problema-a-un-algoritmo">Algoritmos</a><a href="#15-donde-aparece-java">Java</a><button onClick={onStartActivity}>Actividad</button></nav>
    <section className="learning-plan" id="recorrido" aria-label="Recorrido de las tres clases"><article><span>Clase 1</span><h2>La computadora</h2><p>Hardware, software, entrada, procesamiento, salida y almacenamiento.</p></article><article><span>Clase 2</span><h2>Instrucciones y algoritmos</h2><p>CPU, ejecución secuencial, control del flujo y solución de problemas.</p></article><article><span>Clase 3</span><h2>Lenguajes y Java</h2><p>Código fuente, compilación, bytecode, JVM y preparación de la actividad.</p></article></section>
    <ImageGallery images={unitVisuals} />
    <article className="lesson-content markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1({ children }) { return <h2 id={textId(children)}>{children}</h2>; }, h2({ children }) { return <h3 id={textId(children)}>{children}</h3>; }, code({ className, children, ...props }) { if (className?.includes("language-mermaid")) return <MermaidDiagram chart={String(children).replace(/\n$/, "")} theme={theme} />; return <code className={className} {...props}>{children}</code>; } }}>{lessonSource}</ReactMarkdown></article>
    <section className="unit-activity-prompt" aria-labelledby="activity-prompt-title"><div><p className="eyebrow">Actividad 0</p><h2 id="activity-prompt-title">Fundamentos de la programación</h2><p>13 consignas autocorregibles para comprobar conceptos sobre hardware, CPU, algoritmos y Java.</p></div><button className="button-primary" onClick={onStartActivity}>Comenzar actividad</button></section>
  </section>;
}

export function Unit0Activity({ onBack }: { onBack: () => void }) {
  return <section className="activity-page">
    <button className="back-link" onClick={onBack}>← Volver a la Unidad 0</button>
    <header className="activity-page-hero"><p className="eyebrow">Programación I · Unidad 0 · Actividad 0</p><h1>Fundamentos de la programación</h1><p>Respondé las consignas y corregí la actividad cuando hayas terminado.</p></header>
    <Activity0 />
  </section>;
}
