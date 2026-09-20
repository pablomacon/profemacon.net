export type CourseContentPath = "/curso/programacion-i/unidad-0";

export type CourseContent = {
  entryPath: CourseContentPath;
  actionLabel: string;
};

const courseRegistry: Readonly<Record<string, CourseContent>> = {
  "programacion-i": {
    entryPath: "/curso/programacion-i/unidad-0",
    actionLabel: "Abrir curso",
  },
};

export function getCourseContent(subjectCode: string): CourseContent | undefined {
  return Object.hasOwn(courseRegistry, subjectCode) ? courseRegistry[subjectCode] : undefined;
}
