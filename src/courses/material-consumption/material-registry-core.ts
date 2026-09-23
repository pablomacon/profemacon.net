// Registry de materiales v1 (Hito 6D-B): módulo PURO.
//
// Sin React, sin DOM, sin `import.meta`, sin acceso a archivos. Recibe el mapa
// `ruta → loader` que Vite genera con `import.meta.glob` desde el binding
// `material-registry.ts` y expone el catálogo de materiales v1.
//
// Principios:
//   · el descubrimiento usa SÓLO las claves (no ejecuta ningún loader);
//   · el texto de un material se lee UNA vez y se memoiza junto con su parseo;
//   · la validación la hace el parser del contrato 6D-A: aquí no hay reglas
//     nuevas ni regex propias de frontmatter;
//   · los documentos legacy (Unidad 0 y Unidad 1) no entran al catálogo v1;
//   · los documentos inválidos tampoco: nunca se renderiza algo que el pipeline
//     no aprobó;
//   · todo lo indexado vive en `Map`, de modo que claves peligrosas
//     (`constructor`, `__proto__`, `toString`) no devuelven nada.
import {
  materialAssetPrefix,
  parseContentPath,
  parseMaterialDocument,
  type MaterialIssue,
  type ParsedMaterialDocument,
} from "./material-contract.ts";

export type MaterialRef = {
  subjectCode: string;
  unitCode: string;
  slug: string;
  /** Ruta canónica dentro del repositorio: `content/<asignatura>/<unidad>/<slug>.md`. */
  contentPath: string;
  /** Prefijo de las imágenes propias del material: `/materiales/<asignatura>/<unidad>/<slug>/`. */
  assetPrefix: string;
};

export type MaterialHeading = {
  level: number;
  text: string;
  anchor: string;
};

export type MaterialMeta = {
  ref: MaterialRef;
  title: string;
  summary: string | null;
  unitTitle: string | null;
  estimatedMinutes: number | null;
  tags: string[];
  order: number;
  headings: MaterialHeading[];
  videoCount: number;
};

export type MaterialUnitMeta = {
  subjectCode: string;
  unitCode: string;
  unitTitle: string | null;
  /** Sólo materiales v1 válidos, ordenados por `order` y, ante empate, por slug. */
  materials: MaterialMeta[];
};

export type MaterialLoadStatus = "ok" | "invalid" | "legacy" | "load-error";

export type MaterialLoadResult = {
  ref: MaterialRef;
  status: MaterialLoadStatus;
  raw: string | null;
  parsed: ParsedMaterialDocument | null;
  issues: MaterialIssue[];
};

export type MaterialRegistry = {
  listSubjects(): string[];
  hasSubject(subjectCode: string): boolean;
  listUnitCodes(subjectCode: string): string[];
  listRefs(subjectCode: string, unitCode: string): MaterialRef[];
  hasMaterial(subjectCode: string, unitCode: string, slug: string): boolean;
  loadMaterial(ref: MaterialRef): Promise<MaterialLoadResult>;
  loadMaterialBySlug(subjectCode: string, unitCode: string, slug: string): Promise<MaterialLoadResult | null>;
  loadUnit(subjectCode: string, unitCode: string): Promise<MaterialUnitMeta | null>;
  loadSubject(subjectCode: string): Promise<MaterialUnitMeta[]>;
};

export type MaterialSources = Readonly<Record<string, () => Promise<string>>>;

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Número de la unidad declarada por el patrón del contrato (`unidad-<n>`). */
function unitNumber(unitCode: string): number {
  const digits = unitCode.split("-").pop() ?? "";
  return /^[0-9]+$/.test(digits) ? Number.parseInt(digits, 10) : Number.MAX_SAFE_INTEGER;
}

function compareUnitCodes(left: string, right: string): number {
  return unitNumber(left) - unitNumber(right) || compareStrings(left, right);
}

function refKeyOf(subjectCode: string, unitCode: string, slug: string): string {
  return `${subjectCode}/${unitCode}/${slug}`;
}

function unitKeyOf(subjectCode: string, unitCode: string): string {
  return `${subjectCode}/${unitCode}`;
}

