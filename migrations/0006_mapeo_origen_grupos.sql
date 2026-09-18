-- Vinculacion explicita entre las etiquetas de un portafolio y un grupo interno.
-- Un nombre de archivo nunca crea ni selecciona un grupo por si solo.
PRAGMA foreign_keys = ON;

CREATE TABLE mapeos_grupo_origen (
  id INTEGER PRIMARY KEY,
  sistema TEXT NOT NULL DEFAULT 'portafolio' CHECK (sistema = 'portafolio'),
  asignatura_fuente_normalizada TEXT NOT NULL,
  grupo_fuente_normalizado TEXT NOT NULL,
  anio_fuente INTEGER NOT NULL CHECK (anio_fuente BETWEEN 2020 AND 2100),
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE RESTRICT,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'archivado')),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sistema, asignatura_fuente_normalizada, grupo_fuente_normalizado, anio_fuente)
);

CREATE INDEX idx_mapeos_grupo_origen_destino
  ON mapeos_grupo_origen(grupo_id, estado);
