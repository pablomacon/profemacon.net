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
  activeStudents: 5,
};

type ActivityFixture = {
  id: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  maxAttempts: number;
  availabilityStatus: "disabled" | "not_open" | "closed" | "available";
};

const activity: ActivityFixture = { id: 101, slug: "variables-java-01", title: "Variables en Java", unitCode: "unidad-1", editorialState: "activa", maxAttempts: 3, availabilityStatus: "available" };
const secondActivity: ActivityFixture = { ...activity, id: 102, slug: "bucles-java", title: "Bucles en Java", availabilityStatus: "not_open" };

type StudentFixture = {
  studentId: number;
  displayName: string;
  username: string;
  best: { percentage: number; score: number; total: number; judgment: string; ordinal: number | null; submittedAt: string } | null;
  attemptsUsed: number;
  hasDraft: boolean;
  lastSubmittedAt: string | null;
};

type SummaryFixture = {
  totalStudents: number;
  withoutAttempt: number;
  inProgress: number;
  inicial: number;
  en_proceso: number;
  logrado: number;
  averageBestPercentage: number | null;
  medianBestPercentage: number | null;
};

type ResultsFixture = { group: typeof group; activity: ActivityFixture; summary: SummaryFixture; students: StudentFixture[] };

// Mejores porcentajes enviados: 90, 60 y 42 → promedio 64 y mediana 60.
// El orden del arreglo no es alfabético a propósito: la vista ordena sólo en React.
const resultsFixture = (): ResultsFixture => ({
  group,
  activity,
  summary: { totalStudents: 5, withoutAttempt: 1, inProgress: 1, inicial: 1, en_proceso: 1, logrado: 1, averageBestPercentage: 64, medianBestPercentage: 60 },
  students: [
    { studentId: 9, displayName: "Alumno Beta", username: "alumno-beta", best: null, attemptsUsed: 1, hasDraft: true, lastSubmittedAt: null },
    { studentId: 3, displayName: "Alumno Alfa", username: "alumno-alfa", best: { percentage: 90, score: 9, total: 10, judgment: "logrado", ordinal: 2, submittedAt: "2027-05-03T12:00:00Z" }, attemptsUsed: 3, hasDraft: true, lastSubmittedAt: "2027-05-03T12:00:00Z" },
    { studentId: 4, displayName: "Alumno Epsilon", username: "alumno-epsilon", best: null, attemptsUsed: 0, hasDraft: false, lastSubmittedAt: null },
    { studentId: 6, displayName: "Alumno Delta", username: "alumno-delta", best: { percentage: 60, score: 6, total: 10, judgment: "en_proceso", ordinal: 1, submittedAt: "2027-05-02T12:00:00Z" }, attemptsUsed: 1, hasDraft: false, lastSubmittedAt: "2027-05-02T12:00:00Z" },
    { studentId: 5, displayName: "Alumno Gamma", username: "alumno-gamma", best: { percentage: 42, score: 5, total: 12, judgment: "inicial", ordinal: 3, submittedAt: "2027-05-01T12:00:00Z" }, attemptsUsed: 2, hasDraft: false, lastSubmittedAt: "2027-05-01T12:00:00Z" },
  ],
});

// Payload mínimo de C1 para comprobar la navegación matriz → detalle.
const matrixFixture = () => ({
  group,
  activities: [activity],
  students: [{ id: 3, displayName: "Alumno Alfa", username: "alumno-alfa" }],
  cells: [{ studentId: 3, activityId: 101, best: { percentage: 90, score: 9, total: 10, judgment: "logrado", ordinal: 2, submittedAt: "2027-05-03T12:00:00Z" }, attemptsUsed: 3, hasDraft: true, lastSubmittedAt: "2027-05-03T12:00:00Z" }],
});

// Columnas de datos de la tabla C2, en el orden del contrato visual.
const column = { best: 0, state: 1, attempts: 2, draft: 3, submitted: 4 } as const;

const resultsUrl = (activityId: number) => `**/api/teacher/groups/7/activities/${activityId}/results`;

