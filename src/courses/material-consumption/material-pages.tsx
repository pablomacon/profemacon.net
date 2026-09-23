// Páginas genéricas del consumo automático de materiales (6D-B).
//
// Ninguna de las tres páginas conoce una asignatura, una unidad o un material en
// particular: todo sale del registry, que a su vez sale de `content/` y del
// contrato 6D-A. Instalar un material nuevo no requiere tocar este archivo.
//
//   MaterialCoursePage  /curso/:subjectCode
//   MaterialUnitPage    /curso/:subjectCode/:unitCode
//   MaterialPage        /curso/:subjectCode/:unitCode/:slug
import { useEffect, useState } from "react";
import type { Theme } from "../shared/mermaid-diagram";
import { MaterialMarkdown } from "./material-markdown.tsx";
import { materialRegistry } from "./material-registry.ts";
import type { MaterialLoadResult, MaterialMeta, MaterialUnitMeta } from "./material-registry-core.ts";
import { coursePath, materialPath, unitPath } from "./material-routing.ts";

export type MaterialNavigation = {
  onNavigate: (path: string) => void;
};

type QueryState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error" };

/**
 * Consulta memoizada contra el registry. `key` reúne todas las entradas de la
 * consulta (la ruta completa), de modo que cambiar de material cambia la clave.
 */
function useMaterialQuery<T>(key: string, load: () => Promise<T>): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    load()
      .then((value) => { if (!cancelled) setState({ status: "ready", value }); })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, [key]);
  return state;
}

/** `unidad-2` → `Unidad 2`. Etiqueta de presentación, nunca una ruta. */
function unitLabel(unitCode: string): string {
  const digits = unitCode.split("-").pop() ?? "";
  return /^[0-9]+$/.test(digits) ? `Unidad ${Number.parseInt(digits, 10)}` : unitCode;
}

function MaterialChips({ estimatedMinutes, tags }: { estimatedMinutes: number | null; tags: readonly string[] }) {
  if (estimatedMinutes === null && tags.length === 0) return null;
  return <div className="unit-meta material-meta">
    {estimatedMinutes !== null && <span>{estimatedMinutes} min</span>}
    {tags.map((tag) => <span key={tag}>{tag}</span>)}
  </div>;
}

function MaterialFeedback({ label, title, detail, action, alert = false, onNavigate }: {
  label: string;
  title: string;
  detail: string;
  action?: { text: string; onClick: () => void };
  alert?: boolean;
  onNavigate: (path: string) => void;
}) {
  return <section className="unit-view" aria-live={alert ? "assertive" : "polite"}>
    <button className="back-link" onClick={() => onNavigate("/mis-cursos")}>← Mis cursos</button>
    <div className="material-state" role={alert ? "alert" : "status"}>
      <p className="eyebrow">{label}</p>
      <h1>{title}</h1>
      <p>{detail}</p>
      {action !== undefined && <button className="button-primary" onClick={action.onClick}>{action.text}</button>}
    </div>
  </section>;
}

/** Estado compartido para una ruta de curso bien formada que no tiene material publicado. */
export function MaterialNotFound({ onNavigate }: MaterialNavigation) {
  return <section className="unit-view">
    <button className="back-link" onClick={() => onNavigate("/mis-cursos")}>← Mis cursos</button>
    <div className="material-state" role="status">
      <p className="eyebrow">Materiales</p>
      <h1>Material no encontrado</h1>
      <p>No encontramos este material en el catálogo publicado. Puede que todavía no esté instalado o que la dirección no sea correcta.</p>
      <button className="button-primary" onClick={() => onNavigate("/mis-cursos")}>Volver a mis cursos</button>
    </div>
  </section>;
}

