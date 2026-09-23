// Pruebas puras del contrato de materiales teóricos (Hito 6D-A).
// No tocan el disco: todo el contexto se inyecta, igual que en el pipeline.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MATERIAL_BYTES,
  anchorIdOf,
  checkUnitConsistency,
  detectMaterialDocumentKind,
  isMaterialV1Document,
  parseMaterialDocument,
  parseYoutubeBlock,
  sha256Hex,
  stripBom,
  type MaterialAssetEntry,
  type MaterialIssue,
  type MaterialParseResult,
} from "../worker/material-authoring.ts";

const CONTENT_PATH = "content/programacion-prueba/unidad-1/clase-prueba.md";
const IMAGE = "/materiales/programacion-prueba/unidad-1/clase-prueba/01-diagrama.webp";
const assets: MaterialAssetEntry[] = [{ path: IMAGE, bytes: 2048 }];

type Overrides = Record<string, string | null>;

function build(overrides: Overrides = {}, body = "Párrafo introductorio de prueba con suficiente contenido.\n"): string {
  const fields: Overrides = {
    schemaVersion: "1",
    slug: "clase-prueba",
    title: "Clase de prueba",
    unitCode: "unidad-1",
    order: "1",
    ...overrides,
  };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function parse(source: string, context: Record<string, unknown> = {}): MaterialParseResult {
  return parseMaterialDocument(source, { contentPath: CONTENT_PATH, assets, ...context });
}

function issuesWith(result: MaterialParseResult, code: string, severity = "error"): MaterialIssue[] {
  return result.issues.filter((issue) => issue.code === code && issue.severity === severity);
}

function expectIssue(result: MaterialParseResult, code: string, severity = "error"): MaterialParseResult {
  const found = issuesWith(result, code, severity);
  assert.ok(found.length > 0,
    `Se esperaba ${severity} ${code}; se obtuvo: ${result.issues.map((i) => `${i.severity}:${i.code}`).join(", ") || "ninguno"}`);
  if (severity === "error") {
    assert.equal(result.ok, false, "Un documento con errores no puede considerarse publicable");
    assert.equal(result.parsed, null);
  }
  return result;
}

const fence = (language: string, content: string) => `\`\`\`${language}\n${content}\n\`\`\`\n`;

test("acepta un material v1 mínimo y describe sus datos", () => {
  const result = parse(build());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.kind, "material-v1");
  const parsed = result.parsed!;
  assert.equal(parsed.header.slug, "clase-prueba");
  assert.equal(parsed.header.unitCode, "unidad-1");
  assert.equal(parsed.header.order, 1);
  assert.equal(parsed.header.schemaVersion, 1);
  assert.equal(parsed.header.authoring, "profe-macon-ai-workflow");
  assert.equal(parsed.subjectCode, "programacion-prueba");
  assert.equal(parsed.stats.paragraphs, 1);
  assert.ok(parsed.stats.words > 0);
  assert.equal(parsed.images.length, 0);
});

test("tolera BOM UTF-8 y finales de línea CRLF", () => {
  const source = `\uFEFF${build().replace(/\n/g, "\r\n")}`;
  const result = parse(source);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.parsed!.header.slug, "clase-prueba");
});

test("exige apertura y cierre del frontmatter", () => {
  expectIssue(parse("Sin frontmatter.\n"), "MATERIAL_SCHEMA");
  expectIssue(parse("---\nschemaVersion: 1\nslug: clase-prueba\n"), "MATERIAL_SCHEMA");
  expectIssue(parse(""), "MATERIAL_SCHEMA");
  expectIssue(parseMaterialDocument(7), "MATERIAL_SCHEMA");
});