async function mockActivityResults(page: Page, options: { results?: ResultsFixture; activityId?: number; status?: number; error?: string; delay?: number } = {}) {
  const activityId = options.activityId ?? 101;
  const results = options.results ?? resultsFixture();
  const requests: string[] = [];
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route(resultsUrl(activityId), async (route) => {
    requests.push(route.request().url());
    if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
    if (options.status && options.status !== 200) {
      return route.fulfill({ status: options.status, contentType: "application/json", body: JSON.stringify({ error: options.error ?? "No fue posible consultar los resultados de la actividad" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(results) });
  });
  return { requests };
}

const rowOf = (page: Page, name: string) => page.locator(".activity-results-table tbody tr", { hasText: name });
const cellOf = (page: Page, name: string, index: number) => rowOf(page, name).locator("td").nth(index);
const visibleNames = (page: Page) => page.locator(".activity-results-table tbody tr .results-student-name").allTextContents();
const indicator = (page: Page, label: string) => page.locator(".activity-results-summary-item").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

test("abre el detalle desde la matriz de resultados, muestra encabezado y disponibilidad, y vuelve", async ({ page }) => {
  await mockActivityResults(page);
  await page.route("**/api/teacher/groups/7/results", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(matrixFixture()) }));

  await page.goto("/docente/grupos/7/resultados");
  await expect(page.getByRole("heading", { name: "Resultados" })).toBeVisible();
  await page.getByRole("button", { name: "Ver detalle de Variables en Java" }).click();

  await expect(page).toHaveURL(/\/docente\/grupos\/7\/actividades\/101\/resultados$/);
  await expect(page.getByRole("heading", { name: "Variables en Java" })).toBeVisible();
  await expect(page.getByText("Grupo A · grupo-a")).toBeVisible();
  await expect(page.getByText("Programación")).toBeVisible();
  await expect(page.getByText("Estado de disponibilidad:")).toBeVisible();
  await expect(page.getByText("Disponible")).toBeVisible();
  await expect(page.getByRole("region", { name: /Detalle de Variables en Java en el grupo Grupo A/ })).toBeVisible();

  await page.getByRole("button", { name: "← Volver a resultados" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/resultados$/);
  await expect(page.getByRole("heading", { name: "Resultados" })).toBeVisible();
});

test("refleja el estado de disponibilidad que informa el backend para otra actividad", async ({ page }) => {
  await mockActivityResults(page, { activityId: 102, results: { ...resultsFixture(), activity: secondActivity } });
  await page.goto("/docente/grupos/7/actividades/102/resultados");

  await expect(page).toHaveURL(/\/docente\/grupos\/7\/actividades\/102\/resultados$/);
  await expect(page.getByRole("heading", { name: "Bucles en Java" })).toBeVisible();
  await expect(page.getByText("Todavía no abierta")).toBeVisible();
});

test("muestra los ocho indicadores con el promedio y la mediana que calculó el backend", async ({ page }) => {
  await mockActivityResults(page);
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  await expect(page.locator(".activity-results-summary-item")).toHaveCount(8);
  await expect(indicator(page, "Total")).toHaveText("5");
  await expect(indicator(page, "Sin intento")).toHaveText("1");
  await expect(indicator(page, "En progreso")).toHaveText("1");
  await expect(indicator(page, "Inicial")).toHaveText("1");
  await expect(indicator(page, "En proceso")).toHaveText("1");
  await expect(indicator(page, "Logrado")).toHaveText("1");
  await expect(indicator(page, "Promedio")).toHaveText("64%");
  await expect(indicator(page, "Mediana")).toHaveText("60%");
});

test("usa — cuando el backend no calcula promedio ni mediana y avisa que no hay envíos", async ({ page }) => {
  const withoutSubmissions: ResultsFixture = {
    group,
    activity,
    summary: { totalStudents: 2, withoutAttempt: 1, inProgress: 1, inicial: 0, en_proceso: 0, logrado: 0, averageBestPercentage: null, medianBestPercentage: null },
    students: [
      { studentId: 4, displayName: "Alumno Epsilon", username: "alumno-epsilon", best: null, attemptsUsed: 0, hasDraft: false, lastSubmittedAt: null },
      { studentId: 9, displayName: "Alumno Beta", username: "alumno-beta", best: null, attemptsUsed: 1, hasDraft: true, lastSubmittedAt: null },
    ],
  };
  await mockActivityResults(page, { results: withoutSubmissions });
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  await expect(indicator(page, "Promedio")).toHaveText("—");
  await expect(indicator(page, "Mediana")).toHaveText("—");
  await expect(page.getByText("Todavía no hay intentos enviados en esta actividad; sólo se muestran los intentos en curso o pendientes.")).toBeVisible();
  await expect(page.locator(".activity-results-table tbody tr")).toHaveCount(2);
});

test("representa sin intento, sólo borrador, inicial, en proceso y logrado", async ({ page }) => {
  await mockActivityResults(page);
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  // Sin intento: sin mejor resultado y sin borrador.
  await expect(cellOf(page, "Alumno Epsilon", column.state)).toContainText("Sin intento");
  await expect(cellOf(page, "Alumno Epsilon", column.best)).toHaveText("—");
  await expect(cellOf(page, "Alumno Epsilon", column.draft)).toHaveText("No");

  // Sólo borrador: en progreso, todavía sin mejor resultado.
  await expect(cellOf(page, "Alumno Beta", column.state)).toContainText("En progreso");
  await expect(cellOf(page, "Alumno Beta", column.best)).toHaveText("—");

  // Juicios persistidos: la vista no los recalcula.
  await expect(cellOf(page, "Alumno Gamma", column.state)).toContainText("Inicial");
  await expect(cellOf(page, "Alumno Gamma", column.best)).toContainText("42%");
  await expect(cellOf(page, "Alumno Delta", column.state)).toContainText("En proceso");
  await expect(cellOf(page, "Alumno Delta", column.best)).toContainText("60%");
  await expect(cellOf(page, "Alumno Alfa", column.state)).toContainText("Logrado");
  await expect(cellOf(page, "Alumno Alfa", column.best)).toContainText("90%");

  // La tabla no expone navegación de estudiante hacia C3/C4.
  await expect(page.getByRole("button", { name: /Alumno/ })).toHaveCount(0);
});

test("muestra el borrador como insignia separada sin reemplazar el juicio del mejor intento", async ({ page }) => {
  await mockActivityResults(page);
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  // Best + draft: manda el juicio del mejor intento y el borrador se informa aparte.
  await expect(cellOf(page, "Alumno Alfa", column.state)).toContainText("Logrado");
  await expect(cellOf(page, "Alumno Alfa", column.state)).toContainText("Borrador");
  await expect(cellOf(page, "Alumno Alfa", column.state)).not.toContainText("En progreso");
  await expect(cellOf(page, "Alumno Alfa", column.draft)).toHaveText("Sí");

  // Sólo borrador: el estado es "En progreso" y no lleva insignia aparte.
  await expect(cellOf(page, "Alumno Beta", column.state)).toContainText("En progreso");
  await expect(cellOf(page, "Alumno Beta", column.state)).not.toContainText("Borrador");
});

test("expone intentos usados y el último envío en hora local", async ({ page }) => {
  await mockActivityResults(page);
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  await expect(cellOf(page, "Alumno Alfa", column.attempts)).toHaveText("3 intentos");
  await expect(cellOf(page, "Alumno Gamma", column.attempts)).toHaveText("2 intentos");
  await expect(cellOf(page, "Alumno Delta", column.attempts)).toHaveText("1 intento");
  await expect(cellOf(page, "Alumno Epsilon", column.attempts)).toHaveText("0 intentos");

  const expected = await page.evaluate(() => new Date("2027-05-03T12:00:00Z").toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }));
  await expect(cellOf(page, "Alumno Alfa", column.submitted)).toHaveText(expected);
  await expect(cellOf(page, "Alumno Epsilon", column.submitted)).toHaveText("—");
  await expect(page.getByText("2027-05-03T12:00:00Z")).toHaveCount(0);
});

