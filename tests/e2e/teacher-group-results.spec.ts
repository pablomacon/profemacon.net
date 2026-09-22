import { expect, test, type Page } from "@playwright/test";

const teacher = { id: 2, username: "docente.ficticio", displayName: "Docente ficticio", email: null, roles: ["docente"] };

const group = {
  id: 7,
  code: "grupo-a",
  name: "Grupo A",
  subjectCode: "prog-1",
  subjectName: "Programación",
  editionId: 3,
  editionName: "Edición ficticia",
  year: 2027,
  activeStudents: 2,
};

const resultsFixture = () => ({
  group,
  activities: [
    { id: 101, slug: "variables-java-01", title: "Variables en Java", unitCode: "unidad-1", editorialState: "activa", availabilityStatus: "available", maxAttempts: 3 },
    { id: 102, slug: "bucles-java", title: "Bucles en Java", unitCode: "unidad-1", editorialState: "activa", availabilityStatus: "disabled", maxAttempts: 2 },
    { id: 103, slug: "arreglos-java", title: "Arreglos", unitCode: "unidad-2", editorialState: "activa", availabilityStatus: "not_open", maxAttempts: 1 },
  ],
  students: [
    { id: 3, displayName: "Alumno Alfa", username: "alumno-alfa" },
    { id: 9, displayName: "Alumno Beta", username: "alumno-beta" },
  ],
  cells: [
    { studentId: 3, activityId: 101, best: { percentage: 42, score: 5, total: 12, judgment: "inicial", ordinal: 3, submittedAt: "2027-05-01T12:00:00Z" }, attemptsUsed: 3, hasDraft: true, lastSubmittedAt: "2027-05-01T12:00:00Z" },
    { studentId: 3, activityId: 102, best: { percentage: 60, score: 6, total: 10, judgment: "en_proceso", ordinal: 1, submittedAt: "2027-05-02T12:00:00Z" }, attemptsUsed: 1, hasDraft: false, lastSubmittedAt: "2027-05-02T12:00:00Z" },
    { studentId: 3, activityId: 103, best: { percentage: 90, score: 9, total: 10, judgment: "logrado", ordinal: 2, submittedAt: "2027-05-03T12:00:00Z" }, attemptsUsed: 2, hasDraft: false, lastSubmittedAt: "2027-05-03T12:00:00Z" },
    { studentId: 9, activityId: 101, best: null, attemptsUsed: 1, hasDraft: true, lastSubmittedAt: null },
    { studentId: 9, activityId: 102, best: null, attemptsUsed: 0, hasDraft: false, lastSubmittedAt: null },
    { studentId: 9, activityId: 103, best: { percentage: 30, score: 3, total: 10, judgment: "inicial", ordinal: 1, submittedAt: "2027-05-04T12:00:00Z" }, attemptsUsed: 2, hasDraft: false, lastSubmittedAt: "2027-05-04T12:00:00Z" },
  ],
});

async function mockResults(page: Page, options: { results?: ReturnType<typeof resultsFixture>; status?: number; error?: string } = {}) {
  const results = options.results ?? resultsFixture();
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route("**/api/teacher/groups/7", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ group }) }));
  await page.route("**/api/teacher/groups/7/results", (route) => {
    if (options.status && options.status !== 200) {
      return route.fulfill({ status: options.status, contentType: "application/json", body: JSON.stringify({ error: options.error ?? "No fue posible consultar los resultados" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(results) });
  });
}

test("navega del grupo a la matriz de resultados y renderiza estudiantes y actividades", async ({ page }) => {
  await mockResults(page);
  await page.goto("/docente/grupos/7");
  await page.getByRole("button", { name: "Resultados" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/resultados$/);
  await expect(page.getByRole("heading", { name: "Resultados" })).toBeVisible();
  await expect(page.getByText("Grupo A · grupo-a")).toBeVisible();

  // Actividades como columnas, incluida la que no tiene habilitación.
  await expect(page.getByText("Variables en Java")).toBeVisible();
  await expect(page.getByText("Bucles en Java")).toBeVisible();
  await expect(page.getByText("No habilitada")).toBeVisible();

  // Estudiantes como filas, incluso sin intentos.
  const alfa = page.locator("tr", { hasText: "Alumno Alfa" });
  const beta = page.locator("tr", { hasText: "Alumno Beta" });
  await expect(alfa).toBeVisible();
  await expect(beta).toBeVisible();
});

test("representa cada estado de celda sin recalcular el juicio", async ({ page }) => {
  await mockResults(page);
  await page.goto("/docente/grupos/7/resultados");

  const alfa = page.locator("tr", { hasText: "Alumno Alfa" });
  const beta = page.locator("tr", { hasText: "Alumno Beta" });

  // inicial + porcentaje + borrador (best + draft coexisten)
  await expect(alfa.getByText("Inicial")).toBeVisible();
  await expect(alfa.getByText("42%")).toBeVisible();
  await expect(alfa.getByText("Borrador")).toBeVisible();
  // en_proceso
  await expect(alfa.getByText("En proceso")).toBeVisible();
  await expect(alfa.getByText("60%")).toBeVisible();
  // logrado
  await expect(alfa.getByText("Logrado")).toBeVisible();
  await expect(alfa.getByText("90%")).toBeVisible();

  // sólo borrador
  await expect(beta.getByText("En progreso")).toBeVisible();
  // sin intento
  await expect(beta.getByText("Sin intento")).toBeVisible();
  // inicial de beta
  await expect(beta.getByText("30%")).toBeVisible();
});

test("expone intentos usados y etiqueta accesible por celda", async ({ page }) => {
  await mockResults(page);
  await page.goto("/docente/grupos/7/resultados");

  await expect(page.getByRole("cell", { name: /Alumno Alfa, Variables en Java: Inicial, 42 por ciento, 3 intentos, con borrador en progreso/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Alumno Alfa, Arreglos: Logrado, 90 por ciento, 2 intentos/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Alumno Beta, Bucles en Java: Sin intento, 0 intentos/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Alumno Beta, Variables en Java: En progreso, 1 intento/ })).toBeVisible();
});

test("muestra error y permite reintentar", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route("**/api/teacher/groups/7", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ group }) }));
  await page.route("**/api/teacher/groups/7/results", (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "No fue posible consultar los resultados" }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(resultsFixture()) });
  });

  await page.goto("/docente/grupos/7/resultados");
  await expect(page.getByRole("alert")).toContainText("No fue posible consultar los resultados");
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Alumno Alfa")).toBeVisible();
});

test("muestra un estado vacío cuando no hay estudiantes", async ({ page }) => {
  const empty = { ...resultsFixture(), students: [], cells: [] };
  await mockResults(page, { results: empty });
  await page.goto("/docente/grupos/7/resultados");
  await expect(page.getByText("Sin datos para mostrar")).toBeVisible();
  await expect(page.getByText("El grupo todavía no tiene estudiantes activos.")).toBeVisible();
});

test("no genera desbordamiento horizontal fuera del contenedor previsto", async ({ page }) => {
  await mockResults(page);
  await page.goto("/docente/grupos/7/resultados");
  await expect(page.getByText("Alumno Alfa")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});