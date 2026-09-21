import { useEffect, useMemo, useState } from "react";
import { QuestionRenderer, type PublicQuestion } from "./student-activity/question-renderer";

type Preview = { activity: { slug: string; title: string; description: string; totalPoints: number }; groupCode: string; questions: PublicQuestion[] };
type Result = { score: number; total: number; percentage: number; judgment: string; questions: Array<PublicQuestion & { studentAnswer: unknown; correct: boolean; pointsAwarded: number; maxPoints: number; correctAnswer: unknown; feedback: string; explanation: string }> };
type Group = { code: string; name: string };
const empty = (question: PublicQuestion) => question.type === "checkbox" ? [] : "";
const answered = (question: PublicQuestion, value: unknown) => question.type === "checkbox" ? Array.isArray(value) && value.length > 0 : typeof value === "string" && value.trim().length > 0;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string; code?: string; groups?: Group[] };
  if (!response.ok) throw Object.assign(new Error(body.error ?? "No fue posible preparar la prueba."), { status: response.status, code: body.code, groups: body.groups });
  return body;
}

export function TeacherActivityPreview({ slug, onBack, onLogin }: { slug: string; onBack: () => void; onLogin: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupCode, setGroupCode] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "grading" | "error">("loading");
  const [message, setMessage] = useState("");
  const load = async (group: string | null) => {
    setState("loading"); setMessage("");
    try {
      const data = await request<Preview>(`/api/teacher/activities/${encodeURIComponent(slug)}/preview${group ? `?groupCode=${encodeURIComponent(group)}` : ""}`);
      setPreview(data); setGroupCode(data.groupCode); setAnswers(Object.fromEntries(data.questions.map((question) => [question.number, empty(question)]))); setGroups([]); setState("ready");
    } catch (error) {
      const failure = error as Error & { status?: number; code?: string; groups?: Group[] };
      if (failure.code === "TEACHER_GROUP_REQUIRED" && failure.groups?.length) { setGroups(failure.groups); setState("ready"); return; }
      setMessage(failure.status === 401 ? "Tu sesión venció. Volvé a ingresar." : failure.message); setState("error");
    }
  };
  useEffect(() => { void load(null); }, []);
  const complete = useMemo(() => !!preview && preview.questions.every((question) => answered(question, answers[question.number])), [preview, answers]);
  const grade = async () => {
    if (!preview || !complete || !groupCode) return;
    setState("grading");
    try { setResult(await request<Result>(`/api/teacher/activities/${encodeURIComponent(slug)}/preview/grade`, { method: "POST", body: JSON.stringify({ groupCode, answers }) })); setState("ready"); }
    catch (error) { setMessage((error as Error).message); setState("error"); }
  };
  if (state === "loading") return <section className="activity-page"><h1>Preparando prueba docente…</h1></section>;
  if (state === "error") return <section className="activity-page"><h1>No pudimos preparar la prueba</h1><p role="alert">{message}</p><button className="button-primary" onClick={() => message.includes("sesión") ? onLogin() : void load(groupCode)}>Reintentar</button></section>;
  if (groups.length) return <section className="activity-page"><p className="eyebrow">Modo prueba docente</p><h1>Elegí un grupo asignado</h1><div className="activity-group-list">{groups.map((group) => <button className="button-secondary" key={group.code} onClick={() => void load(group.code)}>{group.name}</button>)}</div></section>;
  if (!preview) return null;
  if (result) return <section className="activity-page"><p className="eyebrow">Modo prueba docente</p><h1>Resultado de simulación</h1><p className="activity-preview-note">Esta ejecución no genera resultados académicos.</p><div className="activity-result"><p><strong>{result.score}/{result.total}</strong> · {result.percentage}% · {result.judgment}</p></div>{result.questions.map((question) => <article className="activity-question" key={question.number}><h2>Pregunta {question.number}</h2><p>{question.prompt}</p><p><strong>Tu respuesta:</strong> {JSON.stringify(question.studentAnswer)}</p><p><strong>Respuesta correcta:</strong> {JSON.stringify(question.correctAnswer)}</p><p>{question.correct ? "Correcta" : "Incorrecta"} · {question.pointsAwarded}/{question.maxPoints} puntos</p>{question.feedback && <p>{question.feedback}</p>}{question.explanation && <p>{question.explanation}</p>}</article>)}<button className="button-primary" onClick={() => { setResult(null); setAnswers(Object.fromEntries(preview.questions.map((question) => [question.number, empty(question)]))); }}>Probar nuevamente</button></section>;
  return <section className="activity-page"><button className="back-link" onClick={onBack}>← Volver al panel docente</button><p className="eyebrow">Modo prueba docente</p><header className="activity-page-hero"><h1>{preview.activity.title}</h1><p>{preview.activity.description}</p><p className="activity-preview-note">Esta ejecución no genera resultados académicos.</p></header><section className="activity-questions">{preview.questions.map((question) => <QuestionRenderer key={question.number} question={question} value={answers[question.number]} disabled={state === "grading"} status="idle" onChange={(value) => setAnswers((current) => ({ ...current, [question.number]: value }))} onRetry={() => undefined} />)}</section><button className="button-primary" disabled={!complete || state === "grading"} onClick={() => void grade()}>{state === "grading" ? "Corrigiendo…" : "Corregir simulación"}</button></section>;
}