test("ordena alfabéticamente por defecto con un control accesible", async ({ page }) => {
  await mockActivityResults(page);
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  const sort = page.getByLabel("Ordenar por");
  await expect(sort).toHaveValue("name");
  await expect(sort.locator("option")).toHaveText(["Nombre A–Z", "Resultado menor→mayor", "Resultado mayor→menor"]);
  await expect(page.locator(".activity-results-table thead th")).toHaveText(["Estudiante", "Mejor resultado", "Estado", "Intentos", "Borrador", "Último envío"]);
  expect(await visibleNames(page)).toEqual(["Alumno Alfa", "Alumno Beta", "Alumno Delta", "Alumno Epsilon", "Alumno Gamma"]);
});

test("ordena por resultado en ambos sentidos, deja sin mejor intento al final y no vuelve a consultar", async ({ page }) => {
  const { requests } = await mockActivityResults(page);
  await page.goto("/docente/grupos/7/actividades/101/resultados");
  await expect(page.locator(".activity-results-table")).toBeVisible();
  const before = requests.length;

  const firstRow = page.locator(".activity-results-table tbody tr").first();
  const sort = page.getByLabel("Ordenar por");

  await sort.selectOption("score-asc");
  await expect(firstRow).toContainText("Alumno Gamma");
  expect(await visibleNames(page)).toEqual(["Alumno Gamma", "Alumno Delta", "Alumno Alfa", "Alumno Beta", "Alumno Epsilon"]);

  await sort.selectOption("score-desc");
  await expect(firstRow).toContainText("Alumno Alfa");
  expect(await visibleNames(page)).toEqual(["Alumno Alfa", "Alumno Delta", "Alumno Gamma", "Alumno Beta", "Alumno Epsilon"]);

  await sort.selectOption("name");
  await expect(firstRow).toContainText("Alumno Alfa");
  expect(await visibleNames(page)).toEqual(["Alumno Alfa", "Alumno Beta", "Alumno Delta", "Alumno Epsilon", "Alumno Gamma"]);

  // Ordenar es una operación local: no se repite la consulta al backend.
  expect(requests.length).toBe(before);
});

