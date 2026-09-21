import { StudentActivityPage } from "../../../student-activity/student-activity-page";

export function VariablesJavaActivity1({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  return <StudentActivityPage slug="variables-java-01" onBack={onBack} onLogin={onLogin} />;
}
