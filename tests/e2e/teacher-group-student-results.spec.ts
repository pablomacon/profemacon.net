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

const student = { id: 3, displayName: "Alumno Alfa", username: "alumno-alfa" };

type Judgment = "inicial" | "en_proceso" | "logrado";
type AvailabilityStatus = "disabled" | "not_open" | "closed" | "available";
type AttemptFixture = { ordinal: number | null; percentage: number; judgment: Judgment; submittedAt: string };
type BestFixture = { percentage: number; score: number; total: number; judgment: Judgment; ordinal: number | null; submittedAt: string };

type ActivityFixture = {
  activityId: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  availabilityStatus: AvailabilityStatus;
  maxAttempts: number;
  best: BestFixture | null;
  attemptsUsed: number;
  hasDraft: boolean;
  lastSubmittedAt: string | null;
  submittedAttempts: AttemptFixture[];
};

type SummaryFixture = {
  totalActivities: number;
  withoutAttempt: number;
  inProgress: number;
  inicial: number;
  en_proceso: number;
  logrado: number;
  averageBestPercentage: number | null;
  medianBestPercentage: number | null;
};

type ResultsFixture = { group: typeof group; student: typeof student; summary: SummaryFixture; activities: ActivityFixture[] };

const attempt = (ordinal: number, percentage: number, judgment: Judgment, submittedAt: string): AttemptFixture => ({ ordinal, percentage, judgment, submittedAt });

const activityRow = (input: { activityId: number; title: string } & Partial<ActivityFixture>): ActivityFixture => ({
  slug: `actividad-${input.activityId}`,
  unitCode: "unidad-1",
  editorialState: "activa",
  availabilityStatus: "available",
  maxAttempts: 3,
  best: null,
  attemptsUsed: 0,
  hasDraft: false,
  lastSubmittedAt: null,
  submittedAttempts: [],
  ...input,
});

// El orden natural es deliberadamente no alfabético ni por id: la vista debe
// respetar exactamente el orden recibido del backend.
// Mejores resultados: 81, 75, 75 y 0 → promedio 57.8 y mediana 75.
const resultsFixture = (): ResultsFixture => ({
  group,
  student,
  summary: { totalActivities: 8, withoutAttempt: 3, inProgress: 1, inicial: 1, en_proceso: 2, logrado: 1, averageBestPercentage: 57.8, medianBestPercentage: 75 },
  activities: [
    activityRow({ activityId: 103, title: "Actividad evolución", maxAttempts: 5, best: { percentage: 81, score: 81, total: 100, judgment: "logrado", ordinal: 1, submittedAt: "2026-06-01T12:00:00Z" }, attemptsUsed: 2, lastSubmittedAt: "2026-06-02T12:00:00Z", submittedAttempts: [attempt(1, 81, "logrado", "2026-06-01T12:00:00Z"), attempt(2, 76, "en_proceso", "2026-06-02T12:00:00Z")] }),
    activityRow({ activityId: 101, title: "Variables en Java", maxAttempts: 10, best: { percentage: 75, score: 75, total: 100, judgment: "en_proceso", ordinal: 2, submittedAt: "2026-01-05T12:00:00Z" }, attemptsUsed: 4, hasDraft: true, lastSubmittedAt: "2026-01-10T12:00:00Z", submittedAttempts: [attempt(1, 50, "en_proceso", "2026-01-01T12:00:00Z"), attempt(2, 75, "en_proceso", "2026-01-05T12:00:00Z"), attempt(3, 25, "inicial", "2026-01-10T12:00:00Z")] }),
    activityRow({ activityId: 108, title: "Actividad empate", maxAttempts: 2, best: { percentage: 75, score: 75, total: 100, judgment: "en_proceso", ordinal: 1, submittedAt: "2026-05-01T12:00:00Z" }, attemptsUsed: 1, lastSubmittedAt: "2026-05-01T12:00:00Z", submittedAttempts: [attempt(1, 75, "en_proceso", "2026-05-01T12:00:00Z")] }),
    activityRow({ activityId: 107, title: "Actividad no abierta", availabilityStatus: "not_open", maxAttempts: 1 }),
    activityRow({ activityId: 102, title: "Actividad inicial", maxAttempts: 3, best: { percentage: 0, score: 0, total: 100, judgment: "inicial", ordinal: 1, submittedAt: "2026-07-01T12:00:00Z" }, attemptsUsed: 1, lastSubmittedAt: "2026-07-01T12:00:00Z", submittedAttempts: [attempt(1, 0, "inicial", "2026-07-01T12:00:00Z")] }),
    activityRow({ activityId: 105, title: "Actividad sin habilitación", availabilityStatus: "disabled", maxAttempts: 1 }),
    activityRow({ activityId: 104, title: "Actividad borrador", maxAttempts: 2, attemptsUsed: 1, hasDraft: true }),
    activityRow({ activityId: 106, title: "Actividad cerrada", availabilityStatus: "closed", maxAttempts: 1 }),
  ],
});