test("rechaza claves desconocidas, repetidas y un segundo frontmatter", () => {
  expectIssue(parse(build({ edition: "2026" })), "UNKNOWN_KEY");
  expectIssue(parse("---\nschemaVersion: 1\nslug: clase-prueba\nslug: otra-slug\n---\n\nTexto.\n"), "DUPLICATE_KEY");
  expectIssue(parse(`${build()}\n---\nschemaVersion: 1\nslug: otra-slug\n---\n`), "DUPLICATE_FRONTMATTER");
});

test("rechaza la sintaxis YAML compleja", () => {
  expectIssue(parse(build({ tags: "[java, sql]" })), "MATERIAL_SCHEMA");
  expectIssue(parse(build({ summary: '"Con comillas"' })), "MATERIAL_SCHEMA");
  expectIssue(parse(build({ summary: "|bloque" })), "MATERIAL_SCHEMA");
  expectIssue(parse("---\nschemaVersion: 1\n  slug: clase-prueba\n---\n\nTexto.\n"), "MATERIAL_SCHEMA");
  expectIssue(parse("---\nschemaVersion: 1\n- slug\n---\n\nTexto.\n"), "MATERIAL_SCHEMA");
});

test("valida schemaVersion, slug, title, unitCode y order", () => {
  expectIssue(parse(build({ schemaVersion: "2" })), "MATERIAL_SCHEMA");
  expectIssue(parse(build({ schemaVersion: "uno" })), "MATERIAL_SCHEMA");
  expectIssue(parse(build({ slug: "Clase Prueba" })), "INVALID_SLUG");
  expectIssue(parse(build({ slug: "ab" })), "INVALID_SLUG");
  expectIssue(parse(build({ title: "ab" })), "INVALID_TITLE");
  expectIssue(parse(build({ unitCode: "unidad1" })), "INVALID_UNIT_CODE");
  expectIssue(parse(build({ order: "0" })), "INVALID_ORDER");
  expectIssue(parse(build({ order: "100" })), "INVALID_ORDER");
  expectIssue(parse(build({ order: "1,5" })), "INVALID_ORDER");
  expectIssue(parse(build({ title: null })), "MISSING_FIELD");
});

test("cruza la ruta de destino con el frontmatter", () => {
  expectIssue(parse(build({ unitCode: "unidad-2" })), "UNIT_MISMATCH");
  expectIssue(parse(build({ slug: "otro-slug" })), "SLUG_MISMATCH");
  expectIssue(parse(build(), { contentPath: "content/programacion-prueba/clase-prueba.md" }), "CONTENT_PATH_INVALID");
  assert.equal(parse(build(), { contentPath: null }).ok, true);
});

