import { expect, test, type Page } from "@playwright/test";

const teacher = { id: 2, username: "docente.ficticio", displayName: "Docente ficticio", email: null, roles: ["docente"] };
const questions = [
  { number: 1, type: "radio", prompt: "Radio ficticia", instructions: "Elegí", options: [{ valor: "a", texto: "A" }, { valor: "b", texto: "B" }], resources: [], placeholder: null, points: 1 },
  { number: 2, type: "checkbox", prompt: "Checkbox ficticia", instructions: "Elegí", options: [{ valor: "a", texto: "A" }, { valor: "c", texto: "C" }], resources: [], placeholder: null, points: 1 },
  { number: 3, type: "text", prompt: "Texto ficticio", instructions: "Escribí", options: [], resources: [], placeholder: "Respuesta", points: 1 },
];

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
  await page.goto("/docente");
  await page.getByRole("button", { name: "Probar Actividad 1" }).click();
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
  await page.goto("/docente/actividades/variables-java-01/prueba");
  await page.getByRole("button", { name: "Grupo A" }).click();
  await expect(page.getByText("Versión borrador ficticia")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(page.getByText("clave_correccion_json")).toHaveCount(0);
});
