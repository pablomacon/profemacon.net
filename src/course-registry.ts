export type CourseContentPath = `/curso/${string}`;

export type CourseContent = {
  entryPath: CourseContentPath;
  actionLabel: string;
  /**
   * Entrada al índice de materiales del consumo automático (6D-B). Es una
   * decisión explícita por curso: no se deriva del contenido descubierto, porque
   * el índice también ve los Markdown legacy de Unidad 0 y Unidad 1.
   * `null` cuando el curso no declara materiales v1.
   */
  materialEntryPath: CourseContentPath | null;
};

const courseRegistry: Readonly<Record<string, CourseContent>> = {
  "programacion-i": {
    entryPath: "/curso/programacion-i/unidad-0",
    actionLabel: "Abrir curso",
    materialEntryPath: "/curso/programacion-i",
  },
};

export function getCourseContent(subjectCode: string): CourseContent | undefined {
  return Object.hasOwn(courseRegistry, subjectCode) ? courseRegistry[subjectCode] : undefined;
}
