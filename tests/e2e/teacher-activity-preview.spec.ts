import { expect, test, type Page } from "@playwright/test";

const teacher = { id: 2, username: "docente.ficticio", displayName: "Docente ficticio", email: null, roles: ["docente"] };
const questions = [
  { number: 1, type: "radio", prompt: "Radio ficticia", instructions: "Elegí", options: [{ valor: "a", texto: "A" }, { valor: "b", texto: "B" }], resources: [], placeholder: null, points: 1 },
  { number: 2, type: "checkbox", prompt: "Checkbox ficticia", instructions: "Elegí", options: [{ valor: "a", texto: "A" }, { valor: "c", texto: "C" }], resources: [], placeholder: null, points: 1 },
  { number: 3, type: "text", prompt: "Texto ficticio", instructions: "Escribí", options: [], resources: [], placeholder: "Respuesta", points: 1 },
];
// Entrada contextual vigente: /docente → grupo → actividades → "Probar actividad".
const previewRoute = "/docente/grupos/7/actividades/variables-java-01/prueba";

async function mockPreview(page: Page) {
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route("**/api/teacher/activities/**", (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith("/grade")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ score: 3, total: 3, percentage: 100, judgment: "logrado", questions: questions.map((question, index) => ({ ...question, studentAnswer: index === 0 ? "b" : index === 1 ? ["a", "c"] : "valor", correct: true, pointsAwarded: 1, maxPoints: 1, correctAnswer: { value: "solución ficticia" }, feedback: "Feedback ficticio", explanation: "Explicación ficticia" })) }) });
    if (!url.searchParams.get("groupCode")) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "TEACHER_GROUP_REQUIRED", error: "Elegí un grupo", groups: [{ code: "grupo-a", name: "Grupo A" }] }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ activity: { slug: "variables-java-01", title: "Actividad de prueba", description: "Versión borrador ficticia", totalPoints: 3 }, groupCode: "grupo-a", questions }) });
  });
}

test("el docente prueba, corrige y repite sin perder la distinción visual", async ({ page }) => {
  await mockPreview(page);
  await page.goto(previewRoute);
  await expect(page.getByRole("heading", { name: "Elegí un grupo asignado" })).toBeVisible();
  await page.getByRole("button", { name: "Grupo A" }).click();
  await expect(page.getByText("Modo prueba docente").first()).toBeVisible();
  await expect(page.getByText("Esta ejecución no genera resultados académicos.")).toBeVisible();
  await page.getByLabel("B").check();
  await page.locator('[data-question-number="2"]').getByLabel("A").check();
  await page.locator('[data-question-number="2"]').getByLabel("C").check();
  await page.getByLabel("Respuesta para la pregunta 3").fill("valor");
  await page.getByRole("button", { name: "Corregir simulación" }).click();
  await expect(page.getByRole("heading", { name: "Resultado de simulación" })).toBeVisible();
  await expect(page.getByText("Respuesta correcta:").first()).toBeVisible();
  await page.getByRole("button", { name: "Probar nuevamente" }).click();
  await expect(page.getByRole("button", { name: "Corregir simulación" })).toBeDisabled();
});

test("el preview docente es responsive y no muestra claves internas", async ({ page }) => {
  await mockPreview(page);
  await page.goto(previewRoute);
  await page.getByRole("button", { name: "Grupo A" }).click();
  await expect(page.getByText("Versión borrador ficticia")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(page.getByText("clave_correccion_json")).toHaveCount(0);
});


test("el preview docente muestra los mismos recursos image y code", async ({ page }) => {
  const longLine = "String mensaje = \"línea deliberadamente larga para comprobar el desplazamiento horizontal del bloque de código\";";
  const previewQuestions = [
    {
      number: 1, type: "radio", prompt: "Radio con recursos ficticios", instructions: "Mirá los recursos",
      options: [{ valor: "a", texto: "A" }, { valor: "b", texto: "B" }],
      resources: [
        { type: "image", src: "/actividades/ficticias/q1.webp", alt: "Imagen ficticia del preview", caption: "Epígrafe ficticio" },
        { type: "code", language: "java", content: `int edad = 15;\n${longLine}${longLine}`, title: "Ejemplo ficticio" },
      ],
      placeholder: null, points: 1,
    },
    {
      number: 2, type: "checkbox", prompt: "Checkbox con recursos no representables", instructions: "Elegí",
      options: [{ valor: "a", texto: "A" }, { valor: "c", texto: "C" }],
      resources: [
        { type: "video", src: "/medios/ficticio.mp4" },
        { type: "image", src: "https://sitio-externo.test/x.webp", alt: "Imagen externa ficticia" },
      ],
      placeholder: null, points: 1,
    },
    { number: 3, type: "text", prompt: "Texto sin recursos", instructions: "Escribí", options: [], resources: [], placeholder: "Respuesta", points: 1 },
  ];
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route("**/api/teacher/activities/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.get("groupCode")) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "TEACHER_GROUP_REQUIRED", error: "Elegí un grupo", groups: [{ code: "grupo-a", name: "Grupo A" }] }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ activity: { slug: "variables-java-01", title: "Actividad de prueba", description: "Versión borrador ficticia", totalPoints: 3 }, groupCode: "grupo-a", questions: previewQuestions }) });
  });
  await page.goto(previewRoute);
  await page.getByRole("button", { name: "Grupo A" }).click();

  const first = page.locator('[data-question-number="1"]');
  await expect(first.getByRole("img")).toHaveAttribute("src", "/actividades/ficticias/q1.webp");
  await expect(first.getByRole("img")).toHaveAttribute("alt", "Imagen ficticia del preview");
  await expect(first.getByText("Epígrafe ficticio")).toBeVisible();
  await expect(first.locator("pre code")).toContainText("int edad = 15;");
  expect(await first.locator("pre code").evaluate((node) => node.textContent)).toBe(`int edad = 15;\n${longLine}${longLine}`);
  expect(await first.locator("[data-resource-type]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-resource-type")))).toEqual(["image", "code"]);

  await expect(page.locator('[data-question-number="2"]').getByRole("img")).toHaveCount(0);
  await expect(page.locator('[data-question-number="2"] .question-resources')).toHaveCount(0);
  await expect(page.locator('[data-question-number="3"] .question-resources')).toHaveCount(0);
  await expect(page.getByText("clave_correccion_json")).toHaveCount(0);
  expect(await page.locator('[data-question-number="1"] pre').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});