import { expect, test, type Page } from "@playwright/test";

const teacher = { username: "docente.ficticio", displayName: "Docente ficticio", roles: ["docente"] };

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

const activity = {
  activityId: 101,
  slug: "variables-java-01",
  title: "Variables en Java",
  unitCode: "unidad-1",
  editorialState: "activa",
  availabilityStatus: "available",
  maxAttempts: 5,
};

type Judgment = "inicial" | "en_proceso" | "logrado";
type AnswerFixture = { value: string } | { values: string[] };
type QuestionFixture = {
  number: number;
  type: "radio" | "checkbox" | "text" | "ordenar";
  prompt: string;
  maxPoints: number;
  answered: boolean;
  correct: boolean;
  pointsAwarded: number;
  answer: AnswerFixture | null;
  expected: AnswerFixture | null;
  explanation: string | null;
};
type AttemptFixture = {
  attemptId: number;
  number: number;
  ordinal: number | null;
  score: number;
  total: number;
  percentage: number;
  judgment: Judgment;
  submittedAt: string;
  isBest: boolean;
  questions: QuestionFixture[];
};
type AnnulledFixture = {
  attemptId: number;
  number: number;
  ordinal: number | null;
  state: "anulado";
  startedAt: string;
  countsForResults: false;
};
type SummaryFixture = {
  attemptsUsed: number;
  submittedCount: number;
  annulledCount: number;
  best: null | {
    attemptId: number;
    ordinal: number | null;
    percentage: number;
    score: number;
    total: number;
    judgment: Judgment;
    submittedAt: string;
  };
  judgment: Judgment | null;
  lastSubmittedAt: string | null;
  hasDraft: boolean;
  draftStartedAt: string | null;
};
type AttemptsFixture = {
  group: typeof group;
  student: typeof student;
  activity: typeof activity;
  summary: SummaryFixture;
  submittedAttempts: AttemptFixture[];
  annulledAttempts: AnnulledFixture[];
  defaultAttemptId: number | null;
};

// Tres enviados en el orden cronológico que entrega el backend: el segundo es el
// mejor intento y el tercero reutilizó el ordinal liberado, así que sólo conserva
// su número de registro histórico.
const attemptsFixture = (): AttemptsFixture => ({
  group,
  student,
  activity,
  summary: {
    attemptsUsed: 4,
    submittedCount: 3,
    annulledCount: 1,
    best: { attemptId: 12, ordinal: 2, percentage: 70, score: 70, total: 100, judgment: "inicial", submittedAt: "2026-01-10T10:00:00Z" },
    judgment: "inicial",
    lastSubmittedAt: "2026-02-01T10:00:00Z",
    hasDraft: true,
    draftStartedAt: "2026-02-02T09:30:00Z",
  },
  submittedAttempts: [
    {
      attemptId: 11,
      number: 1,
      ordinal: 1,
      score: 30,
      total: 100,
      percentage: 30,
      judgment: "inicial",
      submittedAt: "2026-01-10T10:00:00Z",
      isBest: false,
      questions: [
        {
          number: 1,
          type: "radio",
          prompt: "Pregunta radio",
          maxPoints: 30,
          answered: true,
          correct: true,
          pointsAwarded: 30,
          answer: { value: "Opción B" },
          expected: { value: "Opción B" },
          explanation: "Explicación uno",
        },
        {
          number: 2,
          type: "checkbox",
          prompt: "Pregunta checkbox",
          maxPoints: 40,
          answered: true,
          correct: false,
          pointsAwarded: 0,
          answer: { values: ["Alternativa B", "Alternativa C"] },
          expected: { values: ["Alternativa A", "Alternativa C"] },
          explanation: null,
        },
        {
          number: 3,
          type: "text",
          prompt: "Pregunta texto",
          maxPoints: 30,
          answered: false,
          correct: false,
          pointsAwarded: 0,
          answer: null,
          expected: { values: ["Java"] },
          explanation: "Explicación tres",
        },
      ],
    },
    {
      attemptId: 12,
      number: 2,
      ordinal: 2,
      score: 70,
      total: 100,
      percentage: 70,
      judgment: "inicial",
      submittedAt: "2026-01-10T10:00:00Z",
      isBest: true,
      questions: [
        {
          number: 1,
          type: "radio",
          prompt: "Pregunta radio",
          maxPoints: 30,
          answered: true,
          correct: false,
          pointsAwarded: 0,
          answer: { value: "Opción A" },
          expected: { value: "Opción B" },
          explanation: null,
        },
        {
          number: 2,
          type: "checkbox",
          prompt: "Pregunta checkbox",
          maxPoints: 40,
          answered: true,
          correct: true,
          pointsAwarded: 40,
          answer: { values: ["Alternativa A", "Alternativa C"] },
          expected: { values: ["Alternativa A", "Alternativa C"] },
          explanation: null,
        },
        {
          number: 3,
          type: "text",
          prompt: "Pregunta texto",
          maxPoints: 30,
          answered: true,
          correct: true,
          pointsAwarded: 30,
          answer: { value: "Java" },
          expected: { values: ["Java", "java"] },
          explanation: "Explicación tres",
        },
      ],
    },
    {
      attemptId: 13,
      number: 3,
      ordinal: null,
      score: 70,
      total: 100,
      percentage: 70,
      judgment: "logrado",
      submittedAt: "2026-02-01T10:00:00Z",
      isBest: false,
      questions: [
        {
          number: 1,
          type: "text",
          prompt: "Pregunta texto",
          maxPoints: 10,
          answered: true,
          correct: false,
          pointsAwarded: 0,
          answer: { value: "javascript" },
          expected: { values: ["Java", "java"] },
          explanation: null,
        },
        {
          number: 2,
          type: "ordenar",
          prompt: "Pregunta de ordenamiento",
          maxPoints: 10,
          answered: true,
          correct: true,
          pointsAwarded: 10,
          answer: { values: ["b", "a"] },
          expected: null,
          explanation: null,
        },
      ],
    },
  ],
  annulledAttempts: [
    { attemptId: 14, number: 4, ordinal: 4, state: "anulado", startedAt: "2026-01-11T09:00:00Z", countsForResults: false },
  ],
  defaultAttemptId: 12,
});