const naturalOrder = ["Actividad evolución", "Variables en Java", "Actividad empate", "Actividad no abierta", "Actividad inicial", "Actividad sin habilitación", "Actividad borrador", "Actividad cerrada"];
const ascendingOrder = ["Actividad inicial", "Variables en Java", "Actividad empate", "Actividad evolución", "Actividad no abierta", "Actividad sin habilitación", "Actividad borrador", "Actividad cerrada"];
const descendingOrder = ["Actividad evolución", "Variables en Java", "Actividad empate", "Actividad inicial", "Actividad no abierta", "Actividad sin habilitación", "Actividad borrador", "Actividad cerrada"];

const studentResultsUrl = "**/api/teacher/groups/7/students/3/results";

async function mockStudentResults(page: Page, options: { results?: ResultsFixture; status?: number; error?: string; delay?: number } = {}) {
  const results = options.results ?? resultsFixture();
  const requests: string[] = [];
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route(studentResultsUrl, async (route) => {
    requests.push(route.request().url());
    if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
    if (options.status && options.status !== 200) {
      return route.fulfill({ status: options.status, contentType: "application/json", body: JSON.stringify({ error: options.error ?? "No fue posible consultar los resultados del estudiante" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(results) });
  });
  // Destino de la navegación por actividad (contrato C4): sólo para comprobar que
  // el nombre de la actividad abre sus intentos.
  await page.route("**/api/teacher/groups/7/students/3/activities/*/attempts", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    group,
    student,
    activity: { activityId: 101, slug: "variables-java-01", title: "Variables en Java", unitCode: "unidad-1", editorialState: "activa", availabilityStatus: "available", maxAttempts: 10 },
    summary: { attemptsUsed: 0, submittedCount: 0, annulledCount: 0, best: null, judgment: null, lastSubmittedAt: null, hasDraft: false, draftStartedAt: null },
    submittedAttempts: [],
    annulledAttempts: [],
    defaultAttemptId: null,
  }) }));
  return { requests };
}

// C1 y C2 se mockean sólo para comprobar los dos caminos de entrada a C3.
async function mockMatrix(page: Page) {
  await page.route("**/api/teacher/groups/7/results", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    group,
    activities: [{ id: 101, slug: "variables-java-01", title: "Variables en Java", unitCode: "unidad-1", editorialState: "activa", availabilityStatus: "available", maxAttempts: 10 }],
    students: [{ id: 3, displayName: "Alumno Alfa", username: "alumno-alfa" }],
    cells: [{ studentId: 3, activityId: 101, best: { percentage: 75, score: 75, total: 100, judgment: "en_proceso", ordinal: 2, submittedAt: "2026-01-05T12:00:00Z" }, attemptsUsed: 4, hasDraft: true, lastSubmittedAt: "2026-01-10T12:00:00Z" }],
  }) }));
}

async function mockActivityDetail(page: Page) {
  await page.route("**/api/teacher/groups/7/activities/101/results", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    group,
    activity: { id: 101, slug: "variables-java-01", title: "Variables en Java", unitCode: "unidad-1", editorialState: "activa", availabilityStatus: "available", maxAttempts: 10 },
    summary: { totalStudents: 1, withoutAttempt: 0, inProgress: 0, inicial: 0, en_proceso: 1, logrado: 0, averageBestPercentage: 75, medianBestPercentage: 75 },
    students: [{ studentId: 3, displayName: "Alumno Alfa", username: "alumno-alfa", best: { percentage: 75, score: 75, total: 100, judgment: "en_proceso", ordinal: 2, submittedAt: "2026-01-05T12:00:00Z" }, attemptsUsed: 4, hasDraft: true, lastSubmittedAt: "2026-01-10T12:00:00Z" }],
  }) }));
}

// Columnas de datos de la tabla C3, en el orden del contrato visual.
const column = { availability: 0, best: 1, state: 2, attempts: 3, draft: 4, submitted: 5, evolution: 6 } as const;