/** Un separador dentro de un segmento rompería la clave interna: se rechaza. */
function areSafeParts(parts: readonly string[]): boolean {
  return parts.every((part) => typeof part === "string" && part.length > 0 && !part.includes("/") && !part.includes("\\"));
}

function issue(code: string, path: string, message: string): MaterialIssue {
  return { severity: "error", code, path, message };
}

function metaOf(result: MaterialLoadResult): MaterialMeta | null {
  if (result.status !== "ok" || result.parsed === null) return null;
  const header = result.parsed.header;
  return {
    ref: result.ref,
    title: header.title,
    summary: header.summary,
    unitTitle: header.unitTitle,
    estimatedMinutes: header.estimatedMinutes,
    tags: [...header.tags],
    order: header.order,
    headings: result.parsed.headings.map((heading) => ({ level: heading.level, text: heading.text, anchor: heading.anchor })),
    videoCount: result.parsed.videos.length,
  };
}

export function createMaterialRegistry(sources: MaterialSources): MaterialRegistry {
  const refByKey = new Map<string, MaterialRef>();
  const loaderByKey = new Map<string, () => Promise<string>>();
  const refKeysByUnit = new Map<string, string[]>();
  const unitCodesBySubject = new Map<string, Set<string>>();

  for (const [path, loader] of Object.entries(sources ?? {})) {
    if (typeof loader !== "function") continue;
    // El contrato decide qué es una ruta de material válida: nada se interpreta a mano.
    const info = parseContentPath(path);
    if (info === null) continue;
    const ref: MaterialRef = {
      subjectCode: info.subjectCode,
      unitCode: info.unitCode,
      slug: info.slug,
      contentPath: `content/${info.subjectCode}/${info.unitCode}/${info.slug}.md`,
      assetPrefix: materialAssetPrefix(info),
    };
    const key = refKeyOf(ref.subjectCode, ref.unitCode, ref.slug);
    if (refByKey.has(key)) continue;

    refByKey.set(key, ref);
    loaderByKey.set(key, loader);

    const unitKey = unitKeyOf(ref.subjectCode, ref.unitCode);
    const keys = refKeysByUnit.get(unitKey);
    if (keys === undefined) refKeysByUnit.set(unitKey, [key]);
    else keys.push(key);

    const units = unitCodesBySubject.get(ref.subjectCode);
    if (units === undefined) unitCodesBySubject.set(ref.subjectCode, new Set([ref.unitCode]));
    else units.add(ref.unitCode);
  }

  for (const keys of refKeysByUnit.values()) {
    keys.sort((left, right) => compareStrings(refByKey.get(left)?.slug ?? "", refByKey.get(right)?.slug ?? ""));
  }

  async function read(ref: MaterialRef): Promise<MaterialLoadResult> {
    const loader = loaderByKey.get(refKeyOf(ref.subjectCode, ref.unitCode, ref.slug));
    if (loader === undefined) {
      return {
        ref, status: "load-error", raw: null, parsed: null,
        issues: [issue("MATERIAL_NOT_DISCOVERED", ref.contentPath, "El material no forma parte del índice de contenido.")],
      };
    }
    let raw: string;
    try {
      raw = await loader();
    } catch {
      return {
        ref, status: "load-error", raw: null, parsed: null,
        issues: [issue("MATERIAL_LOAD_FAILED", ref.contentPath, "No pudimos leer el archivo del material.")],
      };
    }
    // `assets: null`: en el navegador no hay índice de assets; el pipeline ya
    // comprobó la existencia física de las imágenes al instalar.
    const result = parseMaterialDocument(raw, { contentPath: ref.contentPath, assets: null });
    if (result.kind === "legacy-material") return { ref, status: "legacy", raw, parsed: null, issues: result.issues };
    if (result.parsed === null || result.kind !== "material-v1") return { ref, status: "invalid", raw, parsed: null, issues: result.issues };
    return { ref, status: "ok", raw, parsed: result.parsed, issues: result.issues };
  }

  const materialMemo = new Map<string, Promise<MaterialLoadResult>>();

  function loadMaterial(ref: MaterialRef): Promise<MaterialLoadResult> {
    const key = refKeyOf(ref.subjectCode, ref.unitCode, ref.slug);
    const cached = materialMemo.get(key);
    if (cached !== undefined) return cached;
    const canonical = refByKey.get(key) ?? ref;
    const pending = read(canonical);
    materialMemo.set(key, pending);
    return pending;
  }


  const unitMemo = new Map<string, Promise<MaterialUnitMeta | null>>();

  function loadUnit(subjectCode: string, unitCode: string): Promise<MaterialUnitMeta | null> {
    const key = unitKeyOf(subjectCode, unitCode);
    const cached = unitMemo.get(key);
    if (cached !== undefined) return cached;
    const pending = (async (): Promise<MaterialUnitMeta | null> => {
      const keys = refKeysByUnit.get(key) ?? [];
      const results = await Promise.all(keys.map((refKey) => {
        const ref = refByKey.get(refKey);
        return ref === undefined ? Promise.resolve(null) : loadMaterial(ref);
      }));
      const materials = results
        .map((result) => (result === null ? null : metaOf(result)))
        .filter((meta): meta is MaterialMeta => meta !== null)
        .sort((left, right) => left.order - right.order || compareStrings(left.ref.slug, right.ref.slug));
      if (materials.length === 0) return null;
      const withTitle = materials.find((meta) => meta.unitTitle !== null);
      return { subjectCode, unitCode, unitTitle: withTitle?.unitTitle ?? null, materials };
    })();
    unitMemo.set(key, pending);
    return pending;
  }

  const subjectMemo = new Map<string, Promise<MaterialUnitMeta[]>>();

  function loadSubject(subjectCode: string): Promise<MaterialUnitMeta[]> {
    const cached = subjectMemo.get(subjectCode);
    if (cached !== undefined) return cached;
    const pending = (async (): Promise<MaterialUnitMeta[]> => {
      const unitCodes = [...(unitCodesBySubject.get(subjectCode) ?? [])].sort(compareUnitCodes);
      const units = await Promise.all(unitCodes.map((unitCode) => loadUnit(subjectCode, unitCode)));
      return units.filter((unit): unit is MaterialUnitMeta => unit !== null);
    })();
    subjectMemo.set(subjectCode, pending);
    return pending;
  }

  return {
    listSubjects: () => [...unitCodesBySubject.keys()].sort(compareStrings),
    hasSubject: (subjectCode) => typeof subjectCode === "string" && unitCodesBySubject.has(subjectCode),
    listUnitCodes: (subjectCode) => [...(unitCodesBySubject.get(subjectCode) ?? [])].sort(compareUnitCodes),
    listRefs: (subjectCode, unitCode) => {
      if (!areSafeParts([subjectCode, unitCode])) return [];
      const keys = refKeysByUnit.get(unitKeyOf(subjectCode, unitCode)) ?? [];
      const refs: MaterialRef[] = [];
      for (const key of keys) {
        const ref = refByKey.get(key);
        if (ref !== undefined) refs.push(ref);
      }
      return refs;
    },
    hasMaterial: (subjectCode, unitCode, slug) => {
      if (!areSafeParts([subjectCode, unitCode, slug])) return false;
      return refByKey.has(refKeyOf(subjectCode, unitCode, slug));
    },
    loadMaterial,
    loadMaterialBySlug: async (subjectCode, unitCode, slug) => {
      if (!areSafeParts([subjectCode, unitCode, slug])) return null;
      const ref = refByKey.get(refKeyOf(subjectCode, unitCode, slug));
      return ref === undefined ? null : loadMaterial(ref);
    },
    loadUnit: async (subjectCode, unitCode) => {
      if (!areSafeParts([subjectCode, unitCode])) return null;
      return loadUnit(subjectCode, unitCode);
    },
    loadSubject: async (subjectCode) => {
      if (typeof subjectCode !== "string" || subjectCode.length === 0 || subjectCode.includes("/")) return [];
      return loadSubject(subjectCode);
    },
  };
}

