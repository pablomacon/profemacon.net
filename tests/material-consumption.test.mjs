// Consumo automático de materiales teóricos (Hito 6D-B): pruebas puras.
//
// No tocan Vite ni el navegador: el registry recibe un mapa de loaders en memoria
// y el ruteo sólo analiza cadenas. El último caso usa el material piloto REAL
// instalado en `content/`, que es la garantía de que el pipeline 6D-A y el
// consumo del frontend siguen hablando el mismo contrato.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createMaterialRegistry } from "../src/courses/material-consumption/material-registry-core.ts";
import {
  COURSE_FALLBACK_PATH,
  coursePath,
  materialPath,
  parseCourseRoute,
  unitPath,
} from "../src/courses/material-consumption/material-routing.ts";
import { toLessonVideo } from "../src/courses/material-consumption/material-youtube.ts";

const PATH_ONE = "/content/programacion-i/unidad-1/clase-uno.md";
const PATH_TWO = "/content/programacion-i/unidad-1/clase-dos.md";
const PATH_UNIT_TWO = "/content/programacion-i/unidad-2/arreglos-introduccion.md";
const PATH_LEGACY = "/content/programacion-i/unidad-0/material.md";
const PATH_YOUTUBE = "/content/programacion-i/unidad-3/clase-video.md";

const BODY = "Párrafo introductorio de prueba con suficiente contenido.\n";

function document_(overrides = {}, body = BODY) {
  const fields = {
    schemaVersion: "1",
    slug: "clase-uno",
    title: "Clase uno",
    unitCode: "unidad-1",
    order: "1",
    ...overrides,
  };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

const legacyDocument = [
  "---",
  "titulo: Material legacy",
  "unidad: 0",
  "---",
  "",
  "# Unidad 0",
  "",
  "Contenido legacy sin contrato v1.",
  "",
].join("\n");

/** Construye el mapa `ruta → loader` contando cada invocación. */
function buildSources(entries) {
  const calls = new Map();
  const sources = {};
  for (const [path, value] of Object.entries(entries)) {
    sources[path] = async () => {
      calls.set(path, (calls.get(path) ?? 0) + 1);
      if (value instanceof Error) throw value;
      return value;
    };
  }
  const countOf = (path) => calls.get(path) ?? 0;
  const total = () => [...calls.values()].reduce((sum, value) => sum + value, 0);
  return { sources, countOf, total };
}


test("descubre las rutas del contrato y expone asignatura, unidad y slug", () => {
  const { sources } = buildSources({ [PATH_ONE]: document_() });
  const registry = createMaterialRegistry(sources);

  assert.deepEqual(registry.listSubjects(), ["programacion-i"]);
  assert.equal(registry.hasSubject("programacion-i"), true);
  assert.deepEqual(registry.listUnitCodes("programacion-i"), ["unidad-1"]);
  const refs = registry.listRefs("programacion-i", "unidad-1");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].slug, "clase-uno");
  assert.equal(refs[0].contentPath, "content/programacion-i/unidad-1/clase-uno.md");
  assert.equal(registry.hasMaterial("programacion-i", "unidad-1", "clase-uno"), true);
});

test("ignora claves fuera de la convención sin romper el catálogo", () => {
  const { sources, total } = buildSources({
    [PATH_ONE]: document_(),
    "/content/programacion-i/unidad-1/clase-dos.md": document_({ slug: "clase-dos" }),
    "/content/programacion-i/unidad-1/anidado/clase-tres.md": document_({ slug: "clase-tres" }),
    "/content/programacion-i/unidad-1/clase-cuatro.txt": document_({ slug: "clase-cuatro" }),
    "/content/programacion-i/u1/clase-cinco.md": document_({ slug: "clase-cinco" }),
    "/otra-carpeta/programacion-i/unidad-1/clase-seis.md": document_({ slug: "clase-seis" }),
  });
  const registry = createMaterialRegistry(sources);

  assert.deepEqual(registry.listUnitCodes("programacion-i"), ["unidad-1"]);
  assert.deepEqual(registry.listRefs("programacion-i", "unidad-1").map((ref) => ref.slug), ["clase-dos", "clase-uno"]);
  assert.deepEqual(registry.listRefs("programacion-i", "u1"), []);
  assert.equal(registry.hasSubject("otra-carpeta"), false);
  assert.equal(total(), 0);
});

