// Consumo automático de materiales teóricos (Hito 6D-B): recorrido real en el navegador.
//
// Los materiales son contenido estático: estas páginas no llaman a ninguna API,
// así que las pruebas navegan directamente. Corren en escritorio y móvil según
// `playwright.config.ts`. No hay snapshots visuales nuevos.
import { expect, test } from "@playwright/test";

const SUBJECT_PATH = "/curso/programacion-i";
const UNIT_PATH = "/curso/programacion-i/unidad-2";
const MATERIAL_PATH = "/curso/programacion-i/unidad-2/arreglos-introduccion";
const MATERIAL_TITLE = "Arreglos: un nombre para muchos datos";

async function hasHorizontalOverflow(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/**
 * El bundle de Mermaid entra por import dinámico (~600 kB en desarrollo), así que
 * sobre un servidor recién arrancado y con varios workers en paralelo la primera
 * carga puede tardar. Esta espera informa qué ocurrió: `svg` (dibujado),
 * `fallback` (el render falló y el componente degradó al texto) o `timeout`.
 */
async function mermaidOutcome(page: import("@playwright/test").Page, timeout = 45_000): Promise<"svg" | "fallback" | "timeout"> {
  const handle = await page.waitForFunction(() => {
    if (document.querySelector(".mermaid-diagram svg") !== null) return "svg";
    if (document.querySelector(".diagram-fallback") !== null) return "fallback";
    return null;
  }, undefined, { timeout }).catch(() => null);
  if (handle === null) return "timeout";
  return await handle.jsonValue() as "svg" | "fallback";
}

test("el índice del curso descubre la Unidad 2 sin registro manual", async ({ page }) => {
  await page.goto(SUBJECT_PATH);

  await expect(page.getByRole("heading", { name: "Materiales del curso", level: 1 })).toBeVisible();
  await expect(page.getByText("Unidad 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arreglos" })).toBeVisible();
  await expect(page.getByText("1 material publicado")).toBeVisible();
});

test("la unidad lista el material con su metadata", async ({ page }) => {
  await page.goto(UNIT_PATH);

  await expect(page.getByRole("heading", { name: "Arreglos", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: MATERIAL_TITLE })).toBeVisible();
  await expect(page.getByText("Una primera aproximación a los arreglos en Java, sus índices y su recorrido.")).toBeVisible();
  await expect(page.getByText("45 min")).toBeVisible();
  for (const tag of ["java", "arreglos", "índices"]) {
    await expect(page.getByText(tag, { exact: true })).toBeVisible();
  }
});

test("abrir el material navega a la URL del material", async ({ page }) => {
  await page.goto(UNIT_PATH);

  await page.getByRole("button", { name: "Abrir material" }).click();

  await expect(page).toHaveURL(new RegExp(`${MATERIAL_PATH}$`));
  await expect(page.getByRole("heading", { name: MATERIAL_TITLE, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "← Volver a la unidad" })).toBeVisible();
});

test("renderiza el Markdown del material con encabezados, lista y cita", async ({ page }) => {
  // Un `figure`/`p`/`div` anidado dentro del párrafo que React Markdown crea para
  // una imagen suelta produce HTML inválido y errores de React: se vigila.
  const reactErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") reactErrors.push(message.text()); });
  page.on("pageerror", (error) => reactErrors.push(error.message));

  await page.goto(MATERIAL_PATH);

  const content = page.locator(".markdown-content");
  await expect(content.locator("h2")).toHaveCount(3);
  await expect(content.locator("h3")).toHaveCount(1);
  // Los ids de ancla pueden empezar con dígito (el encabezado empieza con "1."),
  // válido en HTML pero no como identificador CSS: se consultan por atributo.
  await expect(page.locator('h2[id="1-un-nombre-varias-posiciones"]')).toBeVisible();
  await expect(page.locator('h3[id="1-1-los-indices"]')).toBeVisible();
  await expect(content.locator("li")).toHaveCount(4);
  await expect(content.locator("blockquote")).toContainText("Idea central: la cantidad de elementos y el último índice no tienen el mismo número.");
  await expect(content.locator("script, iframe")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: MATERIAL_TITLE, level: 1 })).toBeVisible();
  await expect(page.getByText("45 min")).toBeVisible();
  await expect(content.locator("figure, p p, p div")).toHaveCount(0);
  expect(reactErrors.filter((text) => /cannot be a descendant|cannot contain a nested|hydration/i.test(text))).toEqual([]);
});

