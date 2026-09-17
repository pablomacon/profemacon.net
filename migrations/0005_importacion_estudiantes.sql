-- Nombres estructurados y trazabilidad de importaciones administrativas.
-- Los archivos fuente y los documentos en claro no se almacenan en esta tabla.
PRAGMA foreign_keys = ON;

ALTER TABLE usuarios ADD COLUMN nombres TEXT
  CHECK (nombres IS NULL OR length(trim(nombres)) > 0);

ALTER TABLE usuarios ADD COLUMN apellidos TEXT
  CHECK (apellidos IS NULL OR length(trim(apellidos)) > 0);

CREATE TABLE importaciones_estudiantes (
  id TEXT PRIMARY KEY,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE RESTRICT,
  actor_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  archivo_nombre TEXT NOT NULL,
  archivo_sha256 TEXT NOT NULL CHECK (length(archivo_sha256) = 64),
  asignatura_fuente TEXT NOT NULL,
  grupo_fuente TEXT NOT NULL,
  anio_fuente INTEGER NOT NULL CHECK (anio_fuente BETWEEN 2020 AND 2100),
  filas_leidas INTEGER NOT NULL CHECK (filas_leidas >= 0),
  filas_validas INTEGER NOT NULL CHECK (filas_validas >= 0),
  filas_rechazadas INTEGER NOT NULL CHECK (filas_rechazadas >= 0),
  estado TEXT NOT NULL DEFAULT 'validada' CHECK (estado IN ('validada', 'aplicada', 'rechazada')),
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  aplicada_en TEXT,
  UNIQUE (grupo_id, archivo_sha256),
  CHECK (filas_validas + filas_rechazadas = filas_leidas)
);

CREATE INDEX idx_importaciones_estudiantes_grupo
  ON importaciones_estudiantes(grupo_id, creada_en DESC);

