import { listUserRoles } from "./auth";
import { gradeActivity, publicCorrectAnswerForReview, type ActivityQuestionForGrading } from "./activity-grading";

type PreviewActivity = {
  id: number;
  slug: string;
  title: string;
  description: string;
  totalPoints: number;
  approvalThreshold: number;
  achievementThreshold: number;
};

type PreviewQuestion = ActivityQuestionForGrading & {
  prompt: string;
  instructions: string;
  optionsJson: string;
  resourcesJson: string;
  placeholder: string | null;
};

export class TeacherPreviewError extends Error {
  constructor(public readonly status: 400 | 403 | 404, public readonly code: "TEACHER_ROLE_REQUIRED" | "TEACHER_GROUP_REQUIRED" | "ACTIVITY_NOT_FOUND" | "INVALID_ANSWERS", message: string, public readonly groups?: Array<{ code: string; name: string }>) { super(message); }
}

const jsonArray = (value: string): unknown[] => {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

async function authorizePreview(db: D1Database, userId: number, slug: string, groupCode: string | null) {
  if (!(await listUserRoles(db, userId)).includes("docente")) throw new TeacherPreviewError(403, "TEACHER_ROLE_REQUIRED", "Se requiere una asignación docente activa.");
  const activity = await db.prepare(`
    SELECT id, slug, titulo AS title, descripcion AS description, puntaje_total AS totalPoints,
      umbral_aprobacion AS approvalThreshold, umbral_destacado AS achievementThreshold
    FROM actividades WHERE slug = ?1
  `).bind(slug).first<PreviewActivity>();
  if (!activity) throw new TeacherPreviewError(404, "ACTIVITY_NOT_FOUND", "La actividad no fue encontrada.");
  if (!groupCode) {
    const groups = await db.prepare(`
      SELECT g.codigo AS code, g.nombre AS name FROM asignaciones_grupo ag
      JOIN grupos g ON g.id = ag.grupo_id
      JOIN actividades a ON a.edicion_anual_id = g.edicion_anual_id
      WHERE ag.usuario_id = ?1 AND ag.tipo = 'docente' AND ag.estado = 'activa' AND a.id = ?2
      ORDER BY g.codigo
    `).bind(userId, activity.id).all<{ code: string; name: string }>();
    throw new TeacherPreviewError(400, "TEACHER_GROUP_REQUIRED", "Elegí un grupo asignado para probar la actividad.", groups.results);
  }
  const assigned = await db.prepare(`
    SELECT 1 FROM asignaciones_grupo ag JOIN grupos g ON g.id = ag.grupo_id
    WHERE ag.usuario_id = ?1 AND ag.tipo = 'docente' AND ag.estado = 'activa' AND g.codigo = ?2
    LIMIT 1
  `).bind(userId, groupCode).first();
  if (!assigned) throw new TeacherPreviewError(403, "TEACHER_GROUP_REQUIRED", "No tenés una asignación docente activa para ese grupo.");
  return activity;
}

async function questionsForPreview(db: D1Database, activityId: number) {
  const rows = await db.prepare(`
    SELECT id, numero, tipo, enunciado AS prompt, instrucciones AS instructions,
      opciones_json AS optionsJson, recursos_json AS resourcesJson, placeholder, puntaje,
      clave_correccion_json AS claveCorreccionJson,
      retroalimentacion_correcta AS retroalimentacionCorrecta,
      retroalimentacion_incorrecta AS retroalimentacionIncorrecta
    FROM preguntas_actividad WHERE actividad_id = ?1 ORDER BY numero
  `).bind(activityId).all<PreviewQuestion>();
  return rows.results;
}

const publicQuestion = (question: PreviewQuestion) => ({
  number: question.numero,
  type: question.tipo,
  prompt: question.prompt,
  instructions: question.instructions,
  options: jsonArray(question.optionsJson),
  resources: jsonArray(question.resourcesJson),
  placeholder: question.placeholder,
  points: question.puntaje,
});

const judgmentFor = (percentage: number, activity: PreviewActivity) => percentage >= activity.achievementThreshold ? "logrado" : percentage >= activity.approvalThreshold ? "en_proceso" : "inicial";

export async function getTeacherActivityPreview(db: D1Database, userId: number, slug: string, groupCode: string | null) {
  const activity = await authorizePreview(db, userId, slug, groupCode);
  const questions = await questionsForPreview(db, activity.id);
  return { activity: { slug: activity.slug, title: activity.title, description: activity.description, totalPoints: activity.totalPoints }, groupCode, questions: questions.map(publicQuestion) };
}

export async function gradeTeacherActivityPreview(db: D1Database, userId: number, slug: string, groupCode: string | null, answers: unknown) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new TeacherPreviewError(400, "INVALID_ANSWERS", "Las respuestas de prueba deben ser un objeto JSON válido.");
  const activity = await authorizePreview(db, userId, slug, groupCode);
  const questions = await questionsForPreview(db, activity.id);
  const graded = gradeActivity(questions, answers as Record<string, unknown>);
  return {
    activity: { slug: activity.slug, title: activity.title },
    score: graded.score,
    total: graded.total,
    percentage: graded.percentage,
    judgment: judgmentFor(graded.percentage, activity),
    questions: graded.gradedAnswers.map((answer) => {
      const question = questions.find((item) => item.numero === answer.numeroPregunta)!;
      return {
        number: answer.numeroPregunta,
        prompt: question.prompt,
        type: question.tipo,
        options: jsonArray(question.optionsJson),
        studentAnswer: answer.respuestaDada,
        correct: answer.correcta,
        pointsAwarded: answer.puntajeObtenido,
        maxPoints: question.puntaje,
        feedback: answer.retroalimentacion,
        correctAnswer: publicCorrectAnswerForReview(question),
        explanation: question.retroalimentacionCorrecta,
      };
    }),
  };
}
