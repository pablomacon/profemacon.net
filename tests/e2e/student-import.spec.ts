import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

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

function fictionalPortfolio() {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estudiantes" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const worksheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>N.º de lista</t></is></c><c r="B1" t="inlineStr"><is><t>Apellido y nombre</t></is></c><c r="C1" t="inlineStr"><is><t>Documento</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>Ejemplo, Ana</t></is></c><c r="C2" t="inlineStr"><is><t>12345678</t></is></c></row></sheetData></worksheet>`;
  return Buffer.from(zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(relationships),
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  }));
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

test("la entrega individual permite copiar, confirmar y retirar los códigos", async ({ page, context }, testInfo) => {
  await mockSession(page);
  await context.addInitScript(() => { window.print = () => undefined; });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  const source = {
    filename: "Portafolio_PROGRAMACION_Grupo_1__MG_2026_2026-09-19.xlsx",
    subjectLabel: "PROGRAMACION",
    groupSourceLabel: "Grupo_1__MG",
    academicYear: 2026,
    fileSha256: "a".repeat(64),
  };
  const student = { sourceRow: 2, displayName: "Ana Ejemplo", username: "ana.ejemplo.abcdef123456", action: "create_and_enroll", documentEnding: "5678" };
  const plan = {
    source,
    targetGroup: { id: 1, code: "PROG-1-MG-2026", name: "Programación · Grupo 1 MG" },
    summary: { readRows: 1, validRows: 1, rejectedRows: 0, newAccounts: 1, existingAccounts: 0, activationCodes: 1 },
    students: [student],
  };
  await page.route("**/api/student-imports/preview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) }));
  await page.route("**/api/student-imports/apply", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...plan, importId: "importacion-ficticia", activationCredentials: [{ sourceRow: 2, displayName: "Ana Ejemplo", username: student.username, activationCode: "PM-ACTIVACION-FICTICIA" }], activationCodesAreShownOnce: true }),
  }));

  await page.goto("/docente/importar-estudiantes");
  await page.locator('input[type="file"]').setInputFiles({ name: source.filename, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fictionalPortfolio() });
  await page.getByText("Confirmo que revisé el tipo y país").click();
  await page.getByRole("button", { name: "Previsualizar sin aplicar" }).click();
  await page.getByText("Confirmo que revisé el grupo").click();
  await page.getByRole("button", { name: "Aplicar importación" }).click();

  await expect(page.getByRole("heading", { name: "Entrega individual" })).toBeVisible();
  await expect(page.getByText("1 pendiente(s) de 1")).toBeVisible();
  await page.addStyleTag({ content: "@media (max-width: 780px) { .topbar { display: none !important; } }" });
  await expect(page.locator(".import-result")).toHaveScreenshot(`student-activation-delivery-${testInfo.project.name}.png`);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Imprimir ficha" }).click();
  const slip = await popupPromise;
  await expect(slip.getByRole("heading", { name: "Profe Macón" })).toBeVisible();
  await expect(slip.getByText("PM-ACTIVACION-FICTICIA")).toBeVisible();
  await expect(slip.getByText(/documento|cédula|pasaporte/i)).toHaveCount(0);
  await slip.close();
  await page.getByRole("button", { name: "Copiar acceso" }).click();
  await expect(page.getByRole("button", { name: "Copiado" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("PM-ACTIVACION-FICTICIA");
  await page.getByText("Confirmo que entregué este acceso").click();
  await page.getByRole("button", { name: "Finalizar y borrar códigos" }).click();
  await expect(page.getByRole("heading", { name: "Códigos retirados de la pantalla" })).toBeVisible();
  await expect(page.getByText("PM-ACTIVACION-FICTICIA")).toHaveCount(0);
});
