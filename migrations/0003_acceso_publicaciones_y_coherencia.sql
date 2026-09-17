-- Acceso, responsables por grupo, publicación versionada de materiales y auditoría.
-- Esta migración no crea credenciales ni sesiones reales: solamente prepara el modelo seguro.
PRAGMA foreign_keys = ON;

CREATE TABLE identidades_usuario (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proveedor TEXT NOT NULL CHECK (proveedor IN ('google')),
  sujeto_proveedor TEXT NOT NULL,
  correo_proveedor TEXT COLLATE NOCASE,
  correo_verificado INTEGER NOT NULL DEFAULT 0 CHECK (correo_verificado IN (0, 1)),
  vinculada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acceso_en TEXT,
  UNIQUE (proveedor, sujeto_proveedor),
  UNIQUE (usuario_id, proveedor)
);

-- Se almacena solamente el hash del secreto de sesión; nunca la cookie o token en claro.
CREATE TABLE sesiones_usuario (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) >= 32),
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en TEXT NOT NULL,
  ultimo_uso_en TEXT,
  revocada_en TEXT,
  ip_hash TEXT,
  agente_usuario TEXT,
  CHECK (expira_en > creada_en)
);

CREATE TABLE asignaciones_grupo (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('docente', 'practicante')),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'archivada')),
  asignada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archivada_en TEXT,
  UNIQUE (usuario_id, grupo_id, tipo)
);

CREATE TABLE contenidos (
  id INTEGER PRIMARY KEY,
  asignatura_id INTEGER NOT NULL REFERENCES asignaturas(id) ON DELETE RESTRICT,
  codigo TEXT NOT NULL COLLATE NOCASE,
  unidad_codigo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'material' CHECK (tipo IN ('material', 'guia', 'recurso')),
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'activo', 'archivado')),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asignatura_id, codigo)
);

CREATE TABLE versiones_contenido (
  id INTEGER PRIMARY KEY,
  contenido_id INTEGER NOT NULL REFERENCES contenidos(id) ON DELETE CASCADE,
  numero_version INTEGER NOT NULL CHECK (numero_version > 0),
  ruta_fuente TEXT NOT NULL,
  hash_fuente TEXT,
  notas TEXT NOT NULL DEFAULT '',
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (contenido_id, numero_version)
);

CREATE TABLE publicaciones_contenido (
  id INTEGER PRIMARY KEY,
  version_contenido_id INTEGER NOT NULL REFERENCES versiones_contenido(id) ON DELETE RESTRICT,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'programada', 'publicada', 'archivada')),
  visible_desde TEXT,
  visible_hasta TEXT,
  publicada_en TEXT,
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (version_contenido_id, grupo_id),
  CHECK (visible_hasta IS NULL OR visible_desde IS NULL OR visible_hasta >= visible_desde)
);

CREATE TABLE eventos_auditoria (
  id INTEGER PRIMARY KEY,
  actor_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion TEXT NOT NULL,
  entidad_tipo TEXT NOT NULL,
  entidad_id TEXT,
  datos_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(datos_json)),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_identidades_usuario_usuario ON identidades_usuario(usuario_id);
CREATE INDEX idx_sesiones_usuario_vigencia ON sesiones_usuario(usuario_id, expira_en, revocada_en);
CREATE INDEX idx_asignaciones_grupo_alcance ON asignaciones_grupo(usuario_id, tipo, estado);
CREATE INDEX idx_contenidos_asignatura_unidad ON contenidos(asignatura_id, unidad_codigo, estado);
CREATE INDEX idx_publicaciones_grupo_estado ON publicaciones_contenido(grupo_id, estado, visible_desde);
CREATE INDEX idx_auditoria_entidad ON eventos_auditoria(entidad_tipo, entidad_id, creado_en DESC);

-- Un docente o practicante solamente puede asignarse con el rol global correspondiente.
CREATE TRIGGER trg_asignacion_grupo_rol_insert
BEFORE INSERT ON asignaciones_grupo
WHEN NOT EXISTS (
  SELECT 1
  FROM usuario_roles ur
  JOIN roles r ON r.id = ur.rol_id
  WHERE ur.usuario_id = NEW.usuario_id AND r.codigo = NEW.tipo
)
BEGIN
  SELECT RAISE(ABORT, 'El usuario no posee el rol requerido para la asignación');
END;

CREATE TRIGGER trg_asignacion_grupo_rol_update
BEFORE UPDATE OF usuario_id, tipo ON asignaciones_grupo
WHEN NOT EXISTS (
  SELECT 1
  FROM usuario_roles ur
  JOIN roles r ON r.id = ur.rol_id
  WHERE ur.usuario_id = NEW.usuario_id AND r.codigo = NEW.tipo
)
BEGIN
  SELECT RAISE(ABORT, 'El usuario no posee el rol requerido para la asignación');
