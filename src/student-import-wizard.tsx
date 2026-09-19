import { useState, type ChangeEvent } from "react";
import type { ActivationCredential } from "./activation-delivery";
import { ActivationDeliveryPanel } from "./activation-delivery-panel";
import type { StudentPortfolio } from "./student-portfolio";

type DocumentType = "cedula_uy" | "pasaporte" | "otro";
type EditableStudent = StudentPortfolio["students"][number] & { documentType: DocumentType | ""; countryCode: string };

type ImportPlan = {
  source: { filename: string; subjectLabel: string; groupSourceLabel: string; academicYear: number; fileSha256: string };
  targetGroup: { id: number; code: string; name: string };
  summary: { readRows: number; validRows: number; rejectedRows: number; newAccounts: number; existingAccounts: number; activationCodes: number };
  students: { sourceRow: number; displayName: string; username: string; action: "create_and_enroll" | "enroll_and_reactivate" | "enroll_existing"; documentEnding: string }[];
};

type AppliedImport = ImportPlan & {
  importId: string;
  activationCredentials: (ActivationCredential & { sourceRow: number })[];
  activationCodesAreShownOnce: true;
};

function initialDocument(student: StudentPortfolio["students"][number]): Pick<EditableStudent, "documentType" | "countryCode"> {
  return student.documentShape === "cedula_uy_probable"
    ? { documentType: "cedula_uy", countryCode: "UY" }
    : { documentType: "", countryCode: "" };
}

function actionLabel(action: ImportPlan["students"][number]["action"]) {
  if (action === "create_and_enroll") return "Crear cuenta e inscribir";
  if (action === "enroll_and_reactivate") return "Inscribir y generar nueva activación";
  return "Inscribir cuenta existente";
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error("error" in (data as object) && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "No fue posible procesar el lote.");
  return data as T;
}

