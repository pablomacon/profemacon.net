-- Infraestructura de actividades autocorregibles.
-- Las claves de corrección se guardan únicamente en D1 y nunca se devuelven al frontend.
PRAGMA foreign_keys = ON;

CREATE TABLE actividades (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  edicion_anual_id INTEGER NOT NULL REFERENCES ediciones_anuales(id) ON DELETE RESTRICT,
  unidad_codigo TEXT NOT NULL,
  tema TEXT NOT NULL,
  orden INTEGER NOT NULL CHECK (orden > 0),
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'activa', 'archivada')),
  puntaje_total INTEGER NOT NULL CHECK (puntaje_total > 0),
  maximo_intentos INTEGER NOT NULL DEFAULT 1 CHECK (maximo_intentos > 0),
  umbral_aprobacion INTEGER NOT NULL DEFAULT 50 CHECK (umbral_aprobacion BETWEEN 0 AND 100),
  umbral_destacado INTEGER NOT NULL DEFAULT 76 CHECK (umbral_destacado BETWEEN 0 AND 100),
  mostrar_revision INTEGER NOT NULL DEFAULT 1 CHECK (mostrar_revision IN (0, 1)),
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (umbral_destacado >= umbral_aprobacion),
  UNIQUE (edicion_anual_id, unidad_codigo, orden)
);

CREATE TABLE preguntas_actividad (
  id INTEGER PRIMARY KEY,
  actividad_id INTEGER NOT NULL REFERENCES actividades(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL CHECK (numero > 0),
  tipo TEXT NOT NULL CHECK (tipo IN ('radio', 'checkbox', 'text', 'ordenar', 'relacionar')),
  enunciado TEXT NOT NULL,
  instrucciones TEXT NOT NULL DEFAULT '',
  opciones_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(opciones_json)),
  recursos_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recursos_json)),
  placeholder TEXT,
  puntaje INTEGER NOT NULL DEFAULT 1 CHECK (puntaje > 0),
  -- Campo privado: lo consulta solamente el Worker al corregir.
  clave_correccion_json TEXT CHECK (clave_correccion_json IS NULL OR json_valid(clave_correccion_json)),
  retroalimentacion_correcta TEXT NOT NULL DEFAULT '',
  retroalimentacion_incorrecta TEXT NOT NULL DEFAULT '',
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actividad_id, numero)
);

CREATE TABLE habilitaciones_actividad (
  id INTEGER PRIMARY KEY,
  actividad_id INTEGER NOT NULL REFERENCES actividades(id) ON DELETE CASCADE,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  habilitada INTEGER NOT NULL DEFAULT 1 CHECK (habilitada IN (0, 1)),
  disponible_desde TEXT,
  disponible_hasta TEXT,
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actividad_id, grupo_id),
  CHECK (disponible_hasta IS NULL OR disponible_desde IS NULL OR disponible_hasta >= disponible_desde)
);

CREATE TABLE intentos_actividad (
  id INTEGER PRIMARY KEY,
  actividad_id INTEGER NOT NULL REFERENCES actividades(id) ON DELETE RESTRICT,
  habilitacion_id INTEGER NOT NULL REFERENCES habilitaciones_actividad(id) ON DELETE RESTRICT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  numero_intento INTEGER NOT NULL CHECK (numero_intento > 0),
  estado TEXT NOT NULL DEFAULT 'enviado' CHECK (estado IN ('en_progreso', 'enviado', 'anulado')),
  puntaje_obtenido INTEGER NOT NULL CHECK (puntaje_obtenido >= 0),
  puntaje_total INTEGER NOT NULL CHECK (puntaje_total > 0),
  porcentaje INTEGER NOT NULL CHECK (porcentaje BETWEEN 0 AND 100),
  juicio TEXT NOT NULL CHECK (juicio IN ('inicial', 'en_proceso', 'logrado')),
  devolucion TEXT NOT NULL DEFAULT '',
  enviado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actividad_id, habilitacion_id, usuario_id, numero_intento)
);

CREATE TABLE respuestas_intento_actividad (
  id INTEGER PRIMARY KEY,
  intento_id INTEGER NOT NULL REFERENCES intentos_actividad(id) ON DELETE CASCADE,
  pregunta_id INTEGER NOT NULL REFERENCES preguntas_actividad(id) ON DELETE RESTRICT,
  numero_pregunta INTEGER NOT NULL,
  tipo_pregunta TEXT NOT NULL,
  enunciado_snapshot TEXT NOT NULL,
  respuesta_dada_json TEXT NOT NULL CHECK (json_valid(respuesta_dada_json)),
  respuesta_normalizada_json TEXT NOT NULL CHECK (json_valid(respuesta_normalizada_json)),
  correcta INTEGER NOT NULL CHECK (correcta IN (0, 1)),
  puntaje_obtenido INTEGER NOT NULL CHECK (puntaje_obtenido >= 0),
  retroalimentacion TEXT NOT NULL DEFAULT '',
  UNIQUE (intento_id, pregunta_id)
);

-- La nota para carnet es una decisión docente, no un efecto automático de resolver una actividad.
CREATE TABLE calificaciones_actividad (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actividad_id INTEGER NOT NULL REFERENCES actividades(id) ON DELETE RESTRICT,
  intento_id INTEGER REFERENCES intentos_actividad(id) ON DELETE SET NULL,
  calificacion INTEGER NOT NULL CHECK (calificacion BETWEEN 1 AND 12),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmada', 'anulada')),
  observacion_docente TEXT NOT NULL DEFAULT '',
  registrada_por_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  registrada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (usuario_id, actividad_id)
);

CREATE INDEX idx_actividades_edicion_estado ON actividades(edicion_anual_id, estado, orden);
CREATE INDEX idx_preguntas_actividad_orden ON preguntas_actividad(actividad_id, numero);
CREATE INDEX idx_habilitaciones_actividad_grupo ON habilitaciones_actividad(grupo_id, habilitada);
CREATE INDEX idx_intentos_usuario_actividad ON intentos_actividad(usuario_id, actividad_id, enviado_en DESC);
CREATE INDEX idx_respuestas_intento ON respuestas_intento_actividad(intento_id, numero_pregunta);
