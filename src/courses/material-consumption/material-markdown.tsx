// Renderer Markdown del consumo automático de materiales (6D-B).
//
// Reutiliza `ReactMarkdown` + `remarkGfm` (las mismas dependencias que las
// unidades legacy) y respeta el contrato 6D-A:
//
//   · sin HTML crudo (`skipHtml`, sin `rehype-raw`, sin `dangerouslySetInnerHTML`);
//   · `mermaid` se dibuja con `MermaidDiagram` y `youtube` con `VideoEmbed`, sin
//     reinterpretar sus reglas: el parser del contrato sigue siendo el único juez;
//   · las imágenes sólo se aceptan si viven bajo el prefijo del propio material;
//   · los enlaces sólo admiten anclas internas o `http(s)` con `rel="noreferrer"`;
//   · los encabezados no cambian de nivel y sus anclas usan `anchorIdOf`, las
//     mismas que calcula el parser para el índice del material.
import { isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown, { type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram, type Theme } from "../shared/mermaid-diagram";
import { VideoEmbed } from "../shared/video-embed";
import { anchorIdOf } from "./material-contract.ts";
import { toLessonVideo } from "./material-youtube.ts";

export type MaterialMarkdownProps = {
  source: string;
  theme: Theme;
  /** Prefijo de assets del material: `/materiales/<asignatura>/<unidad>/<slug>/`. */
  assetPrefix: string;
};

/** Texto plano de un nodo de React (el contenido de un `<code>` o de un encabezado). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child)).join("");
  return "";
}

type FenceInfo = { language: string | null; text: string };

/** Reconoce un bloque cercado a partir del `<code>` que React Markdown ya generó. */
function fenceInfoOf(children: ReactNode): FenceInfo | null {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return null;
  if (children.type !== "code") return null;
  const className = children.props.className ?? "";
  const match = /language-([a-z0-9-]+)/i.exec(className);
  return {
    language: match === null ? null : match[1].toLowerCase(),
    text: textOf(children.props.children).replace(/\n$/, ""),
  };
}

function MaterialImage({ src, alt, title, assetPrefix }: {
  src: string | undefined;
  alt: string | undefined;
  title: string | undefined;
  assetPrefix: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = typeof alt === "string" ? alt.trim() : "";
  const safeSrc = typeof src === "string" && src.startsWith(assetPrefix) ? src : null;

  // React Markdown envuelve una imagen suelta en un párrafo. Por eso todas las
  // ramas devuelven elementos en línea (`span`): un `figure`, un `p` o un `div`
  // dentro de un `p` producen HTML inválido y errores de React.
  if (safeSrc === null || label.length === 0) {
    return <span className="material-image-note" role="note">No pudimos mostrar esta imagen del material.</span>;
  }
  if (failed) {
    return <span className="material-image-note" role="note">No pudimos cargar la imagen: {label}</span>;
  }
  return <span className="material-figure">
    <img src={safeSrc} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    {typeof title === "string" && title.trim().length > 0 && <span className="material-figure-caption">{title}</span>}
  </span>;
}

export function MaterialMarkdown({ source, theme, assetPrefix }: MaterialMarkdownProps) {
  const urlTransform: UrlTransform = (url, key) => {
    if (url.startsWith("#")) return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (key === "src" && url.startsWith(assetPrefix)) return url;
    return "";
  };

  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    urlTransform={urlTransform}
    components={{
      pre({ children }) {
        const fence = fenceInfoOf(children);
        if (fence !== null && fence.language === "mermaid") {
          return <MermaidDiagram chart={fence.text} theme={theme} />;
        }
        if (fence !== null && fence.language === "youtube") {
          const video = toLessonVideo(fence.text);
          return video === null
            ? <p className="material-block-note" role="note">Este bloque de video no cumple el contrato del material: no se muestra.</p>
            : <VideoEmbed video={video} />;
        }
        return <pre>{children}</pre>;
      },
      h2({ children }) { return <h2 id={anchorIdOf(textOf(children))}>{children}</h2>; },
      h3({ children }) { return <h3 id={anchorIdOf(textOf(children))}>{children}</h3>; },
      h4({ children }) { return <h4 id={anchorIdOf(textOf(children))}>{children}</h4>; },
      a({ href, children }) {
        const target = typeof href === "string" ? href : "";
        if (target.startsWith("#")) return <a href={target}>{children}</a>;
        if (/^https?:\/\//i.test(target)) return <a href={target} target="_blank" rel="noreferrer">{children}</a>;
        return <>{children}</>;
      },
      img({ src, alt, title }) {
        return <MaterialImage src={src} alt={alt} title={title} assetPrefix={assetPrefix} />;
      },
    }}
  >{source}</ReactMarkdown>;
}
