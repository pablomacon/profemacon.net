import { expect, test, type Page } from "@playwright/test";

const user = { id: 71, username: "estudiante.ficticio", displayName: "Estudiante ficticio", email: null, roles: ["estudiante"] };
const questions = [
  { number: 1, type: "radio", prompt: "Pregunta radio ficticia", instructions: "Elegí una opción", options: [{ valor: "a", texto: "Opción A" }, { valor: "b", texto: "Opción B" }], resources: [], placeholder: null, points: 1, answer: null },
  { number: 2, type: "checkbox", prompt: "Pregunta checkbox ficticia", instructions: "Elegí todas las necesarias", options: [{ valor: "a", texto: "Opción A" }, { valor: "c", texto: "Opción C" }], resources: [], placeholder: null, points: 1, answer: null },
  { number: 3, type: "text", prompt: "Pregunta texto ficticia", instructions: "Escribí una respuesta", options: [], resources: [], placeholder: "Respuesta ficticia", points: 1, answer: null },
];
const catalog = (draft: object | null = null, status = "available") => ({ activity: { slug: "actividad-ficticia", title: "Actividad ficticia", description: "Descripción ficticia", totalPoints: 3, maxAttempts: 2, approvalThreshold: 50, achievementThreshold: 76, reviewEnabled: true }, access: { status, groupCode: "grupo-a", groupName: "Grupo ficticio", availableFrom: null, availableUntil: null }, attempts: { used: 0, remaining: 2, reviewAvailable: false, best: null, draft }, questions });

async function session(page: Page) {
  await page.route("**/api/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }));
}

async function activityApi(page: Page, options: { draft?: boolean; saveFails?: boolean } = {}) {
  let saved = options.draft ? ["b", ["a", "c"], "texto guardado"] : [null, null, null];
  let saveFailures = options.saveFails ? 1 : 0;
  let saves = 0;
  let reviewRequests = 0;
  await page.route("**/api/me/activities/**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path.endsWith("/review")) { reviewRequests += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ bestAttemptId: 5, attempts: [{ id: 5, number: 1, ordinal: 1, score: 2, total: 3, percentage: 67, submittedAt: "2026-01-01T00:00:00Z", questions: questions.map((question, index) => ({ ...question, studentAnswer: saved[index], correct: index !== 1, pointsAwarded: index === 1 ? 0 : 1, maxPoints: 1, correctAnswer: { value: "solución ficticia" }, explanation: "Explicación ficticia" })) }, { id: 6, number: 2, ordinal: 2, score: 3, total: 3, percentage: 100, submittedAt: "2026-01-02T00:00:00Z", questions: [] }] }) }); }
    if (/\/attempts\/5\/submit$/.test(path)) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ attempt: { id: 5, state: "enviado", number: 1, ordinal: 1, score: 2, total: 3, percentage: 67, judgment: "en_proceso", submittedAt: "2026-01-01T00:00:00Z" }, attempts: { used: 1, remaining: 1, best: { number: 1, ordinal: 1, score: 2, total: 3, percentage: 67, submittedAt: "2026-01-01T00:00:00Z" } }, answers: [{ number: 1, correct: true, score: 1 }, { number: 2, correct: false, score: 0 }, { number: 3, correct: true, score: 1 }], reviewAvailable: true }) });
    if (/\/attempts\/5\/responses\//.test(path)) { saves += 1; if (saveFailures-- > 0) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fallo ficticio" }) }); const number = Number(path.split("/").at(-1)); saved[number - 1] = request.postDataJSON().answer; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ saved: true }) }); }
    if (/\/attempts\/5$/.test(path) && request.method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ activity: { slug: "actividad-ficticia", title: "Actividad ficticia", description: "", totalPoints: 3 }, access: { groupCode: "grupo-a", groupName: "Grupo ficticio" }, attempt: { id: 5, status: "en_progreso", number: 1, ordinal: 1, startedAt: "2026-01-01T00:00:00Z" }, questions: questions.map((question, index) => ({ ...question, answer: saved[index] })) }) });
    if (path.endsWith("/attempts") && request.method() === "POST") return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ attempt: { id: 5 } }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(catalog(options.draft ? { attemptId: 5, ordinal: 1, startedAt: "2026-01-01T00:00:00Z" } : null)) });
  });
  return { reviewRequests: () => reviewRequests, saves: () => saves };
}

