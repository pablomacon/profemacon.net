-- Endurece la persistencia de entregas. D1 es la autoridad final sobre acceso,
-- cantidad de intentos, idempotencia e inmutabilidad de envíos cerrados.
PRAGMA foreign_keys = ON;

ALTER TABLE intentos_actividad ADD COLUMN submission_id TEXT;
-- numero_intento conserva la secuencia histórica; ordinal_efectivo representa
-- el cupo pedagógico y puede reutilizarse cuando un intento se anula.
ALTER TABLE intentos_actividad ADD COLUMN ordinal_efectivo INTEGER;
ALTER TABLE preguntas_actividad ADD COLUMN explicacion_revision_final TEXT DEFAULT NULL;

-- Las filas históricas pueden conservar NULL; todos los intentos nuevos deben
-- traer un identificador opaco y estable generado para esa entrega.
CREATE UNIQUE INDEX idx_intentos_submission_id
ON intentos_actividad(usuario_id, actividad_id, submission_id)
WHERE submission_id IS NOT NULL;

CREATE UNIQUE INDEX idx_intentos_ordinal_efectivo
ON intentos_actividad(actividad_id, habilitacion_id, usuario_id, ordinal_efectivo)
WHERE estado <> 'anulado' AND ordinal_efectivo IS NOT NULL;

CREATE TRIGGER trg_intento_submission_requerido_insert
BEFORE INSERT ON intentos_actividad
WHEN NEW.submission_id IS NULL
  OR length(trim(NEW.submission_id)) = 0
  OR NEW.submission_id <> trim(NEW.submission_id)
  OR length(NEW.submission_id) > 128
BEGIN
  SELECT RAISE(ABORT, 'La entrega requiere un submission_id válido');
END;

CREATE TRIGGER trg_intento_estado_inicial_insert
BEFORE INSERT ON intentos_actividad
WHEN NEW.estado <> 'en_progreso'
  OR NEW.puntaje_obtenido <> 0
  OR NEW.porcentaje <> 0
  OR NEW.juicio <> 'inicial'
  OR NEW.puntaje_total <> (
    SELECT a.puntaje_total FROM actividades a WHERE a.id = NEW.actividad_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Todo intento debe comenzar en progreso y sin resultados');
END;

CREATE TRIGGER trg_intento_submission_inmutable_update
BEFORE UPDATE OF submission_id ON intentos_actividad
WHEN NEW.submission_id IS NOT OLD.submission_id
BEGIN
  SELECT RAISE(ABORT, 'El submission_id de la entrega es inmutable');
END;

CREATE TRIGGER trg_intento_estructura_inmutable_update
BEFORE UPDATE OF actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo
ON intentos_actividad
WHEN NEW.actividad_id IS NOT OLD.actividad_id
  OR NEW.habilitacion_id IS NOT OLD.habilitacion_id
  OR NEW.usuario_id IS NOT OLD.usuario_id
  OR NEW.numero_intento IS NOT OLD.numero_intento
  OR NEW.ordinal_efectivo IS NOT OLD.ordinal_efectivo
BEGIN
  SELECT RAISE(ABORT, 'La identidad académica del intento es inmutable');
END;

CREATE TRIGGER trg_intento_acceso_seguro_insert
BEFORE INSERT ON intentos_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM actividades a
  JOIN habilitaciones_actividad h
    ON h.id = NEW.habilitacion_id
   AND h.actividad_id = a.id
  JOIN inscripciones i
    ON i.grupo_id = h.grupo_id
   AND i.usuario_id = NEW.usuario_id
   AND i.estado = 'activa'
  JOIN usuario_roles ur ON ur.usuario_id = NEW.usuario_id
  JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'estudiante'
  WHERE a.id = NEW.actividad_id
    AND a.estado = 'activa'
    AND h.habilitada = 1
    -- Las fechas académicas se almacenan e interpretan en UTC. datetime()
    -- admite el formato canónico de SQLite y variantes ISO 8601 normalizadas.
    AND (h.disponible_desde IS NULL OR datetime(h.disponible_desde) <= datetime('now'))
    AND (h.disponible_hasta IS NULL OR datetime(h.disponible_hasta) >= datetime('now'))
)
BEGIN
  SELECT RAISE(ABORT, 'La actividad no está disponible para este estudiante');