test("el descubrimiento no ejecuta ningún loader", () => {
  const { sources, total } = buildSources({ [PATH_ONE]: document_() });
  const registry = createMaterialRegistry(sources);

  registry.listSubjects();
  registry.hasSubject("programacion-i");
  registry.listUnitCodes("programacion-i");
  registry.listRefs("programacion-i", "unidad-1");
  registry.hasMaterial("programacion-i", "unidad-1", "clase-uno");

  assert.equal(total(), 0);
});

test("loadUnit carga sólo los materiales de la unidad pedida", async () => {
  const { sources, countOf } = buildSources({
    [PATH_ONE]: document_(),
    [PATH_TWO]: document_({ slug: "clase-dos", title: "Clase dos", order: "2" }),
    [PATH_UNIT_TWO]: document_({ slug: "arreglos-introduccion", title: "Arreglos", unitCode: "unidad-2" }),
  });
  const registry = createMaterialRegistry(sources);

  const unit = await registry.loadUnit("programacion-i", "unidad-1");
  assert.equal(unit?.materials.length, 2);
  assert.equal(countOf(PATH_ONE), 1);
  assert.equal(countOf(PATH_TWO), 1);
  assert.equal(countOf(PATH_UNIT_TWO), 0);
});

test("memoiza la unidad y el material: una segunda consulta no vuelve a leer", async () => {
  const { sources, countOf } = buildSources({ [PATH_ONE]: document_() });
  const registry = createMaterialRegistry(sources);
  const refs = registry.listRefs("programacion-i", "unidad-1");

  await registry.loadUnit("programacion-i", "unidad-1");
  await registry.loadUnit("programacion-i", "unidad-1");
  await registry.loadMaterial(refs[0]);
  await registry.loadMaterial(refs[0]);

  assert.equal(countOf(PATH_ONE), 1);
});

test("loadMaterial reutiliza el parseo ya memoizado por loadUnit", async () => {
  const { sources, countOf } = buildSources({ [PATH_ONE]: document_() });
  const registry = createMaterialRegistry(sources);

  await registry.loadUnit("programacion-i", "unidad-1");
  const loaded = await registry.loadMaterialBySlug("programacion-i", "unidad-1", "clase-uno");
  assert.equal(loaded?.status, "ok");
  assert.equal(loaded?.ref.contentPath, "content/programacion-i/unidad-1/clase-uno.md");
  assert.equal(countOf(PATH_ONE), 1);
});

test("ordena por order y desempata por slug", async () => {
  const { sources } = buildSources({
    "/content/programacion-i/unidad-1/zeta.md": document_({ slug: "zeta", title: "Zeta", order: "2" }),
    "/content/programacion-i/unidad-1/alfa.md": document_({ slug: "alfa", title: "Alfa", order: "2" }),
    "/content/programacion-i/unidad-1/beta.md": document_({ slug: "beta", title: "Beta", order: "1" }),
  });
  const registry = createMaterialRegistry(sources);

  const unit = await registry.loadUnit("programacion-i", "unidad-1");
  assert.deepEqual(unit?.materials.map((material) => material.ref.slug), ["beta", "alfa", "zeta"]);
});

test("expone la metadata del frontmatter y null cuando no existe", async () => {
  const { sources } = buildSources({
    [PATH_ONE]: document_({
      summary: "Resumen breve.",
      unitTitle: "Unidad de prueba",
      estimatedMinutes: "45",
      tags: "java, arreglos, índices",
    }),
  });
  const unit = await createMaterialRegistry(sources).loadUnit("programacion-i", "unidad-1");
  const material = unit?.materials[0];

  assert.equal(unit?.unitTitle, "Unidad de prueba");
  assert.equal(material?.title, "Clase uno");
  assert.equal(material?.summary, "Resumen breve.");
  assert.equal(material?.estimatedMinutes, 45);
  assert.deepEqual(material?.tags, ["java", "arreglos", "índices"]);
  assert.equal(material?.videoCount, 0);
  assert.deepEqual(material?.headings, []);

  const { sources: minimal } = buildSources({ [PATH_ONE]: document_() });
  const bare = await createMaterialRegistry(minimal).loadUnit("programacion-i", "unidad-1");
  assert.equal(bare?.unitTitle, null);
  assert.equal(bare?.materials[0].summary, null);
  assert.equal(bare?.materials[0].estimatedMinutes, null);
  assert.deepEqual(bare?.materials[0].tags, []);
});