const attemptsUrl = "**/api/teacher/groups/7/students/3/activities/101/attempts";

async function mockAttempts(page: Page, options: { payload?: AttemptsFixture; status?: number; error?: string; delay?: number } = {}) {
  const payload = options.payload ?? attemptsFixture();
  const requests: string[] = [];
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route(attemptsUrl, async (route) => {
    requests.push(route.request().url());
    if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
    if (options.status && options.status !== 200) {
      return route.fulfill({ status: options.status, contentType: "application/json", body: JSON.stringify({ error: options.error ?? "No fue posible consultar los intentos del estudiante" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
  return { requests };
}

// C3 se mockea sólo para comprobar el camino de entrada a C4.
async function mockStudentResults(page: Page) {
  await page.route("**/api/teacher/groups/7/students/3/results", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    group,
    student,
    summary: { totalActivities: 1, withoutAttempt: 0, inProgress: 0, inicial: 1, en_proceso: 0, logrado: 0, averageBestPercentage: 30, medianBestPercentage: 30 },
    activities: [{
      activityId: 101,
      slug: "variables-java-01",
      title: "Variables en Java",
      unitCode: "unidad-1",
      editorialState: "activa",
      availabilityStatus: "available",
      maxAttempts: 5,
      best: { percentage: 30, score: 30, total: 100, judgment: "inicial", ordinal: 1, submittedAt: "2026-01-10T10:00:00Z" },
      attemptsUsed: 4,
      hasDraft: true,
      lastSubmittedAt: "2026-01-10T10:00:00Z",
      submittedAttempts: [],
    }],
  }) }));
}

const questionOf = (page: Page, number: number) =>
  page.locator(".attempt-question", { has: page.locator("h3", { hasText: new RegExp(`^Pregunta ${number}$`) }) });
const answerOf = (page: Page, number: number, label: string) =>
  questionOf(page, number).locator(`dl > dt:text-is("${label}") + dd`);
const summaryValue = (page: Page, label: string) =>
  page.locator(".activity-results-summary-item").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
const attemptChoices = (page: Page) => page.locator(".attempt-choice");
const choiceOf = (page: Page, label: string) => page.locator(".attempt-choice", { hasText: label });

test("abre los intentos desde el detalle del estudiante, muestra el encabezado y vuelve a C3", async ({ page }) => {
  await mockAttempts(page);
  await mockStudentResults(page);

  await page.goto("/docente/grupos/7/estudiantes/3/resultados");
  await page.getByRole("button", { name: "Ver intentos de Variables en Java" }).click();

  await expect(page).toHaveURL(/\/docente\/grupos\/7\/estudiantes\/3\/actividades\/101\/intentos$/);
  await expect(page.getByRole("heading", { name: "Alumno Alfa" })).toBeVisible();
  await expect(page.getByText("alumno-alfa")).toBeVisible();
  await expect(page.getByText("Grupo A · grupo-a — Programación · Edición ficticia (2027)")).toBeVisible();
  await expect(page.getByText("Variables en Java · unidad-1")).toBeVisible();
  await expect(page.getByText("Disponible")).toBeVisible();

  await page.getByRole("button", { name: "← Volver a resultados del estudiante" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/estudiantes\/3\/resultados$/);
  await expect(page.locator(".student-results-table")).toBeVisible();
});

test("muestra el resumen, el borrador y el selector con el intento por defecto", async ({ page }) => {
  await mockAttempts(page);
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");

  await expect(summaryValue(page, "Mejor resultado")).toHaveText("70%");
  await expect(summaryValue(page, "Estado")).toHaveText("Inicial");
  await expect(summaryValue(page, "Intentos usados")).toHaveText("4 de 5");
  await expect(summaryValue(page, "Intentos enviados")).toHaveText("3");
  await expect(summaryValue(page, "Borrador")).toHaveText("En progreso");
  const lastSubmission = await page.evaluate(() => new Date("2026-02-01T10:00:00Z").toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }));
  await expect(summaryValue(page, "Último envío")).toHaveText(lastSubmission);

  // El borrador sólo informa que existe y desde cuándo.
  await expect(page.getByText("Borrador en progreso.")).toBeVisible();
  const draftStart = await page.evaluate(() => new Date("2026-02-02T09:30:00Z").toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }));
  await expect(page.getByText(`Iniciado: ${draftStart}.`)).toBeVisible();

  // Selector en el orden recibido, con rótulo pedagógico y respaldo por registro.
  await expect(attemptChoices(page)).toHaveCount(3);
  await expect(page.locator(".attempt-choice-label")).toHaveText(["Intento 1", "Intento 2", "Registro de intento 3"]);
  await expect(page.locator(".attempt-choice-best")).toHaveCount(1);
  await expect(choiceOf(page, "Intento 2")).toContainText("Mejor intento");

  // El intento abierto al entrar es el sugerido por el backend.
  await expect(page.getByRole("heading", { name: "Intento 2" })).toBeVisible();
  await expect(choiceOf(page, "Intento 2")).toHaveAttribute("aria-pressed", "true");
  await expect(choiceOf(page, "Intento 1")).toHaveAttribute("aria-pressed", "false");
});

