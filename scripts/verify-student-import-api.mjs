import { createHash, randomUUID } from "node:crypto";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173";
const origin = new URL(baseUrl).origin;
const username = "ana.docente";
const password = "Clave docente ficticia 2026";

async function post(path, body, cookie = "") {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response) {
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

let authentication = await post("/api/auth/login", { username, password });
if (!authentication.ok) {
  authentication = await post("/api/auth/activate", {
    username,
    activationCode: "PM-DEMO-DOCENTE-2026",
    password,
  });
}
if (!authentication.ok) throw new Error("No fue posible autenticar la cuenta docente ficticia.");
const cookie = sessionCookie(authentication);
if (!cookie) throw new Error("La autenticación ficticia no devolvió una cookie de sesión.");

const uniqueRun = randomUUID();
const payload = {
  source: {
    filename: "Portafolio_PROGRAMACION_DEMO_Grupo_DEMO__A_2026_2026-09-19.xlsx",
    subjectLabel: "PROGRAMACION DEMO",
    groupSourceLabel: "Grupo_DEMO__A",
    academicYear: 2026,
    fileSha256: createHash("sha256").update(`lote-ficticio-${uniqueRun}`).digest("hex"),
    rejectedRows: 0,
  },
  students: [{
    sourceRow: 2,
    givenNames: "Persona",
    surnames: "Ficticia Integracion",
    document: "99000199",
    documentType: "cedula_uy",
    countryCode: "UY",
  }],
};

const previewResponse = await post("/api/student-imports/preview", payload, cookie);
if (!previewResponse.ok) throw new Error(`La previsualización ficticia falló con HTTP ${previewResponse.status}.`);
const preview = await previewResponse.json();
if (preview.targetGroup?.code !== "DEMO-A" || preview.summary?.validRows !== 1) throw new Error("La previsualización no resolvió el lote ficticio esperado.");

const applyResponse = await post("/api/student-imports/apply", payload, cookie);
if (applyResponse.status !== 201) throw new Error(`La aplicación ficticia falló con HTTP ${applyResponse.status}.`);
const applied = await applyResponse.json();
if (!applied.importId || applied.summary?.validRows !== 1) throw new Error("La aplicación ficticia devolvió un resultado incompleto.");

const duplicateResponse = await post("/api/student-imports/apply", payload, cookie);
if (duplicateResponse.status !== 409) throw new Error("El backend no rechazó la repetición del mismo lote ficticio.");

const logoutResponse = await post("/api/auth/logout", {}, cookie);
if (!logoutResponse.ok) throw new Error("No fue posible cerrar la sesión ficticia de integración.");

console.log(JSON.stringify({
  targetGroup: preview.targetGroup.code,
  preview: preview.summary,
  applied: applied.summary,
  activationCodesReturnedOnce: applied.activationCredentials?.length ?? 0,
  duplicateRejected: true,
  sessionClosed: true,
  containsPersonalDataInOutput: false,
}, null, 2));