test("muestra el error del backend y permite reintentar", async ({ page }) => {
  let failing = true;
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route(resultsUrl(101), (route) => failing
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "No fue posible consultar los resultados de la actividad" }) })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify(resultsFixture()) }));

  await page.goto("/docente/grupos/7/actividades/101/resultados");
  await expect(page.getByRole("alert")).toContainText("No fue posible consultar los resultados de la actividad");
  await expect(page.locator(".activity-results-table")).toHaveCount(0);

  failing = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.locator(".activity-results-table")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("muestra el estado vacío cuando el grupo no tiene estudiantes activos", async ({ page }) => {
  const empty: ResultsFixture = {
    group,
    activity,
    summary: { totalStudents: 0, withoutAttempt: 0, inProgress: 0, inicial: 0, en_proceso: 0, logrado: 0, averageBestPercentage: null, medianBestPercentage: null },
    students: [],
  };
  await mockActivityResults(page, { results: empty });
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  await expect(page.getByText("Sin datos para mostrar")).toBeVisible();
  await expect(page.getByText("El grupo todavía no tiene estudiantes activos.")).toBeVisible();
  await expect(page.locator(".activity-results-table")).toHaveCount(0);
});

test("muestra el estado de carga mientras llega la respuesta", async ({ page }) => {
  await mockActivityResults(page, { delay: 1000 });
  await page.goto("/docente/grupos/7/actividades/101/resultados");

  await expect(page.getByText("Cargando resultados de la actividad…")).toBeVisible();
  await expect(page.locator(".activity-results-table")).toBeVisible();
});

test("no genera desbordamiento horizontal fuera del contenedor previsto y no comprime la tabla", async ({ page }) => {
  await mockActivityResults(page);
  await page.goto("/docente/grupos/7/actividades/101/resultados");
  await expect(page.locator(".activity-results-table")).toBeVisible();

  // El documento no desborda: el scroll horizontal queda dentro del contenedor previsto.
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  expect(await page.locator(".activity-results-matrix").evaluate((element) => getComputedStyle(element).overflowX)).toBe("auto");

  // La tabla conserva un ancho mínimo legible en lugar de comprimirse.
  const table = await page.locator(".activity-results-table").evaluate((element) => ({ minWidth: getComputedStyle(element).minWidth, width: element.getBoundingClientRect().width }));
  expect(table.minWidth).toBe("720px");
  expect(table.width).toBeGreaterThanOrEqual(720);
});