test("cambia de intento sin volver a consultar al backend", async ({ page }) => {
  const { requests } = await mockAttempts(page);
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");
  await expect(page.locator(".attempt-detail")).toBeVisible();
  const before = requests.length;

  await choiceOf(page, "Intento 1").click();
  await expect(page.getByRole("heading", { name: "Intento 1" })).toBeVisible();
  await expect(choiceOf(page, "Intento 1")).toHaveAttribute("aria-pressed", "true");
  await expect(choiceOf(page, "Intento 2")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("30 / 30 puntos").first()).toBeVisible();

  await choiceOf(page, "Registro de intento 3").click();
  await expect(page.getByRole("heading", { name: "Registro de intento 3" })).toBeVisible();
  await expect(page.getByText("Pregunta de ordenamiento")).toBeVisible();

  expect(requests.length).toBe(before);
});

test("renderiza las preguntas con respuesta dada, esperada, resultado, puntos y explicación", async ({ page }) => {
  await mockAttempts(page);
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");
  await choiceOf(page, "Intento 1").click();

  // Radio: textos visibles en la respuesta dada y en la esperada.
  await expect(answerOf(page, 1, "Respuesta del estudiante")).toHaveText("Opción B");
  await expect(answerOf(page, 1, "Respuesta esperada")).toHaveText("Opción B");
  await expect(questionOf(page, 1)).toContainText("Correcta");
  await expect(questionOf(page, 1)).toContainText("30 / 30 puntos");
  await expect(questionOf(page, 1)).toContainText("Explicación uno");

  // Checkbox: listas legibles, sin calcular diferencias.
  await expect(answerOf(page, 2, "Respuesta del estudiante").locator("li")).toHaveText(["Alternativa B", "Alternativa C"]);
  await expect(answerOf(page, 2, "Respuesta esperada").locator("li")).toHaveText(["Alternativa A", "Alternativa C"]);
  await expect(questionOf(page, 2)).toContainText("Incorrecta");
  await expect(questionOf(page, 2)).toContainText("0 / 40 puntos");

  // Texto sin responder: se informa de forma explícita.
  await expect(answerOf(page, 3, "Respuesta del estudiante")).toHaveText("Sin respuesta");
  await expect(answerOf(page, 3, "Respuesta esperada")).toHaveText("Java");
  await expect(questionOf(page, 3)).toContainText("Incorrecta");
  await expect(questionOf(page, 3)).toContainText("Explicación tres");

  // Cada pregunta es un bloque con su encabezado.
  await expect(page.locator(".attempt-question h3")).toHaveText(["Pregunta 1", "Pregunta 2", "Pregunta 3"]);
});

