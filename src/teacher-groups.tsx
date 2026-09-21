import { useEffect, useState } from "react";

type Group = { id: number; code: string; name: string; subjectName: string; editionName: string; year: number; activeStudents: number };
async function get<T>(url: string) { const response = await fetch(url); const body = await response.json().catch(() => ({})) as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? "No fue posible consultar el grupo."); return body; }

export function TeacherGroupsPage({ open }: { open: (id: number) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null); const [error, setError] = useState("");
  useEffect(() => { void get<{ groups: Group[] }>("/api/teacher/groups").then((result) => setGroups(result.groups)).catch((failure) => setError(failure.message)); }, []);
  return <section className="teacher-view"><p className="eyebrow">Docencia</p><h1>Mis grupos</h1>{error ? <p role="alert">{error}</p> : !groups ? <p>Cargando grupos…</p> : groups.length === 0 ? <p>No tenés grupos docentes activos asignados.</p> : <div className="teacher-actions">{groups.map((group) => <article className="module-card" key={group.id}><div><h2>{group.name} · {group.code}</h2><p>{group.subjectName} · {group.editionName} ({group.year})</p><p>{group.activeStudents} estudiantes activos</p></div><button onClick={() => open(group.id)} aria-label={`Abrir grupo ${group.name}`}>→</button></article>)}</div>}</section>;
}

export function TeacherGroupPage({ id, onBack, onActivities }: { id: number; onBack: () => void; onActivities: () => void }) {
  const [group, setGroup] = useState<Group | null>(null); const [error, setError] = useState("");
  useEffect(() => { void get<{ group: Group }>(`/api/teacher/groups/${id}`).then((result) => setGroup(result.group)).catch((failure) => setError(failure.message)); }, [id]);
  return <section className="teacher-view"><button className="back-link" onClick={onBack}>← Mis grupos</button>{error ? <><h1>No pudimos abrir el grupo</h1><p role="alert">{error}</p></> : !group ? <p>Cargando grupo…</p> : <><p className="eyebrow">Grupo docente</p><h1>{group.name} · {group.code}</h1><p className="lead">{group.subjectName} · {group.editionName} ({group.year})</p><p>{group.activeStudents} estudiantes activos.</p><button className="button-primary" onClick={onActivities}>Actividades</button></>}</section>;
}