test("inicia, guarda, entrega y revisa una actividad sin corregir en el navegador", async ({ page }) => {
  await session(page); const api = await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await expect(page.getByRole("heading", { name: "Actividad ficticia" })).toBeVisible();
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await expect(page.getByText("Pregunta radio ficticia")).toBeVisible();
  await page.getByLabel("Opción B").check();
  await page.locator('[data-question-number="2"]').getByLabel("Opción A").check(); await page.locator('[data-question-number="2"]').getByLabel("Opción C").check();
  await page.getByLabel("Respuesta para la pregunta 3").fill("texto local");
  await expect(page.getByText("Guardado").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Entregar intento" })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Entregar intento" }).click();
  await expect(page.getByRole("heading", { name: "Intento entregado" })).toBeVisible();
  await expect(page.getByText("Incorrecta · 0 puntos")).toBeVisible();
  expect(api.reviewRequests()).toBe(0);
  await page.getByRole("button", { name: "Revisar actividad" }).click();
  await expect(page.getByRole("heading", { name: "Revisión de la actividad" })).toBeVisible();
  expect(api.reviewRequests()).toBe(1);
  await expect(page.getByText("Respuesta correcta:").first()).toBeVisible();
});

test("continúa un borrador persistido y conserva la respuesta local si falla autosave", async ({ page }) => {
  await session(page); await activityApi(page, { draft: true, saveFails: true });
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Continuar intento" }).click();
  await expect(page.getByLabel("Opción B")).toBeChecked();
  await page.locator('[data-question-number="2"]').getByLabel("Opción A").uncheck();
  await expect(page.getByText("No se pudo guardar")).toBeVisible();
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Guardado").first()).toBeVisible();
});

test("muestra los estados de disponibilidad y no desborda", async ({ page }) => {
  await session(page);
  await page.route("**/api/me/activities/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(catalog(null, "closed")) }));
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await expect(page.getByText("La actividad ya cerró.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("permite reintentar una carga fallida y redirige al ingreso ante sesión vencida", async ({ page }) => {
  await session(page);
  await page.route("**/api/me/activities/**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Error ficticio" }) }));
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await expect(page.getByText("Error ficticio")).toBeVisible();
  await page.unroute("**/api/me/activities/**");
  await page.route("**/api/me/activities/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(catalog()) }));
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Actividad ficticia" })).toBeVisible();

  await page.unroute("**/api/me/activities/**");
  await page.route("**/api/me/activities/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sesión requerida" }) }));
  await page.reload();
  await expect(page.getByRole("button", { name: "Volver a ingresar" })).toBeVisible();
  await page.getByRole("button", { name: "Volver a ingresar" }).click();
  await expect(page).toHaveURL(/\/ingresar$/);
});

for (const [status, expected] of [
  ["not_open", "La actividad todavía no está abierta."],
  ["disabled", "La actividad no está habilitada."],
  ["no_attempts", "No quedan intentos disponibles."],
] as const) {
  test(`muestra el estado ${status}`, async ({ page }) => {
    await session(page);
    await page.route("**/api/me/activities/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(catalog(null, status)) }));
    await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
    await expect(page.getByText(expected)).toBeVisible();
    await expect(page.getByRole("button", { name: "Comenzar intento" })).toHaveCount(0);
  });
}

test("solicita y utiliza solamente un grupo autorizado cuando el selector es necesario", async ({ page }) => {
  await session(page);
  await page.route("**/api/me/activities/**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("groupCode") === "grupo-b") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...catalog(), access: { ...catalog().access, groupCode: "grupo-b", groupName: "Grupo B" } }) });
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "GROUP_REQUIRED", error: "Elegí un grupo", groups: [{ code: "grupo-a", name: "Grupo A" }, { code: "grupo-b", name: "Grupo B" }] }) });
  });
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await expect(page.getByRole("heading", { name: "Elegí un grupo" })).toBeVisible();
  await page.getByRole("button", { name: "Grupo B" }).click();
  await expect(page.getByText("Grupo B").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Comenzar intento" })).toBeVisible();
});

test("bloquea la entrega hasta que todas las respuestas estén completas", async ({ page }) => {
  await session(page); await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await expect(page.getByRole("button", { name: "Entregar intento" })).toBeDisabled();
});

test("aplica debounce al texto sin guardar cada pulsación", async ({ page }) => {
  await session(page); const api = await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await page.getByLabel("Respuesta para la pregunta 3").fill("texto");
  expect(api.saves()).toBe(0);
  await expect(page.getByText("Guardado").last()).toBeVisible();
  expect(api.saves()).toBe(1);
});

