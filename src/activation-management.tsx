import { useEffect, useMemo, useState } from "react";
import type { ActivationCredential } from "./activation-delivery";
import { ActivationDeliveryPanel } from "./activation-delivery-panel";

type Candidate = {
  userId: number;
  username: string;
  displayName: string;
  groupId: number;
  groupCode: string;
  groupName: string;
  activationExpiresAt: string | null;
};

type ReissueResult = {
  group: { id: number; code: string; name: string };
  credential: ActivationCredential;
  expiresInDays: number;
  activationCodeIsShownOnce: true;
};

const reasonLabels = {
  no_recibido: "No recibió el código anterior",
  perdido: "Perdió el código",
  vencido: "El código venció",
} as const;

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error("error" in (data as object) && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "No fue posible completar la operación.");
  return data as T;
}

function expirationLabel(value: string | null) {
  if (!value) return "Sin código vigente";
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "Código vigente" : `Código vigente hasta ${new Intl.DateTimeFormat("es-UY", { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

export function ActivationManagement({ onBack }: { onBack: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | "">("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [reason, setReason] = useState<keyof typeof reasonLabels>("no_recibido");
  const [confirmed, setConfirmed] = useState(false);
  const [generated, setGenerated] = useState<ReissueResult | null>(null);
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState<"loading" | "idle" | "submitting">("loading");
  const [error, setError] = useState<string | null>(null);

  async function loadCandidates() {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/account-activations/candidates", { headers: { Accept: "application/json" } });
      const data = await responseJson<{ candidates: Candidate[] }>(response);
      setCandidates(data.candidates);
      setSelectedGroupId((current) => current || data.candidates[0]?.groupId || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar las cuentas.");
    } finally {
      setStatus("idle");
    }
  }

  useEffect(() => { void loadCandidates(); }, []);

  const groups = useMemo(() => Array.from(new Map(candidates.map((candidate) => [candidate.groupId, { id: candidate.groupId, code: candidate.groupCode, name: candidate.groupName }])).values()), [candidates]);
  const visibleCandidates = candidates.filter((candidate) => candidate.groupId === selectedGroupId);
  const selected = candidates.find((candidate) => candidate.groupId === selectedGroupId && candidate.userId === selectedUserId) ?? null;

  async function reissue() {
    if (!selected || !confirmed) return;
    setStatus("submitting");
    setError(null);
    try {
      const response = await fetch("/api/account-activations/reissue", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ userId: selected.userId, groupId: selected.groupId, reason }),
      });
      setGenerated(await responseJson<ReissueResult>(response));
      setConfirmed(false);
      setFinished(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible reemitir la activación.");
    } finally {
      setStatus("idle");
    }
  }

  function finishDelivery() {
    setGenerated(null);
    setSelectedUserId(null);
    setFinished(true);
    void loadCandidates();
  }

  return <section className="teacher-view activation-management">
    <button className="back-link" onClick={onBack}>← Panel docente</button>
    <p className="eyebrow">Administración · Activaciones</p>
    <h1>Reemitir un acceso</h1>
    <p className="import-lead">Sólo aparecen estudiantes de grupos autorizados que todavía no establecieron una contraseña. Reemitir revoca cualquier código anterior.</p>

    {!generated && <section className="import-panel">
      <div className="import-panel-heading"><div><p className="eyebrow">Selección</p><h2>Cuenta sin activar</h2></div>{status === "loading" && <span className="status-pill">Cargando…</span>}</div>
      {groups.length > 0 ? <>
        <label className="activation-field">Grupo<select aria-label="Grupo" value={selectedGroupId} onChange={(event) => { setSelectedGroupId(Number(event.target.value)); setSelectedUserId(null); setConfirmed(false); }}><option value="" disabled>Elegir grupo…</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.code}</option>)}</select></label>
        <div className="activation-candidates">{visibleCandidates.map((candidate) => <label className={`activation-candidate${selectedUserId === candidate.userId ? " is-selected" : ""}`} key={`${candidate.groupId}-${candidate.userId}`}>
          <input type="radio" name="activation-user" checked={selectedUserId === candidate.userId} onChange={() => { setSelectedUserId(candidate.userId); setConfirmed(false); setFinished(false); }} />
          <span><strong>{candidate.displayName}</strong><small>{candidate.username}</small><small>{expirationLabel(candidate.activationExpiresAt)}</small></span>
        </label>)}</div>
        {visibleCandidates.length === 0 && <p className="privacy-note">No hay cuentas sin activar en este grupo.</p>}
      </> : status === "idle" && <p className="privacy-note">No hay cuentas sin activar en los grupos asignados.</p>}

      {selected && <div className="reissue-confirmation">
        <label className="activation-field">Motivo<select value={reason} onChange={(event) => { setReason(event.target.value as keyof typeof reasonLabels); setConfirmed(false); }}>{Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="import-alert is-warning"><strong>El código anterior dejará de funcionar.</strong><p>Esta acción no cambia el usuario, la inscripción ni ningún resultado académico.</p></div>
        <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo la identidad de {selected.displayName} y que necesita un código nuevo.</label>
        <button className="button-primary danger-action" disabled={!confirmed || status !== "idle"} onClick={() => void reissue()}>{status === "submitting" ? "Reemitiendo…" : "Revocar y generar código nuevo"}</button>
      </div>}
    </section>}

    {generated && <section className="import-panel import-result">
      <div className="import-panel-heading"><div><p className="eyebrow">Código nuevo</p><h2>Activación reemitida</h2></div><span className="status-pill is-safe">Válida por {generated.expiresInDays} días</span></div>
      <p>El acceso corresponde a <strong>{generated.group.name}</strong>. El código anterior quedó revocado.</p>
      <ActivationDeliveryPanel credentials={[generated.credential]} onFinished={finishDelivery} />
    </section>}

    {finished && <section className="import-panel delivery-complete" role="status"><p className="eyebrow">Entrega finalizada</p><h2>Código retirado de la pantalla</h2><p>La reemisión quedó auditada sin conservar el código en claro.</p></section>}
    {error && <div className="import-alert is-error" role="alert"><strong>No fue posible continuar.</strong><p>{error}</p></div>}
  </section>;
}
