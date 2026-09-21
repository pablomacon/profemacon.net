import { expect, test, type Page } from "@playwright/test";

const teacher = { id: 2, username: "docente.ficticio", displayName: "Docente ficticio", email: null, roles: ["docente"] };
const group = { id: 7, code: "grupo-a", name: "Grupo A", subjectName: "Programación", editionName: "Edición ficticia", year: 2027, activeStudents: 2 };
const isoOpen = "2030-06-01T12:00:00Z";
const isoClose = "2030-06-02T12:00:00Z";

const activitiesFixture = () => ([
  { id: 101, slug: "variables-java-01", title: "Variables en Java", unitCode: "unidad-1", editorialState: "activa", maxAttempts: 3, availabilityId: 5, enabled: 1, opensAt: isoOpen, closesAt: isoClose, availabilityStatus: "not_open", participants: 2 },
  { id: 102, slug: "bucles-java", title: "Bucles en Java", unitCode: "unidad-1", editorialState: "borrador", maxAttempts: 1, availabilityId: null, enabled: null, opensAt: null, closesAt: null, availabilityStatus: "disabled", participants: 0 },
]);

const previewBody = {
  activity: { slug: "variables-java-01", title: "Variables en Java", description: "Versión borrador ficticia", totalPoints: 1 },
  groupCode: "grupo-a",
  questions: [{ number: 1, type: "radio", prompt: "Pregunta ficticia", instructions: "Elegí", options: [{ valor: "a", texto: "A" }, { valor: "b", texto: "B" }], resources: [], placeholder: null, points: 1 }],
};

async function mockTeacherActivities(page: Page, options: { activities?: ReturnType<typeof activitiesFixture>; listStatus?: number; listError?: string } = {}) {
  const activities = options.activities ?? activitiesFixture();
  const puts: Array<{ enabled: boolean; opensAt: string | null; closesAt: string | null }> = [];
  const previewUrls: string[] = [];
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: teacher }) }));
  await page.route("**/api/teacher/activities/**", (route) => {
    previewUrls.push(route.request().url());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(previewBody) });
  });
  await page.route("**/api/teacher/groups/7/activities/*/availability", (route) => {
    puts.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ groupId: 7, activityId: 101, enabled: true, opensAt: null, closesAt: null }) });
  });
  await page.route("**/api/teacher/groups/7/activities", (route) => {
    if (options.listStatus && options.listStatus !== 200) return route.fulfill({ status: options.listStatus, contentType: "application/json", body: JSON.stringify({ error: options.listError ?? "No fue posible consultar actividades" }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ group, activities }) });
  });
  await page.route("**/api/teacher/groups/7", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ group }) }));
  return { puts, previewUrls };
}