test("expone las anclas del parser para el índice del material", async () => {
  const body = [
    "Párrafo inicial con contenido suficiente.",
    "",
    "## 1. Un nombre, varias posiciones",
    "",
    "### 1.1. Los índices",
    "",
  ].join("\n");
  const { sources } = buildSources({ [PATH_ONE]: document_({}, body) });
  const unit = await createMaterialRegistry(sources).loadUnit("programacion-i", "unidad-1");

  assert.deepEqual(unit?.materials[0].headings.map((heading) => [heading.level, heading.anchor]), [
    [2, "1-un-nombre-varias-posiciones"],
    [3, "1-1-los-indices"],
  ]);
});


test("excluye el material legacy del catálogo v1 sin romper la unidad", async () => {
  const { sources } = buildSources({
    [PATH_LEGACY]: legacyDocument,
    "/content/programacion-i/unidad-0/clase-v1.md": document_({ slug: "clase-v1", unitCode: "unidad-0" }),
  });
  const registry = createMaterialRegistry(sources);

  const unit = await registry.loadUnit("programacion-i", "unidad-0");
  assert.deepEqual(unit?.materials.map((material) => material.ref.slug), ["clase-v1"]);
  assert.equal(unit?.materials.length, 1);

  const legacy = await registry.loadMaterialBySlug("programacion-i", "unidad-0", "material");
  assert.equal(legacy?.status, "legacy");
  assert.equal(legacy?.parsed, null);
});

test("excluye los documentos inválidos y no los renderiza nunca", async () => {
  const invalid = document_({ slug: "clase-uno", unitCode: "unidad-9" });
  const withoutFrontmatter = "Sólo texto sin frontmatter.\n";
  const { sources } = buildSources({
    [PATH_ONE]: invalid,
    "/content/programacion-i/unidad-1/clase-seis.md": withoutFrontmatter,
    "/content/programacion-i/unidad-1/clase-siete.md": document_({ slug: "clase-siete", order: "0" }),
  });
  const registry = createMaterialRegistry(sources);

  assert.equal(await registry.loadUnit("programacion-i", "unidad-1"), null);
  const one = await registry.loadMaterialBySlug("programacion-i", "unidad-1", "clase-uno");
  assert.equal(one?.status, "invalid");
  const bare = await registry.loadMaterialBySlug("programacion-i", "unidad-1", "clase-seis");
  assert.equal(bare?.status, "invalid");
});

test("un loader que falla queda aislado y no arrastra al resto", async () => {
  const { sources } = buildSources({
    [PATH_ONE]: new Error("fallo ficticio de lectura"),
    [PATH_TWO]: document_({ slug: "clase-dos", title: "Clase dos" }),
  });
  const registry = createMaterialRegistry(sources);

  const unit = await registry.loadUnit("programacion-i", "unidad-1");
  assert.deepEqual(unit?.materials.map((material) => material.ref.slug), ["clase-dos"]);
  const failed = await registry.loadMaterialBySlug("programacion-i", "unidad-1", "clase-uno");
  assert.equal(failed?.status, "load-error");
  assert.equal(failed?.parsed, null);
  assert.ok(failed?.issues.some((entry) => entry.code === "MATERIAL_LOAD_FAILED"));
});

test("un material no descubierto no se puede cargar", async () => {
  const { sources } = buildSources({ [PATH_ONE]: document_() });
  const registry = createMaterialRegistry(sources);

  assert.equal(await registry.loadMaterialBySlug("programacion-i", "unidad-1", "no-existe"), null);
  assert.equal(await registry.loadMaterialBySlug("programacion-i", "unidad-7", "clase-uno"), null);
  const orphan = await registry.loadMaterial({
    subjectCode: "programacion-i",
    unitCode: "unidad-1",
    slug: "clase-uno",
    contentPath: "content/programacion-i/unidad-1/clase-uno.md",
    assetPrefix: "/materiales/programacion-i/unidad-1/clase-uno/",
  });
  assert.equal(orphan.status, "ok");
});

test("el prefijo de assets es el del material", async () => {
  const { sources } = buildSources({ [PATH_ONE]: document_() });
  const ref = createMaterialRegistry(sources).listRefs("programacion-i", "unidad-1")[0];

  assert.equal(ref.assetPrefix, "/materiales/programacion-i/unidad-1/clase-uno/");
});

