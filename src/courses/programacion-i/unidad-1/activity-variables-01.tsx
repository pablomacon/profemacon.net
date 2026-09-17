export function VariablesJavaActivity1({ onBack }: { onBack: () => void }) {
  return <section className="activity-page">
    <button className="back-link" onClick={onBack}>← Volver a la Unidad 1</button>
    <header className="activity-page-hero">
      <p className="eyebrow">Programación I · Unidad 1 · Actividad 1</p>
      <h1>Variables en Java</h1>
      <p>Práctica autocorregible sobre tipos, declaración, asignación, actualización y lectura simple de código.</p>
    </header>
    <section className="activity-access-panel" aria-labelledby="activity-access-title">
      <div><p className="eyebrow">Acceso protegido</p><h2 id="activity-access-title">Preparando la resolución segura</h2><p>La autenticación propia y la actividad de 12 consignas ya funcionan por separado. Falta unir la habilitación por grupo, la entrega y la corrección transaccional antes de mostrar las preguntas.</p></div>
      <dl><div><dt>Intentos</dt><dd>2 · se conserva el mejor resultado</dd></div><div><dt>Resultado</dt><dd>50 % aprobado · 76 % logrado</dd></div><div><dt>Corrección</dt><dd>Worker + D1 · claves no expuestas</dd></div></dl>
    </section>
  </section>;
}
