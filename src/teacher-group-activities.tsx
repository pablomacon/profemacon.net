import { useEffect, useState } from "react";

type Activity = { id: number; slug: string; title: string; unitCode: string | null; editorialState: string; maxAttempts: number; availabilityId: number | null; enabled: number | null; opensAt: string | null; closesAt: string | null; availabilityStatus: "disabled" | "not_open" | "closed" | "available"; participants: number };
type Group = { code: string };
const statusText = { disabled: "No habilitada", not_open: "Todavía no abierta", closed: "Cerrada", available: "Disponible" };
const pad = (value: number) => String(value).padStart(2, "0");
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toUtc = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación.");
  return body;
}

export function TeacherGroupActivities({ groupId, onBack, onPreview }: { groupId: number; onBack: () => void; onPreview: (slug: string, groupCode: string) => void }) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Activity | null>(null);
  const load = async () => {
    setError("");
    try { const result = await api<{ group: Group; activities: Activity[] }>(`/api/teacher/groups/${groupId}/activities`); setGroup(result.group); setItems(result.activities); }
    catch (failure) { setError((failure as Error).message); }
  };
  useEffect(() => { void load(); }, [groupId]);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const enabled = form.get("enabled") === "on";
    if (editing.enabled && !enabled && !window.confirm("Los resultados existentes se conservan. Los estudiantes ya no podrán iniciar o continuar esta actividad. ¿Deshabilitar?")) return;
    try {
      await api(`/api/teacher/groups/${groupId}/activities/${editing.id}/availability`, { method: "PUT", body: JSON.stringify({ enabled, opensAt: toUtc(form.get("opensAt")), closesAt: toUtc(form.get("closesAt")) }) });
      setEditing(null);
      await load();
    } catch (failure) { setError((failure as Error).message); }
  };
  return <section className="teacher-view">
    <button className="back-link" onClick={onBack}>← Volver al grupo</button>
    <p className="eyebrow">Grupo docente</p><h1>Actividades</h1>
    <p className="lead">La habilitación controla la disponibilidad para este grupo; el contenido de la actividad es compartido.</p>
    {error && <p role="alert">{error} <button className="button-secondary" onClick={() => void load()}>Reintentar</button></p>}
    {items === null ? <p>Cargando actividades…</p> : items.length === 0 ? <p>No hay actividades en el contexto académico de este grupo.</p> : <div className="teacher-actions">{items.map((activity) => <article className="module-card" key={activity.id}>
      <div><h2>{activity.title}</h2><p>{activity.unitCode ? `${activity.unitCode} · ` : ""}{activity.editorialState}</p><p><strong>{statusText[activity.availabilityStatus]}</strong></p><p>Apertura: {activity.opensAt ?? "Sin fecha"} · Cierre: {activity.closesAt ?? "Sin fecha"}</p><p>{activity.maxAttempts} intentos (solo lectura) · {activity.participants} estudiantes participantes</p></div>
      <div className="teacher-card-actions"><button className="button-secondary" onClick={() => group && onPreview(activity.slug, group.code)}>Probar actividad</button><button className="button-primary" onClick={() => setEditing(activity)}>Editar configuración</button></div>
    </article>)}</div>}
    {editing && <form className="import-panel" onSubmit={save}><h2>Configurar: {editing.title}</h2><label><input name="enabled" type="checkbox" defaultChecked={Boolean(editing.enabled)} /> Habilitada para este grupo</label><label>Apertura (hora local; se guarda en UTC)<input name="opensAt" type="datetime-local" defaultValue={localInput(editing.opensAt)} /></label><label>Cierre (hora local; se guarda en UTC)<input name="closesAt" type="datetime-local" defaultValue={localInput(editing.closesAt)} /></label><p>Máximo de intentos: {editing.maxAttempts} (solo lectura).</p><div className="teacher-card-actions"><button className="button-primary">Guardar</button><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancelar</button></div></form>}
  </section>;
}
