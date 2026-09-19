import { expect, test, type Page } from "@playwright/test";

const teacher = {
  id: 1,
  username: "docente.visual",
  displayName: "Docente de prueba",
  email: "docente.visual@example.test",
  roles: ["docente"],
};

async function mockSession(page: Page, roles = teacher.roles) {
  await page.route("**/api/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { ...teacher, roles } }),
  }));
}

test("una cuenta estudiante no puede abrir la administración de activaciones", async ({ page }) => {
  await mockSession(page, ["estudiante"]);
  await page.goto("/docente/activaciones");
  await expect(page.getByRole("heading", { name: "Acceso restringido" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reemitir un acceso" })).toHaveCount(0);
});

test("el docente reemite y entrega un código ficticio", async ({ page, context }, testInfo) => {
  await mockSession(page);
  await context.addInitScript(() => { window.print = () => undefined; });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  await page.route("**/api/account-activations/candidates", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ candidates: [{ userId: 12, username: "ana.ejemplo.abcdef123456", displayName: "Ana Ejemplo", groupId: 4, groupCode: "PROG-1-MG-2026", groupName: "Programación · Grupo 1 MG", activationExpiresAt: "2026-09-30 18:00:00" }] }),
  }));
  await page.route("**/api/account-activations/reissue", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ userId: 12, groupId: 4, reason: "perdido" });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ group: { id: 4, code: "PROG-1-MG-2026", name: "Programación · Grupo 1 MG" }, credential: { displayName: "Ana Ejemplo", username: "ana.ejemplo.abcdef123456", activationCode: "PM-REEMISION-FICTICIA" }, expiresInDays: 14, activationCodeIsShownOnce: true }),
    });
  });

  await page.goto("/docente/activaciones");
  await page.getByText("Ana Ejemplo").click();
  await page.getByLabel("Motivo").selectOption("perdido");
  await page.getByText("Confirmo la identidad de Ana Ejemplo").click();
  await page.getByRole("button", { name: "Revocar y generar código nuevo" }).click();

  await expect(page.getByRole("heading", { name: "Activación reemitida" })).toBeVisible();
  await expect(page.getByText("El código anterior quedó revocado.")).toBeVisible();
  await page.addStyleTag({ content: "@media (max-width: 780px) { .topbar { display: none !important; } }" });
  await expect(page.locator(".import-result")).toHaveScreenshot(`activation-reissue-${testInfo.project.name}.png`);
  await page.getByRole("button", { name: "Copiar acceso" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("PM-REEMISION-FICTICIA");
  await page.getByText("Confirmo que entregué este acceso").click();
  await page.getByRole("button", { name: "Finalizar y borrar códigos" }).click();
  await expect(page.getByRole("heading", { name: "Código retirado de la pantalla" })).toBeVisible();
  await expect(page.getByText("PM-REEMISION-FICTICIA")).toHaveCount(0);
});