test("mantiene las preguntas sin respuesta como incompletas al recuperar un borrador", async ({ page }) => {
  await session(page); await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await expect(page.getByRole("button", { name: "Entregar intento" })).toBeDisabled();
  await expect(page.getByLabel("Respuesta para la pregunta 3")).toHaveValue("");
});

test("muestra el estado closed sin ofrecer un nuevo intento", async ({ page }) => {
  await session(page);
  await page.route("**/api/me/activities/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(catalog(null, "closed")) }));
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await expect(page.getByText("La actividad ya cerró.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Comenzar intento" })).toHaveCount(0);
});

test("no consulta revisión hasta que el estudiante la solicita", async ({ page }) => {
  await session(page); const api = await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  expect(api.reviewRequests()).toBe(0);
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await expect(page.getByText("Pregunta radio ficticia")).toBeVisible();
  expect(api.reviewRequests()).toBe(0);
});

test("presenta la segunda pestaña de revisión y destaca el mejor intento", async ({ page }) => {
  await session(page); const api = await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await page.getByLabel("Opción B").check();
  await page.locator('[data-question-number="2"]').getByLabel("Opción A").check();
  await page.locator('[data-question-number="2"]').getByLabel("Opción C").check();
  await page.getByLabel("Respuesta para la pregunta 3").fill("texto");
  await expect(page.getByText("Guardado").last()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "Entregar intento" }).click();
  await page.getByRole("button", { name: "Revisar actividad" }).click();
  await expect(page.getByRole("tab", { name: /Intento 1 · Mejor/ })).toBeVisible();
  await page.getByRole("tab", { name: "Intento 2" }).click();
  await expect(page.getByRole("tab", { name: "Intento 2" })).toHaveAttribute("aria-selected", "true");
  expect(api.reviewRequests()).toBe(1);
});

test("no muestra la solución correcta en el resultado previo a la revisión", async ({ page }) => {
  await session(page); await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await page.getByLabel("Opción B").check();
  await page.locator('[data-question-number="2"]').getByLabel("Opción A").check();
  await page.locator('[data-question-number="2"]').getByLabel("Opción C").check();
  await page.getByLabel("Respuesta para la pregunta 3").fill("texto");
  await expect(page.getByText("Guardado").last()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "Entregar intento" }).click();
  await expect(page.getByText("solución ficticia")).toHaveCount(0);
  await expect(page.getByText("Pregunta 2: Incorrecta · 0 puntos")).toBeVisible();
});

test("ofrece un segundo intento sólo después de una entrega con cupo", async ({ page }) => {
  await session(page); await activityApi(page);
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Comenzar intento" }).click();
  await page.getByLabel("Opción B").check();
  await page.locator('[data-question-number="2"]').getByLabel("Opción A").check();
  await page.locator('[data-question-number="2"]').getByLabel("Opción C").check();
  await page.getByLabel("Respuesta para la pregunta 3").fill("texto");
  await expect(page.getByText("Guardado").last()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "Entregar intento" }).click();
  await page.getByRole("button", { name: "Realizar otro intento" }).click();
  await expect(page.getByText("Pregunta radio ficticia")).toBeVisible();
});

test("inhabilita entrega mientras existe un error de persistencia", async ({ page }) => {
  await session(page); await activityApi(page, { draft: true, saveFails: true });
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Continuar intento" }).click();
  await page.locator('[data-question-number="2"]').getByLabel("Opción A").uncheck();
  await expect(page.getByText("No se pudo guardar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entregar intento" })).toBeDisabled();
});

test("ofrece revisión desde el catálogo agotado sin crear un borrador", async ({ page }) => {
  await session(page);
  let reviewCalls = 0;
  await page.route("**/api/me/activities/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/review")) { reviewCalls += 1; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ bestAttemptId: 9, attempts: [{ id: 9, number: 2, ordinal: 2, score: 3, total: 3, percentage: 100, submittedAt: "2026-01-02T00:00:00Z", questions: [] }] }) }); }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...catalog(null, "no_attempts"), attempts: { used: 2, remaining: 0, reviewAvailable: true, draft: null, best: { number: 2, ordinal: 2, score: 3, total: 3, percentage: 100, submittedAt: "2026-01-02T00:00:00Z" } } }) });
  });
  await page.goto("/curso/programacion-i/unidad-1/actividad/variables-java-01");
  await page.getByRole("button", { name: "Revisar actividad" }).click();
  await expect(page.getByRole("heading", { name: "Revisión de la actividad" })).toBeVisible();
  expect(reviewCalls).toBe(1);
});