test("normaliza y valida las etiquetas", () => {
  const result = parse(build({ tags: " Java , sql, memoria " }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.parsed!.header.tags, ["java", "sql", "memoria"]);
  expectIssue(parse(build({ tags: "a,b,c,d,e,f,g,h,i" })), "INVALID_TAGS");
  expectIssue(parse(build({ tags: "java,,sql" })), "INVALID_TAGS");
  expectIssue(parse(build({ tags: "dos palabras" })), "INVALID_FORMAT");
});

test("valida los campos opcionales de texto y número", () => {
  assert.equal(parse(build({ summary: "Resumen breve." })).parsed!.header.summary, "Resumen breve.");
  expectIssue(parse(build({ summary: "x".repeat(301) })), "INVALID_LENGTH");
  expectIssue(parse(build({ unitTitle: "y".repeat(141) })), "INVALID_LENGTH");
  assert.equal(parse(build({ estimatedMinutes: "90" })).parsed!.header.estimatedMinutes, 90);
  expectIssue(parse(build({ estimatedMinutes: "3" })), "INVALID_ESTIMATED_MINUTES");
  expectIssue(parse(build({ authoring: "z".repeat(101) })), "INVALID_LENGTH");
  assert.ok(issuesWith(parse(build()), "AUTHORING_DEFAULT", "note").length > 0);
  assert.equal(parse(build({ authoring: "docente-humano" })).parsed!.header.authoring, "docente-humano");
});

test("rechaza el h1 y avisa sobre encabezados problemáticos", () => {
  expectIssue(parse(build({}, "# Título en el cuerpo\n\nTexto.\n")), "MATERIAL_H1_FORBIDDEN");
  const skip = parse(build({}, "Párrafo inicial del material.\n\n## Sección\n\n#### Salto de nivel\n"));
  assert.equal(skip.ok, true, JSON.stringify(skip.errors));
  assert.ok(issuesWith(skip, "HEADING_SKIP", "warning").length > 0);
  assert.ok(issuesWith(parse(build({}, "Párrafo inicial.\n\n##\n\nTexto.\n")), "HEADING_EMPTY", "warning").length > 0);
  const duplicated = parse(build({}, "Párrafo inicial.\n\n## Tipos de datos\n\nTexto.\n\n## Tipos de datos\n"));
  assert.ok(issuesWith(duplicated, "DUPLICATE_HEADING", "warning").length > 0);
  const anchors = parse(build({}, "Párrafo inicial.\n\n## Variables y tipos\n\nTexto.\n"));
  assert.equal(anchors.parsed!.headings[0].anchor, "variables-y-tipos");
});

test("valida los enlaces y rechaza esquemas peligrosos", () => {
  const safe = parse(build({}, "Párrafo con [enlace seguro](https://example.com), [interno](/mis-cursos) y <https://example.org>.\n"));
  assert.equal(safe.ok, true, JSON.stringify(safe.errors));
  assert.equal(safe.parsed!.links.length, 3);
  expectIssue(parse(build({}, "Párrafo con [malo](javascript:alert(1)).\n")), "UNSAFE_LINK");
  expectIssue(parse(build({}, "Párrafo con [dato](data:text/html;base64,AAA).\n")), "UNSAFE_LINK");
  expectIssue(parse(build({}, "Párrafo con [archivo](file:///C:/secreto.txt).\n")), "UNSAFE_LINK");
  expectIssue(parse(build({}, "Párrafo con [protocolo](//example.com/x).\n")), "UNSAFE_LINK");
  expectIssue(parse(build({}, "Texto con javascript: incrustado.\n")), "UNSAFE_LINK");
  expectIssue(parse(build({}, "Párrafo con [referencia][ref].\n\n[ref]: https://example.com\n")), "UNSUPPORTED_SYNTAX");
});

test("rechaza HTML, script, iframe, atributos on* y MDX", () => {
  expectIssue(parse(build({}, "Párrafo con <div>etiqueta</div>.\n")), "UNSAFE_CONTENT");
  expectIssue(parse(build({}, "Párrafo con <script>alert(1)</script>.\n")), "UNSAFE_CONTENT");
  expectIssue(parse(build({}, "Párrafo con <iframe src=\"https://x\"></iframe>.\n")), "UNSAFE_CONTENT");
  expectIssue(parse(build({}, "Párrafo con <img src=\"x\" onerror=\"alert(1)\">.\n")), "UNSAFE_CONTENT");
  expectIssue(parse(build({}, "Párrafo con <!-- comentario -->.\n")), "UNSAFE_CONTENT");
  expectIssue(parse(build({}, "import Componente from \"./x\"\n")), "UNSAFE_CONTENT");
  expectIssue(parse(build({}, "Párrafo con <Componente />.\n")), "UNSAFE_CONTENT");
  const inline = parse(build({}, "Para escribir una etiqueta usá `<h1>` con cuidado.\n"));
  assert.equal(inline.ok, true, JSON.stringify(inline.errors));
  const fenced = parse(build({}, fence("html", "<div class=\"alerta\">Hola</div>")));
  assert.equal(fenced.ok, true, JSON.stringify(fenced.errors));
  const comparison = parse(build({}, "La comparación 3 < 5 y 7 > 2 no es HTML.\n"));
  assert.equal(comparison.ok, true, JSON.stringify(comparison.errors));
});

test("permite listas, tablas, blockquotes y separadores", () => {
  const body = [
    "Párrafo inicial del material.",
    "",
    "> **Idea clave**",
    ">",
    "> El orden importa.",
    "",
    "- primer elemento",
    "- segundo elemento",
    "",
    "| Tipo | Ejemplo |",
    "| --- | --- |",
    "| int | 1 |",
    "",
    "---",
    "",
    "### Práctica breve",
    "",
    "Resolvé el ejercicio propuesto.",
    "",
  ].join("\n");
  const result = parse(build({}, body));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.parsed!.stats.lists, 1);
  assert.equal(result.parsed!.stats.tables, 1);
  assert.equal(result.parsed!.stats.blockquotes, 1);
  assert.ok(issuesWith(result, "TABLE_WITHOUT_HEADER", "warning").length === 0);
  const withoutHeader = parse(build({}, "Párrafo inicial.\n\n| Tipo | Ejemplo |\n| int | 1 |\n"));
  assert.ok(issuesWith(withoutHeader, "TABLE_WITHOUT_HEADER", "warning").length > 0);
  expectIssue(parse(build({}, "Párrafo inicial.\n\nTítulo con subrayado\n===\n")), "UNSUPPORTED_SYNTAX");
});