test("el bloque de Java se muestra como texto, sin resaltado ni ejecución", async ({ page }) => {
  await page.goto(MATERIAL_PATH);

  const blocks = page.locator(".markdown-content pre code.language-java");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first()).toContainText("int[] notas = {7, 8, 9};");
  await expect(blocks.nth(1)).toContainText("for (int i = 0; i < notas.length; i++) {");
  await expect(blocks.nth(1)).toContainText("System.out.println(notas[i]);");
  await expect(page.locator(".markdown-content pre code span.token")).toHaveCount(0);
});

test("el diagrama Mermaid se dibuja como SVG", async ({ page }) => {
  test.slow();
  await page.goto(MATERIAL_PATH);

  await expect(page.locator(".mermaid-diagram")).toBeVisible();
  const outcome = await mermaidOutcome(page);
  expect(outcome, "El diagrama no se dibujó como SVG").toBe("svg");
  await expect(page.locator(".diagram-fallback")).toHaveCount(0);
});

test("la imagen same-origin del material carga", async ({ page }) => {
  await page.goto(MATERIAL_PATH);

  const image = page.locator(".material-figure img");
  await expect(image).toHaveAttribute("src", "/materiales/programacion-i/unidad-2/arreglos-introduccion/01-indices.svg");
  await expect(image).toHaveAttribute("alt", /Esquema de un arreglo con tres valores/);
  await expect.poll(
    async () => image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
  await expect(page.locator(".material-image-note")).toHaveCount(0);
});

test("el índice interno lleva a los encabezados del material", async ({ page }) => {
  await page.goto(MATERIAL_PATH);

  const contents = page.getByRole("navigation", { name: "Contenido del material" });
  await expect(contents).toBeVisible();
  await contents.getByRole("link", { name: "3. El recorrido paso a paso" }).click();

  await expect(page).toHaveURL(new RegExp(`${MATERIAL_PATH}#3-el-recorrido-paso-a-paso$`));
  await expect(page.locator('h2[id="3-el-recorrido-paso-a-paso"]')).toBeVisible();
});

test("un enlace profundo directo no vuelve a la portada", async ({ page }) => {
  await page.goto(MATERIAL_PATH);

  await expect(page.getByRole("heading", { name: MATERIAL_TITLE, level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: MATERIAL_TITLE, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profe Macón 2.0" })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${MATERIAL_PATH}$`));
});

test("un material desconocido se informa sin repetir la entrada recibida", async ({ page }) => {
  await page.goto("/curso/programacion-i/unidad-2/no-existe");

  await expect(page.getByRole("heading", { name: "Material no encontrado", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a mis cursos" })).toBeVisible();
  await expect(page.getByText("no-existe")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Profe Macón 2.0" })).toHaveCount(0);
});

test("una unidad y un curso desconocidos se informan de forma explícita", async ({ page }) => {
  await page.goto("/curso/programacion-i/unidad-9");
  await expect(page.getByRole("heading", { name: "Material no encontrado", level: 1 })).toBeVisible();

  await page.goto("/curso/asignatura-inexistente");
  await expect(page.getByRole("heading", { name: "Todavía no hay materiales publicados para este curso.", level: 1 })).toBeVisible();
});

test("Unidad 0 legacy se ve igual que antes", async ({ page }) => {
  await page.goto("/curso/programacion-i/unidad-0");

  await expect(page.getByRole("heading", { name: "Introducción a la programación", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver actividad 0" })).toBeVisible();
  await expect(page.locator(".markdown-content")).toBeVisible();
});

test("Unidad 1 legacy se ve igual que antes", async ({ page }) => {
  await page.goto("/curso/programacion-i/unidad-1");

  await expect(page.getByRole("heading", { name: "Variables, tipos de datos y operadores", level: 1 })).toBeVisible();
  await expect(page.locator(".video-lesson")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Abrir actividad" })).toBeVisible();
});

test("las páginas de materiales no tienen desbordamiento horizontal", async ({ page }) => {
  await page.goto(SUBJECT_PATH);
  await expect(page.getByRole("heading", { name: "Materiales del curso", level: 1 })).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);

  await page.goto(UNIT_PATH);
  await expect(page.getByRole("heading", { name: "Arreglos", level: 1 })).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);

  // El contenedor del diagrama existe desde el primer render del Markdown; su
  // dibujado lo cubre el caso anterior, para no acoplar esta medición a Mermaid.
  await page.goto(MATERIAL_PATH);
  await expect(page.locator(".mermaid-diagram")).toBeVisible();
  await expect(page.locator(".markdown-content h2").first()).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

