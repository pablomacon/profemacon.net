-- Autenticación propia, activación controlada e identificadores documentales históricos.
-- Los documentos no son nombres de usuario ni claves de relación académica.
PRAGMA foreign_keys = ON;

CREATE TABLE credenciales_locales (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  algoritmo TEXT NOT NULL DEFAULT 'pbkdf2-sha256' CHECK (algoritmo = 'pbkdf2-sha256'),
  iteraciones INTEGER NOT NULL CHECK (iteraciones >= 600000),
  sal_base64 TEXT NOT NULL CHECK (length(sal_base64) >= 20),
  hash_base64 TEXT NOT NULL CHECK (length(hash_base64) >= 40),
  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  bloqueada_hasta TEXT,
  establecida_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activaciones_cuenta (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL UNIQUE CHECK (length(codigo_hash) = 64),
  expira_en TEXT NOT NULL,
  consumida_en TEXT,
  revocada_en TEXT,
  creada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expira_en > creada_en)
);

-- El número se transforma en el Worker mediante HMAC con un secreto externo a D1.
-- Solo se conserva su terminación para que un administrador pueda reconocerlo.
CREATE TABLE documentos_usuario (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('cedula_uy', 'pasaporte', 'otro')),
  pais_emisor TEXT NOT NULL CHECK (length(pais_emisor) = 2),
  valor_hmac TEXT NOT NULL CHECK (length(valor_hmac) = 64),
  terminacion TEXT NOT NULL CHECK (length(terminacion) BETWEEN 2 AND 6),
  es_principal INTEGER NOT NULL DEFAULT 0 CHECK (es_principal IN (0, 1)),
  estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'historico', 'anulado')),
  verificado_en TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tipo, pais_emisor, valor_hmac)
);

CREATE UNIQUE INDEX idx_documento_principal_usuario
  ON documentos_usuario(usuario_id)
  WHERE es_principal = 1 AND estado = 'vigente';

CREATE INDEX idx_activaciones_usuario_vigencia
  ON activaciones_cuenta(usuario_id, expira_en, consumida_en, revocada_en);

CREATE INDEX idx_documentos_usuario
  ON documentos_usuario(usuario_id, estado);