const rowOf = (page: Page, title: string) => page.locator(".student-results-table tbody tr", { hasText: title });
const cellOf = (page: Page, title: string, index: number) => rowOf(page, title).locator("td").nth(index);
const rowNames = (page: Page) => page.locator(".student-results-table tbody tr .results-student-name").allTextContents();
const indicator = (page: Page, label: string) => page.locator(".activity-results-summary-item").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

test("abre el detalle del estudiante desde la matriz del grupo y vuelve a C1", async ({ page }) => {
  await mockStudentResults(page);
  await mockMatrix(page);

  await page.goto("/docente/grupos/7/resultados");
  await expect(page.getByRole("heading", { name: "Resultados" })).toBeVisible();
  await page.getByRole("button", { name: "Ver detalle de Alumno Alfa" }).click();

  await expect(page).toHaveURL(/\/docente\/grupos\/7\/estudiantes\/3\/resultados$/);
  await expect(page.getByRole("heading", { name: "Alumno Alfa" })).toBeVisible();
  await expect(page.getByText("alumno-alfa")).toBeVisible();
  await expect(page.getByText("Grupo A · grupo-a — Programación · Edición ficticia (2027)")).toBeVisible();
  await expect(page.getByText("Total de actividades de la edición: 8")).toBeVisible();
  await expect(page.getByRole("region", { name: /Resultados de Alumno Alfa en el grupo Grupo A/ })).toBeVisible();

  await page.getByRole("button", { name: "← Volver a resultados" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/resultados$/);
  await expect(page.getByRole("heading", { name: "Resultados" })).toBeVisible();
});

test("abre el detalle del estudiante desde el detalle de la actividad", async ({ page }) => {
  await mockStudentResults(page);
  await mockActivityDetail(page);

  await page.goto("/docente/grupos/7/actividades/101/resultados");
  await expect(page.getByRole("heading", { name: "Variables en Java" })).toBeVisible();
  await page.getByRole("button", { name: "Ver detalle de Alumno Alfa" }).click();

  await expect(page).toHaveURL(/\/docente\/grupos\/7\/estudiantes\/3\/resultados$/);
  await expect(page.getByRole("heading", { name: "Alumno Alfa" })).toBeVisible();
});

test("muestra el resumen con los ocho indicadores y los valores del backend", async ({ page }) => {
  await mockStudentResults(page);
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");

  await expect(page.locator(".activity-results-summary-item")).toHaveCount(8);
  await expect(indicator(page, "Total de actividades")).toHaveText("8");
  await expect(indicator(page, "Sin intento")).toHaveText("3");
  await expect(indicator(page, "En progreso")).toHaveText("1");
  await expect(indicator(page, "Inicial")).toHaveText("1");
  await expect(indicator(page, "En proceso")).toHaveText("2");
  await expect(indicator(page, "Logrado")).toHaveText("1");
  await expect(indicator(page, "Promedio")).toHaveText("57.8%");
  await expect(indicator(page, "Mediana")).toHaveText("75%");
});

test("usa — cuando el backend no calcula promedio ni mediana", async ({ page }) => {
  const withoutSubmissions: ResultsFixture = {
    group,
    student,
    summary: { totalActivities: 2, withoutAttempt: 1, inProgress: 1, inicial: 0, en_proceso: 0, logrado: 0, averageBestPercentage: null, medianBestPercentage: null },
    activities: [
      activityRow({ activityId: 104, title: "Actividad borrador", attemptsUsed: 1, hasDraft: true }),
      activityRow({ activityId: 105, title: "Actividad sin habilitación", availabilityStatus: "disabled", maxAttempts: 1 }),
    ],
  };
  await mockStudentResults(page, { results: withoutSubmissions });
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");

  await expect(indicator(page, "Promedio")).toHaveText("—");
  await expect(indicator(page, "Mediana")).toHaveText("—");
  await expect(page.locator(".student-results-table tbody tr")).toHaveCount(2);
});

test("representa la tabla, los estados, el borrador, los intentos y el último envío", async ({ page }) => {
  await mockStudentResults(page);
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");

  // Encabezados accesibles de la tabla semántica.
  await expect(page.locator(".student-results-table thead th")).toHaveText([
    "Actividad", "Disponibilidad", "Mejor resultado", "Estado", "Intentos", "Borrador", "Último envío", "Evolución",
  ]);

  // Disponibilidad: los cuatro estados del contrato.
  await expect(cellOf(page, "Variables en Java", column.availability)).toHaveText("Disponible");
  await expect(cellOf(page, "Actividad no abierta", column.availability)).toHaveText("Todavía no abierta");
  await expect(cellOf(page, "Actividad cerrada", column.availability)).toHaveText("Cerrada");
  await expect(cellOf(page, "Actividad sin habilitación", column.availability)).toHaveText("No habilitada");

  // Mejor resultado: porcentaje del backend y guion cuando no hay envíos.
  await expect(cellOf(page, "Actividad evolución", column.best)).toContainText("81%");
  await expect(cellOf(page, "Variables en Java", column.best)).toContainText("75%");
  await expect(cellOf(page, "Actividad inicial", column.best)).toContainText("0%");
  await expect(cellOf(page, "Actividad borrador", column.best)).toHaveText("—");

  // Estados: logrado, en proceso, inicial, en progreso y sin intento.
  await expect(cellOf(page, "Actividad evolución", column.state)).toContainText("Logrado");
  await expect(cellOf(page, "Variables en Java", column.state)).toContainText("En proceso");
  await expect(cellOf(page, "Actividad inicial", column.state)).toContainText("Inicial");
  await expect(cellOf(page, "Actividad borrador", column.state)).toContainText("En progreso");
  await expect(cellOf(page, "Actividad cerrada", column.state)).toContainText("Sin intento");
  await expect(cellOf(page, "Actividad no abierta", column.state)).toContainText("Sin intento");

  // best + draft: manda el juicio del mejor intento y el borrador va aparte.
  await expect(cellOf(page, "Variables en Java", column.state)).toContainText("Borrador");
  await expect(cellOf(page, "Variables en Java", column.state)).not.toContainText("En progreso");
  await expect(cellOf(page, "Variables en Java", column.draft)).toHaveText("Sí");
  await expect(cellOf(page, "Actividad borrador", column.draft)).toHaveText("Sí");
  await expect(cellOf(page, "Actividad borrador", column.state)).not.toContainText("Borrador");
  await expect(cellOf(page, "Actividad cerrada", column.draft)).toHaveText("No");

  // Intentos usados respecto del máximo de la actividad.
  await expect(cellOf(page, "Variables en Java", column.attempts)).toHaveText("4 intentos de 10");
  await expect(cellOf(page, "Actividad evolución", column.attempts)).toHaveText("2 intentos de 5");
  await expect(cellOf(page, "Actividad empate", column.attempts)).toHaveText("1 intento de 2");
  await expect(cellOf(page, "Actividad cerrada", column.attempts)).toHaveText("0 intentos de 1");

  // Último envío en hora local; guion cuando nunca hubo envío.
  const expected = await page.evaluate(() => new Date("2026-01-10T12:00:00Z").toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }));
  await expect(cellOf(page, "Variables en Java", column.submitted)).toHaveText(expected);
  await expect(cellOf(page, "Actividad borrador", column.submitted)).toHaveText("—");
  await expect(page.getByText("2026-01-10T12:00:00Z")).toHaveCount(0);
});

