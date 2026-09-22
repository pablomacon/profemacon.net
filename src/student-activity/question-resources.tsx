// Render mínimo y seguro de los recursos por pregunta (Hito 6B).
//
// El pipeline 6A valida y persiste `recursos_json`; este componente es el único
// lugar donde se convierten en interfaz, y lo comparten la actividad del
// estudiante y el modo prueba docente. Sólo se admiten `image` y `code`:
// cualquier otro tipo se ignora en silencio, sin romper la página y sin mostrar
// datos crudos. Todas las comprobaciones fallan cerrado, porque aunque el
// pipeline ya valida, el frontend no debe confiar en datos inesperados.

type ImageProps = { src: string; alt: string };
type FigureProps = ImageProps & { caption: string };
type CodeProps = { content: string; title: string | null; language: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeText = (value: unknown, maxLength: number): string | null =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value : null;

// Sólo rutas internas del sitio: sin esquema, sin protocolo relativo y sin
// navegación hacia arriba. Se rechaza también la barra invertida.
function safeImageSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("..") || value.includes("\\")) return null;
  return value;
}

const ImageResource = ({ src, alt }: ImageProps) =>
  <img className="question-resource-image" data-resource-type="image" src={src} alt={alt} loading="lazy" />;

const ImageFigure = ({ src, alt, caption }: FigureProps) =>
  <figure className="question-resource-figure" data-resource-type="image">
    <img className="question-resource-image" src={src} alt={alt} loading="lazy" />
    <figcaption>{caption}</figcaption>
  </figure>;

const CodeResource = ({ content, title, language }: CodeProps) =>
  <article className="question-resource-code" data-resource-type="code">
    {(title || language) && <p className="question-resource-heading">{title}{language && <span className="question-resource-language">{language}</span>}</p>}
    <pre className="question-resource-block"><code>{content}</code></pre>
  </article>;

export function QuestionResources({ resources }: { resources: unknown }) {
  if (!Array.isArray(resources)) return null;

  const rendered = resources.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    if (entry.type === "image") {
      const src = safeImageSource(entry.src);
      const alt = safeText(entry.alt, 300);
      if (!src || !alt) return [];
      const caption = safeText(entry.caption, 300);
      return [caption ? <ImageFigure key={index} src={src} alt={alt} caption={caption} /> : <ImageResource key={index} src={src} alt={alt} />];
    }
    if (entry.type === "code") {
      const content = typeof entry.content === "string" && entry.content.length > 0 ? entry.content : null;
      if (!content) return [];
      return [<CodeResource key={index} content={content} title={safeText(entry.title, 200)} language={safeText(entry.language, 30)} />];
    }
    return [];
  });

  if (rendered.length === 0) return null;
  return <div className="question-resources">{rendered}</div>;
}
