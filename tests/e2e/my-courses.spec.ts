import { expect, test, type Page } from "@playwright/test";

const fictionalUser = {
  id: 41,
  username: "persona.prueba",
  displayName: "Persona de prueba",
  email: "persona@example.test",
  roles: ["estudiante"],
};

const programmingCourse = {
  subjectCode: "programacion-i",
  subjectName: "Programación I",
  year: 2026,
  editionName: "Programación I 2026",
  groupCode: "1-MG",
  groupName: "Grupo 1 MG",
  access: "estudiante",
};

async function mockSession(page: Page, roles = fictionalUser.roles) {
  await page.route("**/api/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { ...fictionalUser, roles } }),
  }));
}

async function mockCourses(page: Page, courses: object[]) {
  await page.route("**/api/me/courses", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ courses }),
  }));
}

test("un usuario anónimo recibe una solicitud de ingreso", async ({ page }) => {
  let catalogRequests = 0;
  await page.route("**/api/session", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "Sesión requerida" }),
  }));
  await page.route("**/api/me/courses", (route) => {
    catalogRequests += 1;
    return route.abort();
  });

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "Sesión requerida" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a ingresar" })).toBeVisible();
  expect(catalogRequests).toBe(0);
});

test("muestra la comprobación de sesión antes de resolverla", async ({ page }) => {
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
  await page.route("**/api/session", async (route) => {
    await sessionGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: fictionalUser }),
    });
  });
  await mockCourses(page, []);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "Comprobando sesión" })).toBeVisible();
  releaseSession();
  await expect(page.getByRole("heading", { name: "Todavía no tenés cursos asignados" })).toBeVisible();
});

test("muestra un curso para un estudiante", async ({ page }) => {
  await mockSession(page);
  await mockCourses(page, [programmingCourse]);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "Programación I" })).toBeVisible();
  await expect(page.getByText("Grupo 1 MG")).toBeVisible();
  await expect(page.getByText("Estudiante", { exact: true })).toBeVisible();
});

test("muestra todos los grupos asignados", async ({ page }) => {
  await mockSession(page);
  await mockCourses(page, [
    programmingCourse,
    { ...programmingCourse, groupCode: "2-MB", groupName: "Grupo 2 MB" },
  ]);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByText("Grupo 1 MG")).toBeVisible();
  await expect(page.getByText("Grupo 2 MB")).toBeVisible();
});

test("identifica el acceso docente", async ({ page }) => {
  await mockSession(page, ["docente"]);
  await mockCourses(page, [{ ...programmingCourse, access: "docente" }]);

  await page.goto("/mis-cursos");
  await expect(page.getByText("Docente", { exact: true })).toBeVisible();
});

test("identifica el acceso de practicante", async ({ page }) => {
  await mockSession(page, ["practicante"]);
  await mockCourses(page, [{ ...programmingCourse, access: "practicante" }]);

  await page.goto("/mis-cursos");
  await expect(page.getByText("Practicante", { exact: true })).toBeVisible();
});

test("explica cuando el usuario no tiene cursos", async ({ page }) => {
  await mockSession(page);
  await mockCourses(page, []);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "Todavía no tenés cursos asignados" })).toBeVisible();
  await expect(page.getByText(/inscripciones ni asignaciones activas/)).toBeVisible();
});

test("abre únicamente el contenido registrado para un curso conocido", async ({ page }) => {
  await mockSession(page);
  await mockCourses(page, [programmingCourse]);

  await page.goto("/mis-cursos");
  await page.getByRole("button", { name: "Abrir curso" }).click();
  await expect(page).toHaveURL(/\/curso\/programacion-i\/unidad-0$/);
  await expect(page.getByRole("heading", { name: "Introducción a la programación", exact: true })).toBeVisible();
});

test("no inventa una ruta para un curso desconocido", async ({ page }) => {
  await mockSession(page);
  await mockCourses(page, [{
    ...programmingCourse,
    subjectCode: "programacion-demo",
    subjectName: "Programación (demo)",
  }]);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "Programación (demo)" })).toBeVisible();
  await expect(page.getByText("Contenido todavía no disponible")).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir curso" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ver materiales" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/mis-cursos$/);
});

