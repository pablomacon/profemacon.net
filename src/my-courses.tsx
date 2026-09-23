import { useEffect, useState } from "react";
import { getCourseContent, type CourseContentPath } from "./course-registry";

export type CourseAccess = "estudiante" | "docente" | "practicante";

export type CourseSummary = {
  subjectCode: string;
  subjectName: string;
  year: number;
  editionName: string;
  groupCode: string;
  groupName: string;
  access: CourseAccess;
};

export type MyCoursesSession =
  | { status: "checking" }
  | { status: "authenticated" }
  | { status: "anonymous"; reason: "missing" | "expired" }
  | { status: "error"; message: string };

type CatalogState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; courses: CourseSummary[] }
  | { status: "error"; message: string };

type MyCoursesProps = {
  session: MyCoursesSession;
  onLogin: () => void;
  onOpenCourse: (path: CourseContentPath) => void;
  onRetrySession: () => void;
  onSessionExpired: () => void;
};

const accessLabels: Record<CourseAccess, string> = {
  estudiante: "Estudiante",
  docente: "Docente",
  practicante: "Practicante",
};

function StatusCard({ title, detail, action }: { title: string; detail: string; action?: { label: string; onClick: () => void } }) {
  return <div className="course-status" role="status">
    <div className="placeholder-mark" aria-hidden="true">PM</div>
    <div>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action && <button className="button-primary" onClick={action.onClick}>{action.label}</button>}
    </div>
  </div>;
}

export function MyCourses({ session, onLogin, onOpenCourse, onRetrySession, onSessionExpired }: MyCoursesProps) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "idle" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (session.status !== "authenticated") {
      setCatalog({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setCatalog({ status: "loading" });
    void fetch("/api/me/courses", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      if (!response.ok) throw new Error("No pudimos cargar tus cursos.");
      const data = await response.json() as { courses: CourseSummary[] };
      setCatalog({ status: "loaded", courses: data.courses });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setCatalog({
        status: "error",
        message: error instanceof Error ? error.message : "No pudimos cargar tus cursos.",
      });
    });

    return () => controller.abort();
  }, [session.status, requestVersion, onSessionExpired]);

  const retryCatalog = () => {
    setCatalog({ status: "loading" });
    setRequestVersion((current) => current + 1);
  };

  return <section className="courses-view">
    <p className="eyebrow">Catálogo personal</p>
    <h1>Mis cursos</h1>

    {session.status === "checking" && <StatusCard title="Comprobando sesión" detail="Estamos verificando tu acceso a la plataforma." />}

    {session.status === "error" && <StatusCard
      title="No pudimos comprobar la sesión"
      detail={session.message}
      action={{ label: "Reintentar", onClick: onRetrySession }}
    />}

    {session.status === "anonymous" && <StatusCard
      title={session.reason === "expired" ? "Tu sesión venció" : "Sesión requerida"}
      detail={session.reason === "expired" ? "Por seguridad, ingresá nuevamente para consultar tus cursos." : "Ingresá con tu cuenta para consultar los cursos y grupos que tenés asignados."}
      action={{ label: "Volver a ingresar", onClick: onLogin }}
    />}

    {session.status === "authenticated" && (catalog.status === "idle" || catalog.status === "loading") && <StatusCard title="Cargando tus cursos" detail="Estamos consultando tus inscripciones y asignaciones activas." />}

    {session.status === "authenticated" && catalog.status === "error" && <StatusCard
      title="No pudimos cargar tus cursos"
      detail={catalog.message}
      action={{ label: "Reintentar", onClick: retryCatalog }}
    />}

    {session.status === "authenticated" && catalog.status === "loaded" && catalog.courses.length === 0 && <StatusCard
      title="Todavía no tenés cursos asignados"
      detail="No encontramos inscripciones ni asignaciones activas para tu cuenta. Si esto no coincide con tu situación, consultá al docente responsable."
    />}

    {session.status === "authenticated" && catalog.status === "loaded" && catalog.courses.length > 0 && <div className="course-list" aria-label="Cursos y grupos asignados">
      {catalog.courses.map((course) => {
        const content = getCourseContent(course.subjectCode);
        const key = [course.subjectCode, course.year, course.groupCode, course.access].join(":");
        const materialsPath = content?.materialEntryPath ?? null;
        return <article className="course-card" key={key}>
          <div className="course-card-main">
            <div className="course-card-labels">
              <span>{course.editionName}</span>
              <span className={`course-access course-access-${course.access}`}>{accessLabels[course.access]}</span>
            </div>
            <h2>{course.subjectName}</h2>
            <dl className="course-details">
              <div><dt>Grupo</dt><dd>{course.groupName}</dd></div>
              <div><dt>Código</dt><dd>{course.groupCode}</dd></div>
              <div><dt>Año</dt><dd>{course.year}</dd></div>
            </dl>
            {!content && <p className="course-unavailable">Contenido todavía no disponible</p>}
          </div>
          {content && <div className="course-card-actions">
            <button className="button-primary" onClick={() => onOpenCourse(content.entryPath)}>{content.actionLabel}</button>
            {materialsPath !== null && <button className="button-secondary" onClick={() => onOpenCourse(materialsPath)}>Ver materiales</button>}
          </div>}
        </article>;
      })}
    </div>}
  </section>;
}
