import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const teacher = {
  id: 1,
  username: "docente.visual",
  displayName: "Docente de prueba",
  email: "docente.visual@example.test",
  roles: ["docente"],
};

async function mockSession(page: Page, roles = teacher.roles) {
  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { ...teacher, roles } }),
    });
  });
}

test("una persona sin sesión no puede abrir el importador", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sesión requerida" }) }));
  await page.goto("/docente/importar-estudiantes");
  await expect(page.getByRole("heading", { name: "Panel docente" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sesión requerida" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Importar un portafolio" })).toHaveCount(0);
});

test("una cuenta estudiante ve el acceso restringido", async ({ page }) => {
  await mockSession(page, ["estudiante"]);
  await page.goto("/docente/importar-estudiantes");
  await expect(page.getByRole("heading", { name: "Acceso restringido" })).toBeVisible();
  await expect(page.getByText("Esta cuenta no administra grupos")).toBeVisible();
});

test("el asistente docente es legible y no desborda la pantalla", async ({ page }, testInfo) => {
  await mockSession(page);
  await page.goto("/docente/importar-estudiantes");
  await expect(page.getByRole("heading", { name: "Importar un portafolio" })).toBeVisible();
  const steps = page.getByRole("list", { name: "Etapas de la importación" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText("Archivo");
  await expect(steps.nth(1)).toContainText("Confirmación");
  await expect(steps.nth(2)).toContainText("Previsualización");
  await expect(steps.nth(3)).toContainText("Resultado");
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
  await expect(page).toHaveScreenshot(`student-import-empty-${testInfo.project.name}.png`, { fullPage: true });
});

test("el navegador lee el portafolio autorizado sin aplicarlo", async ({ page }) => {
  const portfolioPath = process.env.PORTFOLIO_TEST_FILE;
  test.skip(!portfolioPath || !existsSync(portfolioPath), "Defina PORTFOLIO_TEST_FILE con un XLSX autorizado para habilitar esta comprobación.");
  await mockSession(page);
  await page.goto("/docente/importar-estudiantes");
  await page.locator('input[type="file"]').setInputFiles(portfolioPath!);
  await expect(page.getByText("19", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Portafolio_PROGRAMACION_Grupo_1__MG_2025_2025-11-24.xlsx", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(19);
  await expect(page.getByText("No se importan número de lista, fecha de nacimiento ni vencimiento del carné de salud.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aplicar importación" })).toHaveCount(0);
});