test("valida las imágenes del material", () => {
  const ok = parse(build({}, `Párrafo inicial con una imagen.\n\n![Diagrama de memoria con cinco enteros contiguos](${IMAGE})\n`));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.parsed!.images.length, 1);
  assert.equal(ok.parsed!.images[0].src, IMAGE);

  const alt = "Texto alternativo suficientemente largo";
  expectIssue(parse(build({}, `Párrafo.\n\n![${alt}](https://example.com/x.webp)\n`)), "IMAGE_INVALID");
  expectIssue(parse(build({}, "Párrafo.\n\n" + `![${alt}](/materiales/../../etc/passwd.webp)\n`)), "IMAGE_INVALID");
  expectIssue(parse(build({}, "Párrafo.\n\n" + `![${alt}](/materiales//x/y/z/x.webp)\n`)), "IMAGE_INVALID");
  expectIssue(parse(build({}, "Párrafo.\n\n" + `![${alt}](/materiales/a\\b\\c\\d.webp)\n`)), "IMAGE_INVALID");
  expectIssue(parse(build({}, "Párrafo.\n\n" + `![${alt}](/materiales/programacion-prueba/unidad-1/clase-prueba/01-diagrama.gif)\n`)), "IMAGE_INVALID");
  expectIssue(parse(build({}, "Párrafo.\n\n" + `![${alt}](/materiales/programacion-prueba/unidad-2/otra-clase/01-diagrama.webp)\n`)), "IMAGE_INVALID");
  expectIssue(parse(build({}, `Párrafo.\n\n![](${IMAGE})\n`)), "IMAGE_ALT_MISSING");
  assert.ok(issuesWith(parse(build({}, `Párrafo.\n\n![esquema](${IMAGE})\n`)), "IMAGE_ALT_WEAK", "warning").length > 0);
  expectIssue(parse(build({}, "Párrafo.\n\n" +
    `![${alt}](/materiales/programacion-prueba/unidad-1/clase-prueba/02-otra.webp)\n`)), "IMAGE_NOT_FOUND");
});

test("informa imágenes pesadas, huérfanas y sin índice de assets", () => {
  const body = `Párrafo.\n\n![Texto alternativo suficientemente largo](${IMAGE})\n`;
  const heavy = parse(build({}, body), { assets: [{ path: IMAGE, bytes: 500 * 1024 }] });
  assert.equal(heavy.ok, true, JSON.stringify(heavy.errors));
  assert.ok(issuesWith(heavy, "IMAGE_HEAVY", "warning").length > 0);

  const orphan = "/materiales/programacion-prueba/unidad-1/clase-prueba/99-sin-uso.webp";
  const withOrphan = parse(build({}, body), { assets: [...assets, { path: orphan, bytes: 100 }] });
  assert.deepEqual(withOrphan.parsed!.orphanImages, [orphan]);
  assert.ok(issuesWith(withOrphan, "IMAGE_ORPHAN", "warning").length > 0);

  const noIndex = parse(build({}, body), { assets: null });
  assert.equal(noIndex.ok, true, JSON.stringify(noIndex.errors));
  assert.ok(issuesWith(noIndex, "ASSETS_INDEX_UNAVAILABLE", "note").length > 0);
});