export function MaterialCoursePage({ subjectCode, onNavigate }: { subjectCode: string } & MaterialNavigation) {
  const query = useMaterialQuery(`subject:${subjectCode}`, () => materialRegistry.loadSubject(subjectCode));

  if (query.status === "loading") {
    return <MaterialFeedback label="Materiales" title="Cargando los materiales del curso"
      detail="Estamos consultando el índice de contenido publicado." onNavigate={onNavigate} />;
  }
  if (query.status === "error") {
    return <MaterialFeedback label="Materiales" title="No pudimos cargar los materiales"
      detail="Volvé a intentarlo en unos instantes." alert onNavigate={onNavigate}
      action={{ text: "Volver a mis cursos", onClick: () => onNavigate("/mis-cursos") }} />;
  }

  const units = query.value;
  if (units.length === 0) {
    return <MaterialFeedback label="Materiales" title="Todavía no hay materiales publicados para este curso."
      detail="Cuando se instale un material teórico con el pipeline de autoría, la unidad aparecerá acá automáticamente."
      onNavigate={onNavigate} action={{ text: "Volver a mis cursos", onClick: () => onNavigate("/mis-cursos") }} />;
  }

  return <section className="unit-view">
    <button className="back-link" onClick={() => onNavigate("/mis-cursos")}>← Mis cursos</button>
    <header className="unit-hero">
      <p className="eyebrow">Materiales del curso · {subjectCode}</p>
      <h1>Materiales del curso</h1>
      <p>Unidades con materiales teóricos publicados. Cada material llega desde el pipeline de autoría y aparece en este índice sin cambios de código.</p>
    </header>
    <ul className="material-list" aria-label="Unidades con materiales publicados">
      {units.map((unit) => <li key={unit.unitCode}>
        <article className="material-card is-unit">
          <div className="material-card-main">
            <span className="material-card-label">{unitLabel(unit.unitCode)}</span>
            <h2>{unit.unitTitle ?? unitLabel(unit.unitCode)}</h2>
            <p>{unit.materials.length === 1 ? "1 material publicado" : `${unit.materials.length} materiales publicados`}</p>
          </div>
          <button className="button-primary" onClick={() => onNavigate(unitPath(subjectCode, unit.unitCode))}>Abrir unidad</button>
        </article>
      </li>)}
    </ul>
  </section>;
}

export function MaterialUnitPage({ subjectCode, unitCode, onNavigate }: { subjectCode: string; unitCode: string } & MaterialNavigation) {
  const query = useMaterialQuery(`unit:${subjectCode}:${unitCode}`, () => materialRegistry.loadUnit(subjectCode, unitCode));

  if (query.status === "loading") {
    return <MaterialFeedback label="Materiales" title="Cargando la unidad"
      detail="Estamos consultando los materiales publicados de esta unidad." onNavigate={onNavigate} />;
  }
  if (query.status === "error") {
    return <MaterialFeedback label="Materiales" title="No pudimos cargar la unidad"
      detail="Volvé a intentarlo en unos instantes." alert onNavigate={onNavigate}
      action={{ text: "Volver a mis cursos", onClick: () => onNavigate("/mis-cursos") }} />;
  }

  const unit = query.value;
  if (unit === null) return <MaterialNotFound onNavigate={onNavigate} />;

  return <section className="unit-view">
    <button className="back-link" onClick={() => onNavigate(coursePath(subjectCode))}>← Materiales del curso</button>
    <header className="unit-hero">
      <p className="eyebrow">{subjectCode} · {unitLabel(unit.unitCode)}</p>
      <h1>{unit.unitTitle ?? unitLabel(unit.unitCode)}</h1>
      <p>Materiales teóricos de la unidad, ordenados según la secuencia de estudio.</p>
    </header>
    <ul className="material-list" aria-label={`Materiales de ${unitLabel(unit.unitCode)}`}>
      {unit.materials.map((material, index) => <li key={material.ref.slug}>
        <article className="material-card">
          <div className="material-card-main">
            <span className="material-card-label">Material {index + 1}</span>
            <h2>{material.title}</h2>
            {material.summary !== null && <p>{material.summary}</p>}
            <MaterialChips estimatedMinutes={material.estimatedMinutes} tags={material.tags} />
          </div>
          <button className="button-primary" onClick={() => onNavigate(materialPath(subjectCode, unitCode, material.ref.slug))}>Abrir material</button>
        </article>
      </li>)}
    </ul>
  </section>;
}


