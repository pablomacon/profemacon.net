import { useEffect, useMemo, useRef, useState } from "react";
import { QuestionRenderer, type PublicQuestion } from "./question-renderer";

type Activity = { slug: string; title: string; description: string; totalPoints: number; maxAttempts: number; approvalThreshold: number; achievementThreshold: number; reviewEnabled: boolean };
type Access = { status: "available" | "not_open" | "closed" | "disabled" | "no_attempts"; groupCode: string; groupName: string; availableFrom: string | null; availableUntil: string | null };
type Draft = { attemptId: number; ordinal: number | null; startedAt: string } | null;
type Catalog = { activity: Activity; access: Access; attempts: { used: number; remaining: number; reviewAvailable: boolean; best: ResultAttempt | null; draft: Draft }; questions: PublicQuestion[] };
type ResultAttempt = { id?: number; number: number; ordinal: number | null; score: number; total: number; percentage: number; judgment?: string; submittedAt: string };
type DraftResponse = { activity: Pick<Activity, "slug" | "title" | "description" | "totalPoints">; access: Pick<Access, "groupCode" | "groupName">; attempt: { id: number; status: "en_progreso"; number: number; ordinal: number | null; startedAt: string }; questions: PublicQuestion[] };
type SubmitResult = { attempt: ResultAttempt & { id: number; state: "enviado"; judgment: string }; attempts: { used: number; remaining: number; best: ResultAttempt | null }; answers: Array<{ number: number; correct: boolean; score: number }>; reviewAvailable: boolean };
type Review = { bestAttemptId: number; attempts: Array<ResultAttempt & { id: number; questions: Array<PublicQuestion & { studentAnswer: unknown; correct: boolean; pointsAwarded: number; maxPoints: number; correctAnswer: unknown; explanation: string | null }> }> };
type SaveState = "idle" | "saving" | "saved" | "error";

const emptyAnswer = (question: PublicQuestion) => question.type === "checkbox" ? [] : "";
const isAnswered = (question: PublicQuestion, value: unknown) => question.type === "checkbox" ? Array.isArray(value) && value.length > 0 : typeof value === "string" && value.trim().length > 0;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const body = await response.json().catch(() => ({})) as { code?: string; error?: string } & T;
  if (!response.ok) throw Object.assign(new Error(body.error || "No fue posible completar la solicitud."), { status: response.status, code: body.code, groups: (body as { groups?: Array<{ code: string; name: string }> }).groups });
  return body;
}

