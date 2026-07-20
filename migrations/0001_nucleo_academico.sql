-- Esquema inicial de la beta. No incluye datos reales ni credenciales.
PRAGMA foreign_keys = ON;

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE CHECK (codigo IN ('administrador', 'docente', 'practicante', 'estudiante')),
  nombre TEXT NOT NULL
);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY,
  nombre_usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre_mostrado TEXT NOT NULL,
  correo TEXT UNIQUE COLLATE NOCASE,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'suspendido', 'archivado')),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuario_roles (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  asignado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, rol_id)
);

CREATE TABLE asignaturas (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ediciones_anuales (
  id INTEGER PRIMARY KEY,
  asignatura_id INTEGER NOT NULL REFERENCES asignaturas(id) ON DELETE RESTRICT,
  anio INTEGER NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'activa', 'archivada')),
  UNIQUE (asignatura_id, anio)
);

CREATE TABLE grupos (
  id INTEGER PRIMARY KEY,
  edicion_anual_id INTEGER NOT NULL REFERENCES ediciones_anuales(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL COLLATE NOCASE,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'archivado')),
  UNIQUE (edicion_anual_id, codigo)
);

CREATE TABLE inscripciones (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE RESTRICT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activa', 'rechazada', 'archivada')),
  inscrito_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  aprobado_en TEXT,
  UNIQUE (usuario_id, grupo_id)
);

CREATE INDEX idx_ediciones_anuales_asignatura ON ediciones_anuales(asignatura_id);
CREATE INDEX idx_grupos_edicion ON grupos(edicion_anual_id);
CREATE INDEX idx_inscripciones_usuario ON inscripciones(usuario_id);
CREATE INDEX idx_inscripciones_grupo ON inscripciones(grupo_id);
