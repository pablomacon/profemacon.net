-- La revisión debe mostrar exactamente la versión recibida por el estudiante.
-- Estos campos son públicos una vez autorizada la revisión, pero se conservan
-- junto al snapshot para no depender de ediciones posteriores de la pregunta.
PRAGMA foreign_keys = ON;

ALTER TABLE preguntas_intento_actividad
  ADD COLUMN opciones_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(opciones_snapshot_json));

ALTER TABLE preguntas_intento_actividad
  ADD COLUMN explicacion_revision_final_snapshot TEXT;

-- Los únicos intentos previos que siguen siendo modificables son los borradores.
-- Los enviados anteriores no se completan desde la pregunta actual para no
-- fabricar una versión histórica que el estudiante no recibió.
DROP TRIGGER IF EXISTS trg_pregunta_intento_snapshot_inmutable_update;

UPDATE preguntas_intento_actividad
SET
  opciones_snapshot_json = COALESCE((
    SELECT p.opciones_json
    FROM preguntas_actividad p
    WHERE p.id = preguntas_intento_actividad.pregunta_origen_id
  ), '[]'),
  explicacion_revision_final_snapshot = (
    SELECT p.explicacion_revision_final
    FROM preguntas_actividad p
    WHERE p.id = preguntas_intento_actividad.pregunta_origen_id
  )
WHERE EXISTS (
  SELECT 1
  FROM intentos_actividad i
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
    opciones_snapshot_json, explicacion_revision_final_snapshot
  )
  SELECT
    NEW.id, p.id, p.numero, p.tipo,
    p.enunciado, p.puntaje, p.clave_correccion_json,
    p.opciones_json, p.explicacion_revision_final
  FROM preguntas_actividad p
  WHERE p.actividad_id = NEW.actividad_id
  ORDER BY p.numero;
END;

CREATE TRIGGER trg_pregunta_intento_snapshot_inmutable_update
BEFORE UPDATE ON preguntas_intento_actividad
BEGIN
  SELECT RAISE(ABORT, 'El snapshot de preguntas del intento es inmutable');
END;