test("degrada las respuestas esperadas no disponibles y lista las referencias aceptadas", async ({ page }) => {
  await mockAttempts(page);
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");

  // Intento 2 (por defecto): un texto con varias referencias aceptadas.
  await expect(answerOf(page, 3, "Referencias aceptadas").locator("li")).toHaveText(["Java", "java"]);
  await expect(answerOf(page, 3, "Respuesta del estudiante")).toHaveText("Java");
  await expect(questionOf(page, 3)).toContainText("Correcta");

  // Intento 3: tipo todavía sin respuesta esperada disponible.
  await choiceOf(page, "Registro de intento 3").click();
  await expect(answerOf(page, 2, "Respuesta esperada")).toHaveText("Respuesta esperada no disponible para este tipo de pregunta");
  await expect(answerOf(page, 2, "Respuesta del estudiante").locator("li")).toHaveText(["b", "a"]);
  // El resto de la evidencia sigue disponible y la pantalla no falla.
  await expect(questionOf(page, 2)).toContainText("Pregunta de ordenamiento");
  await expect(questionOf(page, 2)).toContainText("10 / 10 puntos");
  await expect(questionOf(page, 2)).toContainText("Correcta");
});

test("mantiene los anulados ocultos, los muestra y los vuelve a ocultar sin alterar el resumen", async ({ page }) => {
  await mockAttempts(page);
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");

  // Ocultos por defecto.
  await expect(page.locator(".attempt-annulled-list")).toHaveCount(0);
  const bestBefore = await summaryValue(page, "Mejor resultado").innerText();
  const usedBefore = await summaryValue(page, "Intentos usados").innerText();

  await page.getByRole("button", { name: "Ver intentos anulados (1)" }).click();
  await expect(page.locator(".attempt-annulled-list li")).toHaveCount(1);
  const annulled = page.locator(".attempt-annulled-list li");
  await expect(annulled).toContainText("Intento anulado");
  await expect(annulled).toContainText("Iniciado:");
  await expect(annulled).toContainText("Registro histórico: intento 4");
  await expect(annulled).toContainText("No cuenta para resultados");
  // Nunca se presenta como un envío y nunca muestra preguntas ni respuestas.
  await expect(annulled).not.toContainText("Enviado");
  await expect(annulled.locator(".attempt-question")).toHaveCount(0);
  await expect(annulled.getByText("Respuesta del estudiante")).toHaveCount(0);

  // El resumen académico no cambia al desplegar los anulados.
  expect(await summaryValue(page, "Mejor resultado").innerText()).toBe(bestBefore);
  expect(await summaryValue(page, "Intentos usados").innerText()).toBe(usedBefore);
  await expect(summaryValue(page, "Intentos enviados")).toHaveText("3");

  await page.getByRole("button", { name: "Ocultar intentos anulados" }).click();
  await expect(page.locator(".attempt-annulled-list")).toHaveCount(0);
});

