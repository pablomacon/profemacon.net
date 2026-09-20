-- Un intento conserva las preguntas vigentes al comenzar, incluidas sus claves privadas.
-- La beta aún no tiene datos históricos de producción. Los intentos en progreso ya
-- existentes se reconstruyen con las preguntas actuales; los cerrados no se inventan.
PRAGMA foreign_keys = ON;

CREATE TABLE preguntas_intento_actividad (
  id INTEGER PRIMARY KEY,
  intento_id INTEGER NOT NULL REFERENCES intentos_actividad(id) ON DELETE CASCADE,
  pregunta_origen_id INTEGER NOT NULL,
  numero_pregunta INTEGER NOT NULL CHECK (numero_pregunta > 0),
  tipo_pregunta TEXT NOT NULL CHECK (tipo_pregunta IN ('radio', 'checkbox', 'text', 'ordenar', 'relacionar')),
  enunciado_snapshot TEXT NOT NULL,
  puntaje_maximo INTEGER NOT NULL CHECK (puntaje_maximo > 0),
  clave_correccion_snapshot_json TEXT CHECK (clave_correccion_snapshot_json IS NULL OR json_valid(clave_correccion_snapshot_json)),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (intento_id, numero_pregunta),
  UNIQUE (intento_id, pregunta_origen_id)
);

CREATE INDEX idx_preguntas_intento_actividad_intento ON preguntas_intento_actividad(intento_id, numero_pregunta);

-- Los únicos intentos anteriores que todavía pueden cambiar son los en progreso.
INSERT INTO preguntas_intento_actividad (
  intento_id, pregunta_origen_id, numero_pregunta, tipo_pregunta,
  enunciado_snapshot, puntaje_maximo, clave_correccion_snapshot_json
)
SELECT
  i.id, p.id, p.numero, p.tipo,
  p.enunciado, p.puntaje, p.clave_correccion_json
FROM intentos_actividad i
JOIN preguntas_actividad p ON p.actividad_id = i.actividad_id
WHERE i.estado = 'en_progreso';

-- Un INSERT de intento y este snapshot pertenecen a la misma sentencia SQLite:
-- si la copia falla, se revierte también la creación del intento.
CREATE TRIGGER trg_intento_snapshot_preguntas_insert
AFTER INSERT ON intentos_actividad
BEGIN
  INSERT INTO preguntas_intento_actividad (
    intento_id, pregunta_origen_id, numero_pregunta, tipo_pregunta,
    enunciado_snapshot, puntaje_maximo, clave_correccion_snapshot_json
  )
  SELECT
    NEW.id, p.id, p.numero, p.tipo,
    p.enunciado, p.puntaje, p.clave_correccion_json
  FROM preguntas_actividad p
  WHERE p.actividad_id = NEW.actividad_id
  ORDER BY p.numero;
END;

CREATE TRIGGER trg_pregunta_intento_snapshot_inmutable_update
BEFORE UPDATE ON preguntas_intento_actividad
BEGIN
  SELECT RAISE(ABORT, 'El snapshot de preguntas del intento es inmutable');
END;

CREATE TRIGGER trg_pregunta_intento_snapshot_inmutable_delete
BEFORE DELETE ON preguntas_intento_actividad
BEGIN
  SELECT RAISE(ABORT, 'El snapshot de preguntas del intento es inmutable');
END;

DROP TRIGGER IF EXISTS trg_respuesta_coherente_insert;
DROP TRIGGER IF EXISTS trg_respuesta_coherente_update;
DROP TRIGGER IF EXISTS trg_intento_finalizacion_coherente_update;