test("claves peligrosas no devuelven contenido", async () => {
  const { sources } = buildSources({ [PATH_ONE]: document_() });
  const registry = createMaterialRegistry(sources);

  for (const dangerous of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(registry.hasSubject(dangerous), false);
    assert.deepEqual(registry.listUnitCodes(dangerous), []);
    assert.deepEqual(registry.listRefs(dangerous, "unidad-1"), []);
    assert.equal(registry.hasMaterial(dangerous, "unidad-1", "clase-uno"), false);
    assert.equal(await registry.loadMaterialBySlug(dangerous, "unidad-1", "clase-uno"), null);
    assert.equal(await registry.loadUnit(dangerous, dangerous), null);
    assert.deepEqual(await registry.loadSubject(dangerous), []);
  }
  assert.equal(registry.hasMaterial("programacion-i/unidad-1", "x", "clase-uno"), false);
  assert.deepEqual(registry.listRefs("programacion-i", "unidad-1/../.."), []);
});


test("detecta el bloque youtube válido sin construir ningún iframe", async () => {
  const body = [
    "Párrafo inicial con contenido suficiente.",
    "",
    "```youtube",
    "id: iZTONYPJPs8",
    "title: Recorrido de un arreglo",
    "description: Mirá cómo cambia el índice en cada vuelta.",
    "```",
    "",
  ].join("\n");
  const { sources } = buildSources({ [PATH_YOUTUBE]: document_({ slug: "clase-video", unitCode: "unidad-3" }, body) });
  const unit = await createMaterialRegistry(sources).loadUnit("programacion-i", "unidad-3");

  assert.equal(unit?.materials[0].videoCount, 1);
  const parsed = await createMaterialRegistry(sources).loadMaterialBySlug("programacion-i", "unidad-3", "clase-video");
  assert.equal(parsed?.parsed?.videos[0].id, "iZTONYPJPs8");
});

test("mapea el bloque youtube a la forma de VideoEmbed y rechaza lo inválido", () => {
  const valid = toLessonVideo("id: iZTONYPJPs8\ntitle: Recorrido de un arreglo\ndescription: Explicación breve.");
  assert.deepEqual(valid, {
    id: "youtube-iZTONYPJPs8",
    title: "Recorrido de un arreglo",
    description: "Explicación breve.",
    youtubeId: "iZTONYPJPs8",
  });

  const sinDescription = toLessonVideo("id: 76xkPICOb8c\ntitle: Variables en Java");
  assert.equal(sinDescription?.description, "");

  assert.equal(toLessonVideo("id: https://www.youtube.com/watch?v=iZTONYPJPs8\ntitle: Video"), null);
  assert.equal(toLessonVideo("id: corto\ntitle: Video"), null);
  assert.equal(toLessonVideo("title: Video sin identificador"), null);
  assert.equal(toLessonVideo("id: iZTONYPJPs8"), null);
  assert.equal(toLessonVideo(""), null);
});

test("parseCourseRoute acepta las tres formas válidas", () => {
  assert.deepEqual(parseCourseRoute("/curso/programacion-i"), { kind: "course", subjectCode: "programacion-i" });
  assert.deepEqual(parseCourseRoute("/curso/programacion-i/unidad-2"), {
    kind: "unit", subjectCode: "programacion-i", unitCode: "unidad-2",
  });
  assert.deepEqual(parseCourseRoute("/curso/programacion-i/unidad-2/arreglos-introduccion"), {
    kind: "material", subjectCode: "programacion-i", unitCode: "unidad-2", slug: "arreglos-introduccion",
  });
});

test("parseCourseRoute rechaza rutas inválidas y la ruta legacy profunda", () => {
  const invalidas = [
    "/curso",
    "/curso/",
    "/curso/programacion-i/",
    "/curso/programacion-i//unidad-2",
    "/curso/programacion-i/unidad-2/",
    "/curso/programacion-i/unidad-2/arreglos-introduccion/",
    "/curso/programacion-i/unidad-2/arreglos-introduccion/extra",
    "/curso/Programacion-I",
    "/curso/programacion_i",
    "/curso/programacion-i/unidad-2x",
    "/curso/programacion-i/unidad-2/arreglos_introduccion",
    "/curso/programacion-i/unidad-2/arreglos%2F..%2Fsecreto",
    "/curso/programacion-i/unidad-2/..",
    "/curso/programacion-i/unidad-2/arreglos-introduccion:1",
    "/curso/programacion-i/unidad-2/ab",
    "/materiales/programacion-i/unidad-2/arreglos-introduccion",
  ];
  for (const path of invalidas) {
    assert.equal(parseCourseRoute(path), null, `Se esperaba null para ${path}`);
  }

  // Ruta legacy profunda: cuatro segmentos, el router v1 no la toca.
  assert.equal(parseCourseRoute("/curso/programacion-i/unidad-1/actividad/variables-java-01"), null);

  // Tres segmentos con forma de material: el router lo describe, pero la cadena
  // de `main.tsx` resuelve primero las rutas legacy exactas (`/unidad-0/actividad`
  // y `/unidad-1/actividad`), que nunca dependen del registry v1.
  assert.equal(parseCourseRoute("/curso/programacion-i/unidad-0/actividad")?.kind, "material");
  assert.equal(parseCourseRoute("/curso/programacion-i/unidad-1/actividad")?.kind, "material");
});