test("abre el listado de actividades del grupo y muestra sus estados", async ({ page }) => {
  await mockTeacherActivities(page);
  await page.goto("/docente/grupos/7");
  await page.getByRole("button", { name: "Actividades" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/actividades$/);
  await expect(page.getByRole("heading", { name: "Actividades" })).toBeVisible();

  const habilitada = page.locator(".module-card", { hasText: "Variables en Java" });
  await expect(habilitada.getByText("Todavía no abierta")).toBeVisible();
  await expect(habilitada.getByText("3 intentos (solo lectura) · 2 estudiantes participantes")).toBeVisible();
  await expect(habilitada.getByText(`Apertura: ${isoOpen} · Cierre: ${isoClose}`)).toBeVisible();

  const sinHabilitacion = page.locator(".module-card", { hasText: "Bucles en Java" });
  await expect(sinHabilitacion.getByText("No habilitada")).toBeVisible();
  await expect(sinHabilitacion.getByText("1 intentos (solo lectura) · 0 estudiantes participantes")).toBeVisible();
  await expect(sinHabilitacion.getByText("Apertura: Sin fecha · Cierre: Sin fecha")).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("habilita una actividad sin habilitación y guarda el PUT", async ({ page }) => {
  const { puts } = await mockTeacherActivities(page);
  await page.goto("/docente/grupos/7/actividades");
  const card = page.locator(".module-card", { hasText: "Bucles en Java" });
  await card.getByRole("button", { name: "Editar configuración" }).click();
  await page.getByLabel("Habilitada para este grupo").check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ enabled: true, opensAt: null, closesAt: null });
});

test("muestra la apertura en hora local y mantiene los intentos en solo lectura", async ({ page }) => {
  await mockTeacherActivities(page);
  await page.goto("/docente/grupos/7/actividades");
  const card = page.locator(".module-card", { hasText: "Variables en Java" });
  await card.getByRole("button", { name: "Editar configuración" }).click();
  const expected = await page.evaluate((iso) => {
    const date = new Date(iso);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, isoOpen);
  await expect(page.locator('input[name="opensAt"]')).toHaveValue(expected);
  await expect(page.getByText("Máximo de intentos: 3 (solo lectura).")).toBeVisible();
  await expect(page.locator(".import-panel input")).toHaveCount(3);
});

test("modifica apertura y cierre y los guarda en ISO UTC", async ({ page }) => {
  const { puts } = await mockTeacherActivities(page);
  await page.goto("/docente/grupos/7/actividades");
  const card = page.locator(".module-card", { hasText: "Variables en Java" });
  await card.getByRole("button", { name: "Editar configuración" }).click();
  await page.locator('input[name="opensAt"]').fill("2030-07-01T10:00");
  await page.locator('input[name="closesAt"]').fill("2030-07-02T10:00");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].enabled).toBe(true);
  const expectedOpen = await page.evaluate(() => new Date("2030-07-01T10:00").toISOString());
  const expectedClose = await page.evaluate(() => new Date("2030-07-02T10:00").toISOString());
  expect(puts[0].opensAt).toBe(expectedOpen);
  expect(puts[0].closesAt).toBe(expectedClose);
});

test("al deshabilitar pide confirmación y respeta la decisión", async ({ page }) => {
  const { puts } = await mockTeacherActivities(page);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.goto("/docente/grupos/7/actividades");
  const card = page.locator(".module-card", { hasText: "Variables en Java" });
  await card.getByRole("button", { name: "Editar configuración" }).click();
  await page.getByLabel("Habilitada para este grupo").uncheck();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("Deshabilitar");
  expect(puts.length).toBe(0);

  page.removeAllListeners("dialog");
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.accept(); });
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].enabled).toBe(false);
  expect(puts[0].opensAt?.endsWith("Z")).toBe(true);
  expect(puts[0].closesAt?.endsWith("Z")).toBe(true);
});

test("Probar actividad abre el preview contextual y volver retorna al listado", async ({ page }) => {
  const { previewUrls } = await mockTeacherActivities(page);
  await page.goto("/docente/grupos/7/actividades");
  const card = page.locator(".module-card", { hasText: "Variables en Java" });
  await card.getByRole("button", { name: "Probar actividad" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/actividades\/variables-java-01\/prueba$/);
  await expect(page.getByRole("heading", { name: "Variables en Java" })).toBeVisible();
  expect(previewUrls.some((url) => url.includes("groupCode=grupo-a"))).toBe(true);

  await page.getByRole("button", { name: "← Volver al panel docente" }).click();
  await expect(page).toHaveURL(/\/docente\/grupos\/7\/actividades$/);
  await expect(page.getByRole("heading", { name: "Actividades" })).toBeVisible();
});

test("muestra el error del listado de actividades", async ({ page }) => {
  await mockTeacherActivities(page, { listStatus: 500, listError: "No fue posible consultar actividades" });
  await page.goto("/docente/grupos/7/actividades");
  await expect(page.getByRole("alert")).toContainText("No fue posible consultar actividades");
});

test("muestra el estado vacío cuando el grupo no tiene actividades", async ({ page }) => {
  await mockTeacherActivities(page, { activities: [] });
  await page.goto("/docente/grupos/7/actividades");
  await expect(page.getByText("No hay actividades en el contexto académico de este grupo.")).toBeVisible();
});