export function StudentActivityPage({ slug, onBack, onLogin }: { slug: string; onBack: () => void; onLogin: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [groups, setGroups] = useState<Array<{ code: string; name: string }>>([]);
  const [groupCode, setGroupCode] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready" | "draft" | "submitting" | "result" | "review">("loading");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [saveStates, setSaveStates] = useState<Record<number, SaveState>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewAttempt, setReviewAttempt] = useState<number | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const timers = useRef<Record<number, number>>({});

  const load = async (requestedGroup = groupCode) => {
    setPhase("loading"); setMessage(""); setSessionExpired(false);
    try {
      const data = await request<Catalog>(`/api/me/activities/${encodeURIComponent(slug)}${requestedGroup ? `?groupCode=${encodeURIComponent(requestedGroup)}` : ""}`);
      setCatalog(data); setGroupCode(data.access.groupCode); setGroups([]); setPhase("ready");
    } catch (error) {
      const failure = error as Error & { status?: number; code?: string; groups?: Array<{ code: string; name: string }> };
      if (failure.code === "GROUP_REQUIRED" && failure.groups) { setGroups(failure.groups); setPhase("ready"); return; }
      setSessionExpired(failure.status === 401); setMessage(failure.status === 401 ? "Tu sesión venció. Volvé a ingresar." : failure.message); setPhase("error");
    }
  };
  useEffect(() => { void load(null); return () => Object.values(timers.current).forEach(window.clearTimeout); }, []);

  const openDraft = async (attemptId: number) => {
    setPhase("loading"); setMessage("");
    try {
      const data = await request<DraftResponse>(`/api/me/activities/${encodeURIComponent(slug)}/attempts/${attemptId}${groupCode ? `?groupCode=${encodeURIComponent(groupCode)}` : ""}`);
      setDraft(data); setAnswers(Object.fromEntries(data.questions.map((question) => [question.number, question.answer ?? emptyAnswer(question)]))); setSaveStates({}); setPhase("draft");
    } catch (error) { const failure = error as Error & { status?: number }; setSessionExpired(failure.status === 401); setMessage(failure.status === 401 ? "Tu sesión venció. Volvé a ingresar." : failure.message); setPhase("error"); }
  };
  const start = async () => {
    setPhase("loading");
    try {
      const created = await request<{ attempt: { id: number } }>(`/api/me/activities/${encodeURIComponent(slug)}/attempts`, { method: "POST", body: JSON.stringify({ submissionId: crypto.randomUUID(), ...(groupCode ? { groupCode } : {}) }) });
      await openDraft(created.attempt.id);
    } catch (error) { const failure = error as Error & { status?: number }; setSessionExpired(failure.status === 401); setMessage(failure.status === 401 ? "Tu sesión venció. Volvé a ingresar." : failure.message); setPhase("error"); }
  };
  const save = async (question: PublicQuestion, value: unknown) => {
    if (!draft) return;
    setSaveStates((current) => ({ ...current, [question.number]: "saving" }));
    try {
      await request(`/api/me/activities/${encodeURIComponent(slug)}/attempts/${draft.attempt.id}/responses/${question.number}`, { method: "PUT", body: JSON.stringify({ answer: value, ...(groupCode ? { groupCode } : {}) }) });
      setSaveStates((current) => ({ ...current, [question.number]: "saved" }));
    } catch { setSaveStates((current) => ({ ...current, [question.number]: "error" })); }
  };
  const changeAnswer = (question: PublicQuestion, value: unknown) => {
    setAnswers((current) => ({ ...current, [question.number]: value }));
    if (question.type === "text") { window.clearTimeout(timers.current[question.number]); timers.current[question.number] = window.setTimeout(() => void save(question, value), 500); }
    else void save(question, value);
  };
  const canSubmit = !!draft && draft.questions.every((question) => isAnswered(question, answers[question.number]) && saveStates[question.number] !== "saving" && saveStates[question.number] !== "error") && Object.values(saveStates).every((state) => state !== "saving" && state !== "error");
  const submit = async () => {
    if (!draft || !canSubmit || !window.confirm(`Estás por entregar el intento ${draft.attempt.ordinal ?? draft.attempt.number}. Después no podrás cambiar tus respuestas.`)) return;
    setPhase("submitting");
    try { const data = await request<SubmitResult>(`/api/me/activities/${encodeURIComponent(slug)}/attempts/${draft.attempt.id}/submit${groupCode ? `?groupCode=${encodeURIComponent(groupCode)}` : ""}`, { method: "POST" }); setResult(data); setDraft(null); setPhase("result"); }
    catch (error) { setMessage((error as Error).message); setPhase("draft"); }
  };
  const loadReview = async () => { try { const data = await request<Review>(`/api/me/activities/${encodeURIComponent(slug)}/review${groupCode ? `?groupCode=${encodeURIComponent(groupCode)}` : ""}`); setReview(data); setReviewAttempt(data.bestAttemptId); setPhase("review"); } catch (error) { setMessage((error as Error).message); } };
  const currentReview = review?.attempts.find((attempt) => attempt.id === reviewAttempt) ?? null;
  const progress = useMemo(() => draft ? `${draft.questions.filter((question) => isAnswered(question, answers[question.number])).length}/${draft.questions.length}` : "", [draft, answers]);

  if (phase === "loading") return <section className="activity-page"><p className="eyebrow">Actividad</p><h1>Cargando actividad…</h1></section>;
  if (phase === "error") return <section className="activity-page"><button className="back-link" onClick={onBack}>← Volver</button><h1>No pudimos cargar la actividad</h1><p role="alert">{message}</p><button className="button-primary" onClick={() => sessionExpired ? onLogin() : void load(groupCode)}>{sessionExpired ? "Volver a ingresar" : "Reintentar"}</button></section>;
  if (groups.length) return <section className="activity-page"><h1>Elegí un grupo</h1><p>Seleccioná el grupo autorizado con el que vas a resolver la actividad.</p><div className="activity-group-list">{groups.map((group) => <button className="button-secondary" key={group.code} onClick={() => void load(group.code)}>{group.name}</button>)}</div></section>;
  if (!catalog) return null;
  if (phase === "submitting") return <section className="activity-page" aria-busy="true"><h1>Entregando intento…</h1><p>Estamos guardando tu entrega de forma segura.</p></section>;
  if (phase === "review" && review && currentReview) return <section className="activity-page"><button className="back-link" onClick={() => setPhase("result")}>← Volver al resultado</button><h1>Revisión de la actividad</h1><div className="activity-review-tabs" role="tablist">{review.attempts.map((attempt) => <button key={attempt.id} role="tab" aria-selected={attempt.id === currentReview.id} onClick={() => setReviewAttempt(attempt.id)}>Intento {attempt.ordinal}{attempt.id === review.bestAttemptId ? " · Mejor" : ""}</button>)}</div>{currentReview.questions.map((question) => <article className="activity-question" key={question.number}><h2>Pregunta {question.number}</h2><p>{question.prompt}</p><p><strong>Tu respuesta:</strong> {JSON.stringify(question.studentAnswer)}</p><p><strong>Respuesta correcta:</strong> {JSON.stringify(question.correctAnswer)}</p><p>{question.correct ? "Correcta" : "Incorrecta"} · {question.pointsAwarded}/{question.maxPoints} puntos</p>{question.explanation && <p>{question.explanation}</p>}</article>)}</section>;
  if (phase === "result" && result) return <section className="activity-page"><h1>Intento entregado</h1><div className="activity-result"><p><strong>{result.attempt.score}/{result.attempt.total}</strong> · {result.attempt.percentage}% · {result.attempt.judgment}</p><p>Intentos restantes: {result.attempts.remaining}</p>{result.answers.map((answer) => <p key={answer.number}>Pregunta {answer.number}: {answer.correct ? "Correcta" : "Incorrecta"} · {answer.score} puntos</p>)}</div>{result.attempts.remaining > 0 && <button className="button-primary" onClick={start}>Realizar otro intento</button>}{result.reviewAvailable && <button className="button-secondary" onClick={() => void loadReview()}>Revisar actividad</button>}</section>;
  if (phase === "draft" && draft) return <section className="activity-page"><button className="back-link" onClick={onBack}>← Volver a la unidad</button><header className="activity-page-hero"><p className="eyebrow">{catalog.activity.title} · {draft.access.groupName}</p><h1>{draft.activity.title}</h1><p>Intento {draft.attempt.ordinal ?? draft.attempt.number} · {progress} respondidas</p></header><section className="activity-questions">{draft.questions.map((question) => <QuestionRenderer key={question.number} question={question} value={answers[question.number]} disabled={false} status={saveStates[question.number] ?? "idle"} onChange={(value) => changeAnswer(question, value)} onRetry={() => void save(question, answers[question.number])} />)}</section>{message && <p role="alert" className="form-error">{message}</p>}<button className="button-primary" disabled={!canSubmit} onClick={() => void submit()}>Entregar intento</button></section>;
  return <section className="activity-page"><button className="back-link" onClick={onBack}>← Volver a la unidad</button><header className="activity-page-hero"><p className="eyebrow">{catalog.access.groupName}</p><h1>{catalog.activity.title}</h1><p>{catalog.activity.description}</p></header><section className="activity-access-panel"><h2>{catalog.access.status === "available" ? "Actividad disponible" : "Actividad no disponible"}</h2><p>Intentos usados: {catalog.attempts.used} · Restantes: {catalog.attempts.remaining}</p>{catalog.access.status === "available" && (catalog.attempts.draft ? <button className="button-primary" onClick={() => void openDraft(catalog.attempts.draft!.attemptId)}>Continuar intento</button> : catalog.attempts.remaining > 0 && <button className="button-primary" onClick={() => void start()}>Comenzar intento</button>)}{catalog.access.status !== "available" && <p>{catalog.access.status === "not_open" ? "La actividad todavía no está abierta." : catalog.access.status === "closed" ? "La actividad ya cerró." : catalog.access.status === "no_attempts" ? "No quedan intentos disponibles." : "La actividad no está habilitada."}</p>}{catalog.attempts.best && <p>Mejor resultado: {catalog.attempts.best.percentage}%</p>}{catalog.attempts.reviewAvailable && <button className="button-secondary" onClick={() => void loadReview()}>Revisar actividad</button>}</section></section>;
}