export function StudentImportWizard({ onBack }: { onBack: () => void }) {
  const [portfolio, setPortfolio] = useState<StudentPortfolio | null>(null);
  const [students, setStudents] = useState<EditableStudent[]>([]);
  const [administrativeConfirmation, setAdministrativeConfirmation] = useState(false);
  const [applyConfirmation, setApplyConfirmation] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [applied, setApplied] = useState<AppliedImport | null>(null);
  const [deliveryFinished, setDeliveryFinished] = useState(false);
  const [status, setStatus] = useState<"idle" | "reading" | "previewing" | "applying">("idle");
  const [error, setError] = useState<string | null>(null);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setPlan(null);
    setApplied(null);
    setDeliveryFinished(false);
    setAdministrativeConfirmation(false);
    setApplyConfirmation(false);
    if (!file) {
      setPortfolio(null);
      setStudents([]);
      return;
    }
    setStatus("reading");
    try {
      const { readStudentPortfolioBytes } = await import("./student-portfolio");
      const parsed = await readStudentPortfolioBytes(new Uint8Array(await file.arrayBuffer()), file.name);
      setPortfolio(parsed);
      setStudents(parsed.students.map((student) => ({ ...student, ...initialDocument(student) })));
    } catch (caught) {
      setPortfolio(null);
      setStudents([]);
      setError(caught instanceof Error ? caught.message : "No fue posible leer el portafolio.");
    } finally {
      setStatus("idle");
      event.target.value = "";
    }
  }

  function updateStudent(sourceRow: number, change: Partial<Pick<EditableStudent, "documentType" | "countryCode">>) {
    setStudents((current) => current.map((student) => student.sourceRow === sourceRow ? { ...student, ...change } : student));
    setAdministrativeConfirmation(false);
    setPlan(null);
    setApplyConfirmation(false);
  }

  function payload() {
    if (!portfolio) throw new Error("Primero debe seleccionarse un portafolio.");
    return {
      source: {
        filename: portfolio.source.filename,
        subjectLabel: portfolio.source.subjectLabel,
        groupSourceLabel: portfolio.source.groupSourceLabel,
        academicYear: portfolio.source.academicYear,
        fileSha256: portfolio.fileSha256,
        rejectedRows: portfolio.errors.length,
      },
      students: students.map((student) => ({
        sourceRow: student.sourceRow,
        givenNames: student.givenNames,
        surnames: student.surnames,
        document: student.document,
        documentType: student.documentType,
        countryCode: student.countryCode.trim().toUpperCase(),
      })),
    };
  }

  async function preview() {
    setError(null);
    setStatus("previewing");
    try {
      const response = await fetch("/api/student-imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload()),
      });
      setPlan(await responseJson<ImportPlan>(response));
      setApplyConfirmation(false);
    } catch (caught) {
      setPlan(null);
      setError(caught instanceof Error ? caught.message : "No fue posible previsualizar el lote.");
    } finally {
      setStatus("idle");
    }
  }

  async function applyImport() {
    setError(null);
    setStatus("applying");
    try {
      const response = await fetch("/api/student-imports/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload()),
      });
      setApplied(await responseJson<AppliedImport>(response));
      setDeliveryFinished(false);
      setPlan(null);
      setPortfolio(null);
      setStudents([]);
      setAdministrativeConfirmation(false);
      setApplyConfirmation(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible aplicar el lote.");
    } finally {
      setStatus("idle");
    }
  }

  const incompleteDocuments = students.filter((student) => !student.documentType || !/^[A-Z]{2}$/i.test(student.countryCode));
  const fileProblems = (portfolio?.errors.length ?? 0) + (portfolio?.diagnostics.duplicateDocuments ?? 0);
  const canPreview = Boolean(portfolio && students.length > 0 && incompleteDocuments.length === 0 && fileProblems === 0 && administrativeConfirmation);

  return (
    <section className="import-view">
      <button className="back-link" onClick={onBack}>← Panel docente</button>
      <p className="eyebrow">Administración · Estudiantes</p>
      <h1>Importar un portafolio</h1>
      <p className="import-lead">El archivo se analiza en este navegador. Sólo se envían al Worker los nombres, documentos y metadatos estrictamente necesarios al solicitar la previsualización.</p>

      <ol className="import-steps" aria-label="Etapas de la importación">
        <li className={portfolio ? "is-complete" : "is-active"}><span>1</span> Archivo</li>
        <li className={plan || applied ? "is-complete" : portfolio ? "is-active" : ""}><span>2</span> Confirmación</li>
        <li className={plan ? "is-active" : applied ? "is-complete" : ""}><span>3</span> Previsualización</li>
        <li className={applied ? "is-complete" : ""}><span>4</span> Resultado</li>
      </ol>

      <section className="import-panel">
        <div className="import-panel-heading">
          <div><p className="eyebrow">Paso 1</p><h2>Seleccionar el archivo XLSX</h2></div>
          {status === "reading" && <span className="status-pill">Leyendo…</span>}
        </div>
        <label className="file-picker">
          <span>Elegir portafolio</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event)} disabled={status !== "idle"} />
        </label>
        <p className="privacy-note">No se importan número de lista, fecha de nacimiento ni vencimiento del carné de salud.</p>
        {portfolio && <dl className="import-summary source-summary">
          <div><dt>Archivo</dt><dd>{portfolio.source.filename}</dd></div>
          <div><dt>Origen</dt><dd>{portfolio.source.subjectLabel} · {portfolio.source.groupDisplayLabel}</dd></div>
          <div><dt>Año</dt><dd>{portfolio.source.academicYear}</dd></div>
          <div><dt>Estudiantes</dt><dd>{portfolio.students.length}</dd></div>
          <div><dt>Filas inválidas</dt><dd>{portfolio.errors.length}</dd></div>
          <div><dt>Documentos repetidos</dt><dd>{portfolio.diagnostics.duplicateDocuments}</dd></div>
        </dl>}
      </section>

      {portfolio && <section className="import-panel">
        <div className="import-panel-heading"><div><p className="eyebrow">Paso 2</p><h2>Confirmar documentos</h2></div><span className="status-pill">{students.length} filas</span></div>
        <p className="panel-help">Las sugerencias de cédula uruguaya deben ser revisadas. Los pasaportes y otros documentos requieren indicar su país emisor.</p>
        {portfolio.errors.length > 0 && <div className="import-alert is-error"><strong>Hay filas inválidas.</strong><ul>{portfolio.errors.map((item) => <li key={item.row}>Fila {item.row}: {item.reason}</li>)}</ul></div>}
        <div className="import-table-wrap">
          <table className="import-table">
            <thead><tr><th>Fila</th><th>Estudiante</th><th>Documento</th><th>Tipo confirmado</th><th>País</th></tr></thead>
            <tbody>{students.map((student) => <tr key={student.sourceRow}>
              <td>{student.sourceRow}</td>
              <td>{student.displayName}</td>
              <td>Termina en {student.document.slice(-4)}</td>
              <td><select value={student.documentType} onChange={(event) => updateStudent(student.sourceRow, { documentType: event.target.value as DocumentType | "", countryCode: event.target.value === "cedula_uy" ? "UY" : student.countryCode })}>
                <option value="">Revisar…</option><option value="cedula_uy">Cédula uruguaya</option><option value="pasaporte">Pasaporte</option><option value="otro">Otro</option>
              </select></td>
              <td><input aria-label={`País emisor, fila ${student.sourceRow}`} value={student.countryCode} maxLength={2} onChange={(event) => updateStudent(student.sourceRow, { countryCode: event.target.value.toUpperCase() })} disabled={student.documentType === "cedula_uy"} placeholder="UY" /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <label className="confirmation-check"><input type="checkbox" checked={administrativeConfirmation} onChange={(event) => { setAdministrativeConfirmation(event.target.checked); setPlan(null); setApplyConfirmation(false); }} /> Confirmo que revisé el tipo y país de los documentos. El grupo de destino será resuelto y autorizado por el servidor.</label>
        {incompleteDocuments.length > 0 && <p className="inline-guidance">Falta completar la identificación administrativa de {incompleteDocuments.length} fila(s).</p>}
        <button className="button-primary" disabled={!canPreview || status !== "idle"} onClick={() => void preview()}>{status === "previewing" ? "Validando…" : "Previsualizar sin aplicar"}</button>
      </section>}

      {plan && <section className="import-panel import-preview">
        <div className="import-panel-heading"><div><p className="eyebrow">Paso 3</p><h2>Revisar antes de aplicar</h2></div><span className="status-pill is-safe">Sin cambios todavía</span></div>
        <div className="target-group"><span>Grupo autorizado</span><strong>{plan.targetGroup.name}</strong><small>{plan.targetGroup.code}</small></div>
        <dl className="import-summary">
          <div><dt>Cuentas nuevas</dt><dd>{plan.summary.newAccounts}</dd></div><div><dt>Cuentas existentes</dt><dd>{plan.summary.existingAccounts}</dd></div><div><dt>Activaciones</dt><dd>{plan.summary.activationCodes}</dd></div><div><dt>Inscripciones</dt><dd>{plan.summary.validRows}</dd></div>
        </dl>
        <div className="import-table-wrap"><table className="import-table"><thead><tr><th>Fila</th><th>Estudiante</th><th>Usuario</th><th>Acción</th></tr></thead><tbody>{plan.students.map((student) => <tr key={student.sourceRow}><td>{student.sourceRow}</td><td>{student.displayName}</td><td>{student.username}</td><td>{actionLabel(student.action)}</td></tr>)}</tbody></table></div>
        <div className="import-alert"><strong>Esta acción modificará D1.</strong><p>Se crearán o vincularán las cuentas indicadas y quedarán inscriptas en el grupo mostrado.</p></div>
        <label className="confirmation-check"><input type="checkbox" checked={applyConfirmation} onChange={(event) => setApplyConfirmation(event.target.checked)} /> Confirmo que revisé el grupo y las acciones del lote.</label>
        <button className="button-primary danger-action" disabled={!applyConfirmation || status !== "idle"} onClick={() => void applyImport()}>{status === "applying" ? "Aplicando…" : "Aplicar importación"}</button>
      </section>}

      {applied && <section className="import-panel import-result">
        <div className="import-panel-heading"><div><p className="eyebrow">Paso 4</p><h2>Importación aplicada</h2></div><span className="status-pill is-safe">Completada</span></div>
        <p>Se procesaron {applied.summary.validRows} inscripciones en <strong>{applied.targetGroup.name}</strong>.</p>
        {applied.activationCredentials.length > 0 ? <ActivationDeliveryPanel credentials={applied.activationCredentials} onFinished={() => { setApplied(null); setDeliveryFinished(true); }} /> : <p className="privacy-note">No fue necesario generar nuevos códigos de activación.</p>}
      </section>}

      {deliveryFinished && <section className="import-panel delivery-complete" role="status"><p className="eyebrow">Entrega finalizada</p><h2>Códigos retirados de la pantalla</h2><p>Los accesos se marcaron como entregados y sus códigos en claro ya no permanecen en esta vista.</p></section>}

      {error && <div className="import-alert is-error" role="alert"><strong>No fue posible continuar.</strong><p>{error}</p></div>}
    </section>
  );
}
