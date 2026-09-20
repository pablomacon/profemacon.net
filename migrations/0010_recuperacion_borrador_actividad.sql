-- El borrador debe reconstruirse exactamente como fue presentado al iniciar el
-- intento. Sólo se copian campos públicos que la interfaz necesita renderizar.
PRAGMA foreign_keys = ON;

ALTER TABLE preguntas_intento_actividad
  ADD COLUMN instrucciones_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE preguntas_intento_actividad
  ADD COLUMN recursos_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recursos_snapshot_json));

ALTER TABLE preguntas_intento_actividad
  ADD COLUMN placeholder_snapshot TEXT;

-- Se permite el único ajuste de snapshots ya existentes que aún son borradores.
DROP TRIGGER IF EXISTS trg_pregunta_intento_snapshot_inmutable_update;

UPDATE preguntas_intento_actividad
SET
  instrucciones_snapshot = COALESCE((
    SELECT p.instrucciones FROM preguntas_actividad p
    WHERE p.id = preguntas_intento_actividad.pregunta_origen_id
  ), ''),
  recursos_snapshot_json = COALESCE((
    SELECT p.recursos_json FROM preguntas_actividad p
    WHERE p.id = preguntas_intento_actividad.pregunta_origen_id
  ), '[]'),
  placeholder_snapshot = (
    SELECT p.placeholder FROM preguntas_actividad p
    WHERE p.id = preguntas_intento_actividad.pregunta_origen_id
  )
WHERE EXISTS (
  SELECT 1 FROM intentos_actividad i
  WHERE i.id = preguntas_intento_actividad.intento_id
    AND i.estado = 'en_progreso'
);

DROP TRIGGER IF EXISTS trg_intento_snapshot_preguntas_insert;

CREATE TRIGGER trg_intento_snapshot_preguntas_insert
AFTER INSERT ON intentos_actividad
BEGIN
  INSERT INTO preguntas_intento_actividad (
    intento_id, pregunta_origen_id, numero_pregunta, tipo_pregunta,
    enunciado_snapshot, puntaje_maximo, clave_correccion_snapshot_json,
    opciones_snapshot_json, explicacion_revision_final_snapshot,
    instrucciones_snapshot, recursos_snapshot_json, placeholder_snapshot
  )
  SELECT
    NEW.id, p.id, p.numero, p.tipo,
    p.enunciado, p.puntaje, p.clave_correccion_json,
    p.opciones_json, p.explicacion_revision_final,
    p.instrucciones, p.recursos_json, p.placeholder
  FROM preguntas_actividad p
  WHERE p.actividad_id = NEW.actividad_id
  ORDER BY p.numero;
END;

CREATE TRIGGER trg_pregunta_intento_snapshot_inmutable_update
BEFORE UPDATE ON preguntas_intento_actividad
BEGIN
  SELECT RAISE(ABORT, 'El snapshot de preguntas del intento es inmutable');
END;

-- "Continuar intento" no puede requerir una elección arbitraria entre dos
-- borradores. Los anulados y enviados no participan de esta restricción.
CREATE UNIQUE INDEX idx_intentos_un_borrador_activo
ON intentos_actividad(actividad_id, habilitacion_id, usuario_id)
WHERE estado = 'en_progreso';