END;

-- Un material solo puede publicarse en grupos de su propia asignatura.
CREATE TRIGGER trg_publicacion_contenido_asignatura_insert
BEFORE INSERT ON publicaciones_contenido
WHEN NOT EXISTS (
  SELECT 1
  FROM versiones_contenido vc
  JOIN contenidos c ON c.id = vc.contenido_id
  JOIN grupos g ON g.id = NEW.grupo_id
  JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
  WHERE vc.id = NEW.version_contenido_id AND c.asignatura_id = ea.asignatura_id
)
BEGIN
  SELECT RAISE(ABORT, 'El contenido y el grupo deben pertenecer a la misma asignatura');
END;

CREATE TRIGGER trg_publicacion_contenido_asignatura_update
BEFORE UPDATE OF version_contenido_id, grupo_id ON publicaciones_contenido
WHEN NOT EXISTS (
  SELECT 1
  FROM versiones_contenido vc
  JOIN contenidos c ON c.id = vc.contenido_id
  JOIN grupos g ON g.id = NEW.grupo_id
  JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
  WHERE vc.id = NEW.version_contenido_id AND c.asignatura_id = ea.asignatura_id
)
BEGIN
  SELECT RAISE(ABORT, 'El contenido y el grupo deben pertenecer a la misma asignatura');
END;

-- Una actividad solo puede habilitarse en grupos de su misma edición anual.
CREATE TRIGGER trg_habilitacion_actividad_edicion_insert
BEFORE INSERT ON habilitaciones_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM actividades a
  JOIN grupos g ON g.id = NEW.grupo_id
  WHERE a.id = NEW.actividad_id AND a.edicion_anual_id = g.edicion_anual_id
)
BEGIN
  SELECT RAISE(ABORT, 'La actividad y el grupo deben pertenecer a la misma edición anual');
END;

CREATE TRIGGER trg_habilitacion_actividad_edicion_update
BEFORE UPDATE OF actividad_id, grupo_id ON habilitaciones_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM actividades a
  JOIN grupos g ON g.id = NEW.grupo_id
  WHERE a.id = NEW.actividad_id AND a.edicion_anual_id = g.edicion_anual_id
)
BEGIN
  SELECT RAISE(ABORT, 'La actividad y el grupo deben pertenecer a la misma edición anual');
END;

-- El intento debe corresponder a la actividad habilitada y a una inscripción activa del estudiante.
CREATE TRIGGER trg_intento_actividad_coherencia_insert
BEFORE INSERT ON intentos_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM habilitaciones_actividad h
  JOIN inscripciones i ON i.grupo_id = h.grupo_id
  WHERE h.id = NEW.habilitacion_id
    AND h.actividad_id = NEW.actividad_id
    AND i.usuario_id = NEW.usuario_id
    AND i.estado = 'activa'
)
BEGIN
  SELECT RAISE(ABORT, 'El intento no corresponde a una habilitación e inscripción activas');
END;

CREATE TRIGGER trg_intento_actividad_coherencia_update
BEFORE UPDATE OF actividad_id, habilitacion_id, usuario_id ON intentos_actividad
WHEN NOT EXISTS (
  SELECT 1
  FROM habilitaciones_actividad h
  JOIN inscripciones i ON i.grupo_id = h.grupo_id
  WHERE h.id = NEW.habilitacion_id
    AND h.actividad_id = NEW.actividad_id
    AND i.usuario_id = NEW.usuario_id
    AND i.estado = 'activa'
)
BEGIN
  SELECT RAISE(ABORT, 'El intento no corresponde a una habilitación e inscripción activas');
END;

-- Si una calificación referencia un intento, ambos deben ser del mismo usuario y actividad.
CREATE TRIGGER trg_calificacion_intento_coherente_insert
BEFORE INSERT ON calificaciones_actividad
WHEN NEW.intento_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM intentos_actividad i
  WHERE i.id = NEW.intento_id
    AND i.usuario_id = NEW.usuario_id
    AND i.actividad_id = NEW.actividad_id
)
BEGIN
  SELECT RAISE(ABORT, 'La calificación no corresponde al usuario y actividad del intento');
END;

CREATE TRIGGER trg_calificacion_intento_coherente_update
BEFORE UPDATE OF usuario_id, actividad_id, intento_id ON calificaciones_actividad
WHEN NEW.intento_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM intentos_actividad i
  WHERE i.id = NEW.intento_id
    AND i.usuario_id = NEW.usuario_id
    AND i.actividad_id = NEW.actividad_id
)
BEGIN
  SELECT RAISE(ABORT, 'La calificación no corresponde al usuario y actividad del intento');
END;