test("renderiza la evolución de 0, 1, 2 y 3 o más envíos y preserva la secuencia descendente", async ({ page }) => {
  await mockStudentResults(page);
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");

  // 3 envíos: secuencia completa en el orden recibido.
  await expect(cellOf(page, "Variables en Java", column.evolution)).toHaveText("50% → 75% → 25%");
  // 2 envíos descendentes: 81 → 76 preservado.
  await expect(cellOf(page, "Actividad evolución", column.evolution)).toHaveText("81% → 76%");
  // 1 envío: valor único, sin flecha.
  await expect(cellOf(page, "Actividad inicial", column.evolution)).toHaveText("0%");
  await expect(cellOf(page, "Actividad empate", column.evolution)).toHaveText("75%");
  // Sin envíos: guion.
  await expect(cellOf(page, "Actividad cerrada", column.evolution)).toHaveText("—");
  await expect(cellOf(page, "Actividad borrador", column.evolution)).toHaveText("—");

  // La celda expone la secuencia completa en palabras para lectores de pantalla.
  await expect(page.getByRole("cell", { name: "3 envíos: 50 por ciento, 75 por ciento, 25 por ciento" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2 envíos: 81 por ciento, 76 por ciento" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sin envíos" }).first()).toBeVisible();

  // La evolución no se interpreta ni marca el mejor intento.
  await expect(page.getByText("mejoró")).toHaveCount(0);
  await expect(page.getByText("empeoró")).toHaveCount(0);
});

