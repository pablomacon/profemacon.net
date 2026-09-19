import { createHash, randomInt, randomUUID } from "node:crypto";

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

async function get(path, cookie = "") {
  return fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) } });
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
    document: String(randomInt(10_000_000, 100_000_000)),
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

const importedCredential = applied.activationCredentials?.[0];
if (!importedCredential) throw new Error("La importación ficticia no devolvió una activación para verificar la reemisión.");
const candidatesResponse = await get("/api/account-activations/candidates", cookie);
if (!candidatesResponse.ok) throw new Error(`La consulta de activaciones falló con HTTP ${candidatesResponse.status}.`);
const candidates = await candidatesResponse.json();
const candidate = candidates.candidates?.find((item) => item.username === importedCredential.username && item.groupCode === "DEMO-A");
if (!candidate) throw new Error("La cuenta ficticia sin activar no apareció entre las cuentas autorizadas.");

const firstReissueResponse = await post("/api/account-activations/reissue", { userId: candidate.userId, groupId: candidate.groupId, reason: "no_recibido" }, cookie);
if (firstReissueResponse.status !== 201) throw new Error(`La primera reemisión falló con HTTP ${firstReissueResponse.status}.`);
const firstReissue = await firstReissueResponse.json();
const secondReissueResponse = await post("/api/account-activations/reissue", { userId: candidate.userId, groupId: candidate.groupId, reason: "perdido" }, cookie);
if (secondReissueResponse.status !== 201) throw new Error(`La segunda reemisión falló con HTTP ${secondReissueResponse.status}.`);
const secondReissue = await secondReissueResponse.json();
if (!firstReissue.credential?.activationCode || !secondReissue.credential?.activationCode || firstReissue.credential.activationCode === secondReissue.credential.activationCode) throw new Error("La reemisión no produjo códigos independientes.");

const revokedCodeResponse = await post("/api/auth/activate", { username: candidate.username, activationCode: firstReissue.credential.activationCode, password: "Clave ficticia que no debe establecerse" });
if (revokedCodeResponse.status !== 401) throw new Error("El código revocado todavía permitió activar la cuenta.");

const finalActivationResponse = await post("/api/auth/activate", { username: candidate.username, activationCode: secondReissue.credential.activationCode, password: "Clave ficticia final de integración 2026" });
if (!finalActivationResponse.ok) throw new Error("El código vigente no permitió activar la cuenta ficticia.");
const studentCookie = sessionCookie(finalActivationResponse);
if (!studentCookie) throw new Error("La activación ficticia no devolvió una sesión para cerrarla.");
const reissueActivatedResponse = await post("/api/account-activations/reissue", { userId: candidate.userId, groupId: candidate.groupId, reason: "perdido" }, cookie);
if (reissueActivatedResponse.status !== 403) throw new Error("El backend permitió reemitir una cuenta que ya tiene contraseña.");
const studentLogoutResponse = await post("/api/auth/logout", {}, studentCookie);
if (!studentLogoutResponse.ok) throw new Error("No fue posible cerrar la sesión estudiantil ficticia.");

const logoutResponse = await post("/api/auth/logout", {}, cookie);
if (!logoutResponse.ok) throw new Error("No fue posible cerrar la sesión ficticia de integración.");

console.log(JSON.stringify({
  targetGroup: preview.targetGroup.code,
  preview: preview.summary,
  applied: applied.summary,
  activationCodesReturnedOnce: applied.activationCredentials?.length ?? 0,
  duplicateRejected: true,
  activationReissued: true,
  previousActivationRejected: true,
  activatedAccountReissueRejected: true,
  sessionClosed: true,
  containsPersonalDataInOutput: false,
}, null, 2));