type MaterialPageData = {
  material: MaterialLoadResult | null;
  unit: MaterialUnitMeta | null;
};

function previousAndNext(materials: readonly MaterialMeta[], slug: string): { previous: MaterialMeta | null; next: MaterialMeta | null } {
  const index = materials.findIndex((material) => material.ref.slug === slug);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: index > 0 ? materials[index - 1] : null,
    next: index < materials.length - 1 ? materials[index + 1] : null,
  };
}

export function MaterialPage({ subjectCode, unitCode, slug, theme, onNavigate }: {
  subjectCode: string;
  unitCode: string;
  slug: string;
  theme: Theme;
} & MaterialNavigation) {
  const query = useMaterialQuery(`material:${subjectCode}:${unitCode}:${slug}`, async (): Promise<MaterialPageData> => {
    const [material, unit] = await Promise.all([
      materialRegistry.loadMaterialBySlug(subjectCode, unitCode, slug),
      materialRegistry.loadUnit(subjectCode, unitCode),
    ]);
    return { material, unit };
  });

  if (query.status === "loading") {
    return <MaterialFeedback label="Materiales" title="Cargando el material"
      detail="Estamos leyendo el material publicado." onNavigate={onNavigate} />;
  }
  if (query.status === "error") {
    return <MaterialFeedback label="Materiales" title="No pudimos cargar el material"
      detail="Volvé a intentarlo en unos instantes." alert onNavigate={onNavigate}
      action={{ text: "Volver a mis cursos", onClick: () => onNavigate("/mis-cursos") }} />;
  }

  const { material, unit } = query.value;
  if (material === null || material.status === "legacy" || material.status === "invalid" || material.parsed === null) {
    return <MaterialNotFound onNavigate={onNavigate} />;
  }
  if (material.status === "load-error") {
    return <MaterialFeedback label="Materiales" title="No pudimos cargar el material"
      detail="El material está registrado pero no pudimos leer su contenido. Volvé a intentarlo en unos instantes."
      alert onNavigate={onNavigate}
      action={{ text: "Volver a la unidad", onClick: () => onNavigate(unitPath(subjectCode, unitCode)) }} />;
  }

  const parsed = material.parsed;
  const materials = unit?.materials ?? [];
  const { previous, next } = previousAndNext(materials, slug);
  const contents = parsed.headings.filter((heading) => heading.level === 2 || heading.level === 3);

  return <section className="unit-view">
    <button className="back-link" onClick={() => onNavigate(unitPath(subjectCode, unitCode))}>← Volver a la unidad</button>
    <header className="unit-hero">
      <p className="eyebrow">{subjectCode} · {unitLabel(unitCode)}</p>
      <h1>{parsed.header.title}</h1>
      {parsed.header.summary !== null && <p>{parsed.header.summary}</p>}
      <MaterialChips estimatedMinutes={parsed.header.estimatedMinutes} tags={parsed.header.tags} />
    </header>
    {contents.length > 0 && <nav className="unit-context-nav" aria-label="Contenido del material">
      {contents.map((heading) => <a key={heading.anchor} href={`#${heading.anchor}`}>{heading.text}</a>)}
      <button onClick={() => onNavigate(unitPath(subjectCode, unitCode))}>Volver a la unidad</button>
    </nav>}
    <article className="lesson-content markdown-content">
      <MaterialMarkdown source={parsed.body} theme={theme} assetPrefix={material.ref.assetPrefix} />
    </article>
    {(previous !== null || next !== null) && <nav className="material-nav" aria-label="Otros materiales de la unidad">
      {previous !== null && <button className="button-secondary" onClick={() => onNavigate(materialPath(subjectCode, unitCode, previous.ref.slug))}>← {previous.title}</button>}
      {next !== null && <button className="button-secondary" onClick={() => onNavigate(materialPath(subjectCode, unitCode, next.ref.slug))}>{next.title} →</button>}
    </nav>}
  </section>;
}