test("exige lenguaje en los bloques de código", () => {
  assert.equal(parse(build({}, `Párrafo.\n\n${fence("java", "int x = 1;")}`)).ok, true);
  expectIssue(parse(build({}, "Párrafo.\n\n```\nint x = 1;\n```\n")), "CODE_LANGUAGE_MISSING");
  expectIssue(parse(build({}, fence("ruby", "puts 1"))), "CODE_LANGUAGE_UNSUPPORTED");
  expectIssue(parse(build({}, "Párrafo.\n\n```java\nint x = 1;\n")), "UNCLOSED_CODE_FENCE");
  const long = fence("text", Array.from({ length: 90 }, (_, index) => `línea ${index}`).join("\n"));
  assert.ok(issuesWith(parse(build({}, long)), "CODE_BLOCK_LONG", "warning").length > 0);
});

test("valida los diagramas Mermaid de forma estática", () => {
  assert.equal(parse(build({}, fence("mermaid", "flowchart LR\n  A[inicio] --> B[fin]"))).ok, true);
  expectIssue(parse(build({}, fence("mermaid", "noEsUnDiagrama\n  A --> B"))), "MERMAID_INVALID");
  expectIssue(parse(build({}, fence("mermaid", "   "))), "MERMAID_INVALID");
  const big = fence("mermaid", ["flowchart LR", ...Array.from({ length: 205 }, (_, index) => `  A${index} --> A${index + 1}`)].join("\n"));
  expectIssue(parse(build({}, big)), "MERMAID_INVALID");
});

test("valida el bloque declarativo de YouTube", () => {
  const ok = parse(build({}, fence("youtube", "id: iZTONYPJPs8\ntitle: Recorrido de un arreglo\ndescription: Explicación breve.")));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.parsed!.videos.length, 1);
  assert.equal(ok.parsed!.videos[0].id, "iZTONYPJPs8");

  const withoutDescription = parse(build({}, fence("youtube", "id: iZTONYPJPs8\ntitle: Recorrido de un arreglo")));
  assert.equal(withoutDescription.ok, true);
  assert.ok(issuesWith(withoutDescription, "VIDEO_WITHOUT_DESCRIPTION", "warning").length > 0);

  expectIssue(parse(build({}, fence("youtube", "id: corto\ntitle: Recorrido de un arreglo"))), "YOUTUBE_INVALID");
  expectIssue(parse(build({}, fence("youtube", "id: 76xkPICOb8c?si=x\ntitle: Recorrido"))), "YOUTUBE_INVALID");
  expectIssue(parse(build({}, fence("youtube", "id: iZTONYPJPs8"))), "YOUTUBE_INVALID");
  expectIssue(parse(build({}, fence("youtube", "id: iZTONYPJPs8\ntitle: Recorrido\nurl: https://youtu.be/iZTONYPJPs8"))), "YOUTUBE_INVALID");
  expectIssue(parse(build({}, fence("youtube", "id: iZTONYPJPs8\nid: iZTONYPJPs8\ntitle: Recorrido"))), "YOUTUBE_INVALID");

  const helper = parseYoutubeBlock("id: iZTONYPJPs8\ntitle: Recorrido de un arreglo");
  assert.equal(helper.ok, true);
  assert.equal(helper.block!.id, "iZTONYPJPs8");
  assert.equal(helper.block!.description, null);
  assert.equal(parseYoutubeBlock("id: corto\ntitle: x").ok, false);
});