test("respeta el orden natural y ordena por resultado sin repetir consultas", async ({ page }) => {
  const { requests } = await mockStudentResults(page);
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");
  await expect(page.locator(".student-results-table")).toBeVisible();
  const before = requests.length;

  const sort = page.getByLabel("Ordenar por");
  await expect(sort).toHaveValue("natural");
  await expect(sort.locator("option")).toHaveText(["Orden natural", "Resultado menor→mayor", "Resultado mayor→menor"]);
  expect(await rowNames(page)).toEqual(naturalOrder);

  const firstRow = page.locator(".student-results-table tbody tr").first();

  await sort.selectOption("score-asc");
  await expect(firstRow).toContainText("Actividad inicial");
  expect(await rowNames(page)).toEqual(ascendingOrder);

  await sort.selectOption("score-desc");
  await expect(firstRow).toContainText("Actividad evolución");
  expect(await rowNames(page)).toEqual(descendingOrder);

  await sort.selectOption("natural");
  await expect(firstRow).toContainText("Actividad evolución");
  expect(await rowNames(page)).toEqual(naturalOrder);

  // Ordenar es local: no se repite la consulta al backend.
  expect(requests.length).toBe(before);
});

test("muestra el estado de carga mientras llega la respuesta", async ({ page }) => {
  await mockStudentResults(page, { delay: 1000 });
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");

  await expect(page.getByText("Cargando resultados del estudiante…")).toBeVisible();
  await expect(page.locator(".student-results-table")).toBeVisible();
});

test("muestra el error del backend y permite reintentar", async ({ page }) => {
  let failing = true;
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route(studentResultsUrl, (route) => failing
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "No fue posible consultar los resultados del estudiante" }) })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify(resultsFixture()) }));

  await page.goto("/docente/grupos/7/estudiantes/3/resultados");
  await expect(page.getByRole("alert")).toContainText("No fue posible consultar los resultados del estudiante");
  await expect(page.locator(".student-results-table")).toHaveCount(0);

  failing = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.locator(".student-results-table")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("muestra el estado vacío cuando la edición no tiene actividades", async ({ page }) => {
  const empty: ResultsFixture = {
    group,
    student,
    summary: { totalActivities: 0, withoutAttempt: 0, inProgress: 0, inicial: 0, en_proceso: 0, logrado: 0, averageBestPercentage: null, medianBestPercentage: null },
    activities: [],
  };
  await mockStudentResults(page, { results: empty });
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");

  await expect(page.getByText("Sin datos para mostrar")).toBeVisible();
  await expect(page.getByText("La edición todavía no tiene actividades.")).toBeVisible();
  await expect(page.locator(".student-results-table")).toHaveCount(0);
});

test("no desborda el documento y la tabla hace su propio scroll horizontal", async ({ page }) => {
  await mockStudentResults(page);
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");
  await expect(page.locator(".student-results-table")).toBeVisible();

  // El documento no desborda: el scroll horizontal queda dentro del contenedor.
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  expect(await page.locator(".activity-results-matrix").evaluate((element) => getComputedStyle(element).overflowX)).toBe("auto");

  // La tabla conserva un ancho mínimo legible en lugar de comprimirse.
  const table = await page.locator(".student-results-table").evaluate((element) => ({ minWidth: getComputedStyle(element).minWidth, width: element.getBoundingClientRect().width }));
  expect(table.minWidth).toBe("900px");
  expect(table.width).toBeGreaterThanOrEqual(900);
});

test("abre los intentos de una actividad desde su nombre y vuelve a C3", async ({ page }) => {
  await mockStudentResults(page);
  await page.goto("/docente/grupos/7/estudiantes/3/resultados");
  await expect(page.locator(".student-results-table")).toBeVisible();

  // Sólo el nombre de la actividad abre sus intentos; la fila no es clickeable.
  await expect(rowOf(page, "Variables en Java").getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Ver intentos de Variables en Java" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/estudiantes\/3\/actividades\/101\/intentos$/);
  await expect(page.getByRole("heading", { name: "Alumno Alfa" })).toBeVisible();

  await page.getByRole("button", { name: "← Volver a resultados del estudiante" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/estudiantes\/3\/resultados$/);
  await expect(page.locator(".student-results-table")).toBeVisible();
});