test("ofrece el índice de materiales y respeta la entrada legacy del curso", async ({ page }) => {
  await mockSession(page);
  await mockCourses(page, [programmingCourse]);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("button", { name: "Abrir curso" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver materiales" })).toBeVisible();

  await page.getByRole("button", { name: "Ver materiales" }).click();
  await expect(page).toHaveURL(/\/curso\/programacion-i$/);
  await expect(page.getByRole("heading", { name: "Materiales del curso", level: 1 })).toBeVisible();

  await page.goto("/mis-cursos");
  await page.getByRole("button", { name: "Abrir curso" }).click();
  await expect(page).toHaveURL(/\/curso\/programacion-i\/unidad-0$/);
  await expect(page.getByRole("heading", { name: "Introducción a la programación", exact: true })).toBeVisible();
});


test("no trata propiedades heredadas como contenido registrado", async ({ page }) => {
  await mockSession(page);
  await mockCourses(page, [{
    ...programmingCourse,
    subjectCode: "constructor",
    subjectName: "Curso ficticio con código reservado",
  }]);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "Curso ficticio con código reservado" })).toBeVisible();
  await expect(page.getByText("Contenido todavía no disponible")).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir curso" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Abrir curso" })).toHaveCount(0);
});

async function verifyLoginRecoversAfterSessionFailure(page: Page, sessionStatus: 401 | 500) {
  let loginCompleted = false;
  await page.route("**/api/session", (route) => route.fulfill({
    status: loginCompleted ? sessionStatus : 401,
    contentType: "application/json",
    body: JSON.stringify({ error: sessionStatus === 401 ? "Sesión requerida" : "Fallo ficticio" }),
  }));
  await page.route("**/api/auth/login", (route) => {
    loginCompleted = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/ingresar");
  const form = page.locator("form");
  await form.getByLabel("Nombre de usuario").fill("persona.prueba");
  await form.getByLabel("Contraseña").fill("frase-ficticia-segura");
  await form.getByRole("button", { name: "Ingresar" }).click();

  await expect(form.getByRole("alert")).toContainText("No pudimos confirmar tu sesión");
  await expect(form.getByRole("button", { name: "Ingresar" })).toBeEnabled();
  await expect(form.getByRole("button", { name: "Verificando…" })).toHaveCount(0);
}

test("el formulario se recupera si el login es correcto pero la sesión responde 401", async ({ page }) => {
  await verifyLoginRecoversAfterSessionFailure(page, 401);
});

test("el formulario se recupera si el login es correcto pero la sesión responde 500", async ({ page }) => {
  await verifyLoginRecoversAfterSessionFailure(page, 500);
});

test("muestra un error del servidor y permite reintentar", async ({ page }) => {
  let serveCourses = false;
  await mockSession(page);
  await page.route("**/api/me/courses", (route) => serveCourses
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [programmingCourse] }) })
    : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fallo ficticio" }) }));

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "No pudimos cargar tus cursos" })).toBeVisible();
  serveCourses = true;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Programación I" })).toBeVisible();
});

test("se recupera de un error de red mediante reintento", async ({ page }) => {
  let networkAvailable = false;
  await mockSession(page);
  await page.route("**/api/me/courses", (route) => networkAvailable
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [programmingCourse] }) })
    : route.abort("failed"));

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "No pudimos cargar tus cursos" })).toBeVisible();
  networkAvailable = true;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Grupo 1 MG")).toBeVisible();
});

test("informa que la sesión venció si el catálogo responde 401", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/me/courses", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "Sesión requerida" }),
  }));

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "Tu sesión venció" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a ingresar" })).toBeVisible();
  await expect(page.getByText("Persona de prueba")).toHaveCount(0);
});

test("permite reintentar una comprobación de sesión fallida", async ({ page }) => {
  let sessionAvailable = false;
  await page.route("**/api/session", (route) => sessionAvailable
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: fictionalUser }) })
    : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fallo ficticio" }) }));
  await mockCourses(page, []);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("heading", { name: "No pudimos comprobar la sesión" })).toBeVisible();
  sessionAvailable = true;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Todavía no tenés cursos asignados" })).toBeVisible();
});

test("el catálogo no tiene desbordamiento horizontal", async ({ page }) => {
  await mockSession(page, ["docente"]);
  await mockCourses(page, [
    { ...programmingCourse, access: "docente" },
    {
      ...programmingCourse,
      subjectCode: "asignatura-ficticia-sin-contenido",
      subjectName: "Asignatura ficticia con un nombre deliberadamente extenso",
      groupCode: "GRUPO-FICTICIO-EXTENSO-2026",
      groupName: "Grupo ficticio de comprobación adaptable",
      access: "practicante",
    },
  ]);

  await page.goto("/mis-cursos");
  await expect(page.getByRole("article")).toHaveCount(2);
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
});