test("muestra el estado sin enviados pero con borrador", async ({ page }) => {
  await mockAttempts(page, { payload: {
    ...attemptsFixture(),
    summary: { attemptsUsed: 1, submittedCount: 0, annulledCount: 0, best: null, judgment: null, lastSubmittedAt: null, hasDraft: true, draftStartedAt: "2026-02-02T09:30:00Z" },
    submittedAttempts: [],
    annulledAttempts: [],
    defaultAttemptId: null,
  } });
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");

  await expect(page.getByText("Todavía no hay intentos enviados. Hay un borrador en progreso.")).toBeVisible();
  await expect(summaryValue(page, "Mejor resultado")).toHaveText("—");
  await expect(summaryValue(page, "Estado")).toHaveText("—");
  await expect(summaryValue(page, "Intentos enviados")).toHaveText("0");
  await expect(page.locator(".attempt-selector")).toHaveCount(0);
  await expect(page.locator(".attempt-detail")).toHaveCount(0);
});

test("muestra el estado sin enviados ni borrador y conserva los anulados accesibles", async ({ page }) => {
  await mockAttempts(page, { payload: {
    ...attemptsFixture(),
    summary: { attemptsUsed: 0, submittedCount: 0, annulledCount: 1, best: null, judgment: null, lastSubmittedAt: null, hasDraft: false, draftStartedAt: null },
    submittedAttempts: [],
    defaultAttemptId: null,
  } });
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");

  await expect(page.getByText("Todavía no hay intentos enviados.")).toBeVisible();
  await expect(page.locator(".attempt-draft")).toHaveCount(0);
  await page.getByRole("button", { name: "Ver intentos anulados (1)" }).click();
  await expect(page.locator(".attempt-annulled-list li")).toHaveCount(1);
});

test("muestra el estado de carga mientras llega la respuesta", async ({ page }) => {
  await mockAttempts(page, { delay: 1000 });
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");

  await expect(page.getByText("Cargando intentos del estudiante…")).toBeVisible();
  await expect(page.locator(".attempt-selector")).toBeVisible();
});

test("muestra el error del backend y permite reintentar", async ({ page }) => {
  let failing = true;
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route(attemptsUrl, (route) => failing
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "No fue posible consultar los intentos del estudiante" }) })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify(attemptsFixture()) }));

  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");
  await expect(page.getByRole("alert")).toContainText("No fue posible consultar los intentos del estudiante");
  await expect(page.locator(".attempt-selector")).toHaveCount(0);

  failing = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.locator(".attempt-selector")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("no ofrece acciones administrativas, comparación ni análisis automático", async ({ page }) => {
  await mockAttempts(page);
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");
  await page.getByRole("button", { name: "Ver intentos anulados (1)" }).click();
  await expect(page.locator(".attempt-annulled-list li")).toHaveCount(1);

  for (const forbidden of ["Editar", "Cambiar puntaje", "Anular", "Restaurar", "Reabrir", "Intento extra", "Confirmar", "Comentario", "Comparar"]) {
    await expect(page.getByRole("button", { name: new RegExp(forbidden, "i") })).toHaveCount(0);
  }

  // El texto visible tampoco introduce valoraciones ni análisis automáticos.
  const content = (await page.locator("body").innerText()).toLowerCase();
  for (const forbidden of ["casi correcta", "equivalente", "similitud", "inteligencia", "clave de corrección", "modo de corrección", "sugerencia automática"]) {
    expect(content.includes(forbidden)).toBe(false);
  }
});

test("no desborda el documento y mantiene las tarjetas legibles", async ({ page }) => {
  await mockAttempts(page);
  await page.goto("/docente/grupos/7/estudiantes/3/actividades/101/intentos");
  await expect(page.locator(".attempt-question").first()).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const card = await page.locator(".attempt-question").first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, right: box.right };
  });
  expect(card.width).toBeGreaterThan(180);
  expect(card.right).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
});