END;

-- Se cuentan intentos aceptados dentro del propio INSERT. Las escrituras de
-- SQLite/D1 son serializadas, por lo que dos Workers no pueden confirmar a la
-- vez una cantidad que exceda maximo_intentos.
CREATE TRIGGER trg_intento_limite_insert
BEFORE INSERT ON intentos_actividad
WHEN (
  SELECT COUNT(*)
  FROM intentos_actividad i
  WHERE i.actividad_id = NEW.actividad_id
    AND i.habilitacion_id = NEW.habilitacion_id
    AND i.usuario_id = NEW.usuario_id
    AND i.estado <> 'anulado'
) >= (
  SELECT a.maximo_intentos
  FROM actividades a
  WHERE a.id = NEW.actividad_id
)
BEGIN
  SELECT RAISE(ABORT, 'Se alcanzó el máximo de intentos');
END;

CREATE TRIGGER trg_intento_numero_secuencial_insert
BEFORE INSERT ON intentos_actividad
WHEN (
  SELECT COUNT(*)
  FROM intentos_actividad i
  WHERE i.actividad_id = NEW.actividad_id
    AND i.habilitacion_id = NEW.habilitacion_id
    AND i.usuario_id = NEW.usuario_id
    AND i.estado <> 'anulado'
) < (
  SELECT a.maximo_intentos FROM actividades a WHERE a.id = NEW.actividad_id
)
AND NEW.numero_intento <> 1 + COALESCE((
    SELECT MAX(i.numero_intento)
    FROM intentos_actividad i
    WHERE i.actividad_id = NEW.actividad_id
      AND i.habilitacion_id = NEW.habilitacion_id
      AND i.usuario_id = NEW.usuario_id
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'El número de intento no es el siguiente disponible');
END;

CREATE TRIGGER trg_intento_ordinal_efectivo_insert
BEFORE INSERT ON intentos_actividad
WHEN (
  SELECT COUNT(*)
  FROM intentos_actividad i
  WHERE i.actividad_id = NEW.actividad_id
    AND i.habilitacion_id = NEW.habilitacion_id
    AND i.usuario_id = NEW.usuario_id
    AND i.estado <> 'anulado'
) < (
  SELECT a.maximo_intentos FROM actividades a WHERE a.id = NEW.actividad_id
)
AND (
  NEW.ordinal_efectivo IS NULL
  OR typeof(NEW.ordinal_efectivo) <> 'integer'
  OR NEW.ordinal_efectivo <> 1 + (
      SELECT COUNT(*)
      FROM intentos_actividad i
      WHERE i.actividad_id = NEW.actividad_id
        AND i.habilitacion_id = NEW.habilitacion_id
        AND i.usuario_id = NEW.usuario_id
        AND i.estado <> 'anulado'
    )
  OR NEW.ordinal_efectivo > (
      SELECT a.maximo_intentos FROM actividades a WHERE a.id = NEW.actividad_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'El ordinal efectivo no corresponde al siguiente cupo disponible');
END;

CREATE TRIGGER trg_respuesta_coherente_insert
BEFORE INSERT ON respuestas_intento_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM intentos_actividad i
  JOIN preguntas_actividad p ON p.id = NEW.pregunta_id
  WHERE i.id = NEW.intento_id
    AND p.actividad_id = i.actividad_id
    AND p.numero = NEW.numero_pregunta
    AND p.tipo = NEW.tipo_pregunta
    AND typeof(NEW.puntaje_obtenido) = 'integer'
    AND NEW.puntaje_obtenido <= p.puntaje
    AND (
      (NEW.correcta = 1 AND NEW.puntaje_obtenido = p.puntaje)
      OR (NEW.correcta = 0 AND NEW.puntaje_obtenido = 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'La respuesta no es coherente con la pregunta del intento');
END;

CREATE TRIGGER trg_respuesta_coherente_update
BEFORE UPDATE ON respuestas_intento_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM intentos_actividad i
  JOIN preguntas_actividad p ON p.id = NEW.pregunta_id
  WHERE i.id = NEW.intento_id
    AND p.actividad_id = i.actividad_id
    AND p.numero = NEW.numero_pregunta
    AND p.tipo = NEW.tipo_pregunta
    AND typeof(NEW.puntaje_obtenido) = 'integer'
    AND NEW.puntaje_obtenido <= p.puntaje
    AND (
      (NEW.correcta = 1 AND NEW.puntaje_obtenido = p.puntaje)
      OR (NEW.correcta = 0 AND NEW.puntaje_obtenido = 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'La respuesta no es coherente con la pregunta del intento');
END;

CREATE TRIGGER trg_intento_estado_transicion_update
BEFORE UPDATE OF estado ON intentos_actividad
WHEN NEW.estado IS NOT OLD.estado
  AND NOT (
    OLD.estado = 'en_progreso'
    AND NEW.estado IN ('enviado', 'anulado')
  )
BEGIN
  SELECT RAISE(ABORT, 'La transición de estado del intento no está permitida');
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
      SELECT a.puntaje_total FROM actividades a WHERE a.id = OLD.actividad_id
    )
    AND NEW.puntaje_total = (
      SELECT COALESCE(SUM(p.puntaje), 0)
      FROM preguntas_actividad p
      WHERE p.actividad_id = OLD.actividad_id
    )
    AND NEW.puntaje_obtenido = (
      SELECT COALESCE(SUM(r.puntaje_obtenido), 0)
      FROM respuestas_intento_actividad r
      WHERE r.intento_id = OLD.id
    )
    AND NEW.porcentaje = CAST(ROUND(
      100.0 * NEW.puntaje_obtenido / NEW.puntaje_total
    ) AS INTEGER)
    AND EXISTS (
      SELECT 1 FROM preguntas_actividad p WHERE p.actividad_id = OLD.actividad_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM preguntas_actividad p
      WHERE p.actividad_id = OLD.actividad_id
        AND NOT EXISTS (
          SELECT 1 FROM respuestas_intento_actividad r
          WHERE r.intento_id = OLD.id AND r.pregunta_id = p.id
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM respuestas_intento_actividad r
      LEFT JOIN preguntas_actividad p
        ON p.id = r.pregunta_id AND p.actividad_id = OLD.actividad_id
      WHERE r.intento_id = OLD.id
        AND (p.id IS NULL OR typeof(r.puntaje_obtenido) <> 'integer')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'El cierre del intento contiene resultados incoherentes');
END;

CREATE TRIGGER trg_intento_enviado_inmutable_update
BEFORE UPDATE ON intentos_actividad
WHEN OLD.estado = 'enviado'
BEGIN
  SELECT RAISE(ABORT, 'Un intento enviado es inmutable');
END;

CREATE TRIGGER trg_intento_enviado_inmutable_delete
BEFORE DELETE ON intentos_actividad
WHEN OLD.estado = 'enviado'
BEGIN
  SELECT RAISE(ABORT, 'Un intento enviado es inmutable');
END;

CREATE TRIGGER trg_intento_anulado_inmutable_update
BEFORE UPDATE ON intentos_actividad
WHEN OLD.estado = 'anulado'
BEGIN
  SELECT RAISE(ABORT, 'Un intento anulado es inmutable');
END;

CREATE TRIGGER trg_intento_anulado_inmutable_delete
BEFORE DELETE ON intentos_actividad
WHEN OLD.estado = 'anulado'
BEGIN
  SELECT RAISE(ABORT, 'Un intento anulado es inmutable');
END;

CREATE TRIGGER trg_intento_en_progreso_no_eliminable
BEFORE DELETE ON intentos_actividad
WHEN OLD.estado = 'en_progreso'
BEGIN
  SELECT RAISE(ABORT, 'Un intento en progreso debe anularse, no eliminarse');
END;

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