CREATE TRIGGER trg_respuesta_coherente_insert
BEFORE INSERT ON respuestas_intento_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM preguntas_intento_actividad p
  WHERE p.intento_id = NEW.intento_id
    AND p.pregunta_origen_id = NEW.pregunta_id
    AND p.numero_pregunta = NEW.numero_pregunta
    AND p.tipo_pregunta = NEW.tipo_pregunta
    AND typeof(NEW.puntaje_obtenido) = 'integer'
    AND NEW.puntaje_obtenido <= p.puntaje_maximo
    AND (
      (NEW.correcta = 1 AND NEW.puntaje_obtenido = p.puntaje_maximo)
      OR (NEW.correcta = 0 AND NEW.puntaje_obtenido = 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'La respuesta no es coherente con el snapshot del intento');
END;

CREATE TRIGGER trg_respuesta_coherente_update
BEFORE UPDATE ON respuestas_intento_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM preguntas_intento_actividad p
  WHERE p.intento_id = NEW.intento_id
    AND p.pregunta_origen_id = NEW.pregunta_id
    AND p.numero_pregunta = NEW.numero_pregunta
    AND p.tipo_pregunta = NEW.tipo_pregunta
    AND typeof(NEW.puntaje_obtenido) = 'integer'
    AND NEW.puntaje_obtenido <= p.puntaje_maximo
    AND (
      (NEW.correcta = 1 AND NEW.puntaje_obtenido = p.puntaje_maximo)
      OR (NEW.correcta = 0 AND NEW.puntaje_obtenido = 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'La respuesta no es coherente con el snapshot del intento');
END;

CREATE TRIGGER trg_intento_finalizacion_coherente_update
BEFORE UPDATE OF estado ON intentos_actividad
WHEN OLD.estado = 'en_progreso'
  AND NEW.estado = 'enviado'
  AND NOT (
    typeof(NEW.puntaje_obtenido) = 'integer'
    AND typeof(NEW.puntaje_total) = 'integer'
    AND typeof(NEW.porcentaje) = 'integer'
    AND NEW.puntaje_total > 0
    AND NEW.puntaje_obtenido >= 0
    AND NEW.puntaje_obtenido <= NEW.puntaje_total
    AND NEW.puntaje_total = (
      SELECT COALESCE(SUM(p.puntaje_maximo), 0)
      FROM preguntas_intento_actividad p
      WHERE p.intento_id = OLD.id
    )
    AND NEW.puntaje_obtenido = (
      SELECT COALESCE(SUM(r.puntaje_obtenido), 0)
      FROM respuestas_intento_actividad r
      WHERE r.intento_id = OLD.id
    )
    AND NEW.porcentaje = CAST(ROUND(100.0 * NEW.puntaje_obtenido / NEW.puntaje_total) AS INTEGER)
    AND EXISTS (SELECT 1 FROM preguntas_intento_actividad p WHERE p.intento_id = OLD.id)
    AND NOT EXISTS (
      SELECT 1
      FROM preguntas_intento_actividad p
      WHERE p.intento_id = OLD.id
        AND NOT EXISTS (
          SELECT 1
          FROM respuestas_intento_actividad r
          WHERE r.intento_id = OLD.id AND r.pregunta_id = p.pregunta_origen_id
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM respuestas_intento_actividad r
      LEFT JOIN preguntas_intento_actividad p
        ON p.intento_id = r.intento_id AND p.pregunta_origen_id = r.pregunta_id
      WHERE r.intento_id = OLD.id
        AND (p.id IS NULL OR typeof(r.puntaje_obtenido) <> 'integer')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'El cierre del intento contiene resultados incoherentes con su snapshot');
END;

-- Se recrean después de los controles de coherencia para que la inmutabilidad
-- de un intento cerrado sea el rechazo observable y prioritario.
DROP TRIGGER IF EXISTS trg_respuesta_intento_enviado_insert;
DROP TRIGGER IF EXISTS trg_respuesta_intento_enviado_update;
DROP TRIGGER IF EXISTS trg_respuesta_intento_enviado_delete;

CREATE TRIGGER trg_respuesta_intento_enviado_insert
BEFORE INSERT ON respuestas_intento_actividad
WHEN EXISTS (
  SELECT 1 FROM intentos_actividad i
  WHERE i.id = NEW.intento_id AND i.estado IN ('enviado', 'anulado')
)
BEGIN
  SELECT RAISE(ABORT, 'Las respuestas de un intento cerrado son inmutables');
END;

CREATE TRIGGER trg_respuesta_intento_enviado_update
BEFORE UPDATE ON respuestas_intento_actividad
WHEN EXISTS (
  SELECT 1 FROM intentos_actividad i
  WHERE i.id = OLD.intento_id AND i.estado IN ('enviado', 'anulado')
)
BEGIN
  SELECT RAISE(ABORT, 'Las respuestas de un intento cerrado son inmutables');
END;

CREATE TRIGGER trg_respuesta_intento_enviado_delete
BEFORE DELETE ON respuestas_intento_actividad
WHEN EXISTS (
  SELECT 1 FROM intentos_actividad i
  WHERE i.id = OLD.intento_id AND i.estado IN ('enviado', 'anulado')
)
BEGIN
  SELECT RAISE(ABORT, 'Las respuestas de un intento cerrado son inmutables');
END;