test("los helpers de ruta sólo construyen rutas validadas", () => {
  assert.equal(coursePath("programacion-i"), "/curso/programacion-i");
  assert.equal(unitPath("programacion-i", "unidad-2"), "/curso/programacion-i/unidad-2");
  assert.equal(materialPath("programacion-i", "unidad-2", "arreglos-introduccion"), "/curso/programacion-i/unidad-2/arreglos-introduccion");

  assert.equal(coursePath("Programación I"), COURSE_FALLBACK_PATH);
  assert.equal(unitPath("programacion-i", "unidad-2/../.."), COURSE_FALLBACK_PATH);
  assert.equal(materialPath("programacion-i", "unidad-2", "a/b"), COURSE_FALLBACK_PATH);
  assert.equal(materialPath("__proto__", "unidad-2", "arreglos-introduccion"), COURSE_FALLBACK_PATH);

  for (const path of [coursePath("programacion-i"), unitPath("programacion-i", "unidad-2"), materialPath("programacion-i", "unidad-2", "arreglos-introduccion")]) {
    assert.notEqual(parseCourseRoute(path), null, `El helper produjo una ruta que el router no reconoce: ${path}`);
  }
});


test("integra el material piloto real instalado en content/", async () => {
  const contentPath = "content/programacion-i/unidad-2/arreglos-introduccion.md";
  const source = readFileSync(join(process.cwd(), contentPath), "utf8");
  const { sources } = buildSources({ "/content/programacion-i/unidad-2/arreglos-introduccion.md": source });
  const registry = createMaterialRegistry(sources);

  assert.deepEqual(registry.listSubjects(), ["programacion-i"]);
  assert.deepEqual(registry.listUnitCodes("programacion-i"), ["unidad-2"]);

  const unit = await registry.loadUnit("programacion-i", "unidad-2");
  assert.equal(unit?.unitTitle, "Arreglos");
  assert.equal(unit?.materials.length, 1);

  const material = unit?.materials[0];
  assert.equal(material?.title, "Arreglos: un nombre para muchos datos");
  assert.equal(material?.summary, "Una primera aproximación a los arreglos en Java, sus índices y su recorrido.");
  assert.equal(material?.estimatedMinutes, 45);
  assert.deepEqual(material?.tags, ["java", "arreglos", "índices"]);
  assert.equal(material?.order, 1);
  assert.equal(material?.videoCount, 0);
  assert.equal(material?.ref.assetPrefix, "/materiales/programacion-i/unidad-2/arreglos-introduccion/");
  assert.deepEqual(material?.headings.map((heading) => heading.anchor), [
    "1-un-nombre-varias-posiciones",
    "1-1-los-indices",
    "2-recorrer-el-arreglo",
    "3-el-recorrido-paso-a-paso",
  ]);

  const loaded = await registry.loadMaterialBySlug("programacion-i", "unidad-2", "arreglos-introduccion");
  assert.equal(loaded?.status, "ok");
  const parsed = loaded?.parsed;
  assert.equal(parsed?.header.unitCode, "unidad-2");
  assert.equal(parsed?.images.length, 1);
  assert.equal(parsed?.images[0].src, "/materiales/programacion-i/unidad-2/arreglos-introduccion/01-indices.svg");
  assert.equal(parsed?.videos.length, 0);
  assert.equal(parsed?.blocks.filter((block) => block.kind === "code" && block.language === "java").length, 2);
  assert.match(parsed?.body ?? "", /^\s*Cuando un programa necesita guardar pocas cosas/);
  // El cuerpo no debe conservar el frontmatter ni el `---` de apertura.
  assert.equal(parsed?.body.includes("schemaVersion"), false);

  const imagePath = join(process.cwd(), "assets", parsed.images[0].src.slice(1));
  assert.ok(readFileSync(imagePath, "utf8").includes("<svg"), `Falta el asset instalado ${imagePath}`);
});