test("aplica los límites de tamaño y de longitud", () => {
  expectIssue(parse(build(), { bytes: MAX_MATERIAL_BYTES + 1 }), "MATERIAL_TOO_LARGE");
  const long = build({}, Array.from({ length: 251 }, () => "palabra palabra palabra").join("\n\n"));
  const result = parse(long);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(issuesWith(result, "MATERIAL_TOO_LONG", "warning").length > 0);
});

test("avisa cuando el material acumula demasiados recursos", () => {
  const paths = Array.from({ length: 13 }, (_, index) =>
    `/materiales/programacion-prueba/unidad-1/clase-prueba/${index + 1}-grafico.webp`);
  const index = paths.map((path) => ({ path, bytes: 1024 }));
  const body = ["Párrafo inicial del material.", ...paths.map((path) => `\n![Gráfico explicativo del punto ${path.length}](${path})`)].join("\n");
  const result = parse(build({}, body), { assets: index });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.parsed!.images.length, 13);
  assert.ok(issuesWith(result, "MANY_RESOURCES", "warning").length > 0);
});

test("avisa cuando el material no tiene introducción", () => {
  const withoutIntro = parse(build({}, "## Primera sección\n\nTexto del cuerpo.\n"));
  assert.ok(issuesWith(withoutIntro, "MATERIAL_NO_INTRO", "warning").length > 0);
  assert.equal(issuesWith(parse(build()), "MATERIAL_NO_INTRO", "warning").length, 0);
});

test("reconoce materiales v1, legacy y sin frontmatter", () => {
  assert.equal(detectMaterialDocumentKind(build()), "material-v1");
  assert.equal(isMaterialV1Document(build()), true);
  const legacy = "---\ntitulo: Unidad 1\nduracion: 90\n---\n\n# Unidad 1\n\nTexto.\n";
  assert.equal(detectMaterialDocumentKind(legacy), "legacy-material");
  assert.equal(isMaterialV1Document(legacy), false);
  assert.equal(detectMaterialDocumentKind("# Solo texto\n"), "unknown");
  assert.equal(isMaterialV1Document(""), false);
});

test("deriva anclas equivalentes al textId del frontend", () => {
  assert.equal(anchorIdOf("Variables y tipos de datos"), "variables-y-tipos-de-datos");
  assert.equal(anchorIdOf("¿Qué es un algoritmo?"), "que-es-un-algoritmo");
  assert.equal(anchorIdOf("  CPU, memoria y almacenamiento  "), "cpu-memoria-y-almacenamiento");
  assert.equal(anchorIdOf("!"), "");
});

test("calcula SHA-256 de forma determinista y retira el BOM antes de hashear", async () => {
  const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(await sha256Hex("abc"), expected);
  assert.equal(stripBom("\uFEFFabc"), "abc");
  assert.equal(await sha256Hex(stripBom("\uFEFFabc")), await sha256Hex("abc"));
  assert.equal(await sha256Hex("abc"), await sha256Hex("abc"));
});

test("verifica la consistencia de unitTitle dentro de una unidad", () => {
  const entries = [
    { slug: "clase-01", unitCode: "unidad-1", unitTitle: "Variables" },
    { slug: "clase-02", unitCode: "unidad-1", unitTitle: "Variables" },
    { slug: "clase-03", unitCode: "unidad-1", unitTitle: null },
    { slug: "clase-01", unitCode: "unidad-2", unitTitle: "Arreglos" },
  ];
  assert.deepEqual(checkUnitConsistency(entries), []);
  const mismatch = checkUnitConsistency([
    ...entries,
    { slug: "clase-04", unitCode: "unidad-1", unitTitle: "Otro título" },
  ]);
  assert.equal(mismatch.length, 1);
  assert.equal(mismatch[0].code, "UNIT_TITLE_MISMATCH");
  assert.equal(mismatch[0].severity, "error");
});
