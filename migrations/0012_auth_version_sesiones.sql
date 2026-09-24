-- 0012 — Versión de autenticación por usuario y sesiones versionadas.
--
-- Objetivo: poder invalidar TODAS las sesiones de una cuenta de una sola vez y de
-- forma atómica (revocación global: cambio de contraseña, restablecimiento, decisión
-- administrativa o incidente de seguridad) sin depender de recorrer fila por fila.
--
-- Modelo:
--   * `usuarios.auth_version` es la versión vigente de autenticación de la cuenta.
--     Nace en 1 y sólo cambia al revocar globalmente (incremento de a uno).
--   * `sesiones_usuario.auth_version` es la copia inmutable que se tomó al crear la
--     sesión. Una sesión es válida solamente si su versión es IGUAL a la del usuario.
--
-- Por qué es fail-closed: el CHECK llega hasta 2147483647 (el máximo de un entero de
-- 32 bits con signo, el rango que D1/SQLite maneja sin sorpresas). Si una cuenta
-- llegara a ese techo, el incremento viola el CHECK, la transacción completa de la
-- revocación se aborta y NADA cambia: no se revocan sesiones a medias y no queda un
-- evento de auditoría fantasma. La cuenta queda en un estado ruidoso y revisable en
-- lugar de degradarse en silencio.
--
-- Retrocompatibilidad: `DEFAULT 1` cubre usuarios y sesiones preexistentes sin
-- backfill fila por fila. Tras aplicar esta migración, el esquema queda igual al que
-- necesita el Worker nuevo; por eso un rollback al Worker anterior deja de ser válido
-- en cuanto se ejecute la primera revocación global real (el Worker viejo no compara
-- versiones y consideraría válida una sesión ya revocada globalmente).
--
-- Esta migración es local: la aplicación remota de 0012 y el despliegue del Worker
-- versionado son un bloque posterior y separado.
PRAGMA foreign_keys = ON;

-- 1) Versión vigente de autenticación de la cuenta.
--    Se agrega la columna en lugar de reconstruir la tabla: `ADD COLUMN` con un
--    DEFAULT constante no reescribe filas ni invalida índices ni disparadores.
ALTER TABLE usuarios
  ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version BETWEEN 1 AND 2147483647);

-- 2) Copia inmutable de la versión vigente al momento de crear la sesión.
--    También con DEFAULT 1 para las sesiones preexistentes, que se crearon cuando
--    todas las cuentas estaban en la versión 1.
ALTER TABLE sesiones_usuario
  ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;

-- 3) Una sesión sólo puede nacer con la versión vigente del usuario. Esto cierra la
--    ventana entre leer la versión y escribir la sesión: ninguna ruta —tampoco un
--    script o una escritura manual— puede dejar una sesión con una versión obsoleta.
CREATE TRIGGER trg_sesion_auth_version_coherente_insert
BEFORE INSERT ON sesiones_usuario
WHEN NOT EXISTS (
  SELECT 1
  FROM usuarios u
  WHERE u.id = NEW.usuario_id AND u.auth_version = NEW.auth_version
)
BEGIN
  SELECT RAISE(ABORT, 'La sesión debe copiar la versión de autenticación vigente del usuario');
END;

-- 4) La versión de la sesión no se modifica después de creada: ni para "arreglarla",
--    ni para revalidar una sesión revocada globalmente. La única salida es una sesión
--    nueva, que vuelve a copiar la versión vigente.
CREATE TRIGGER trg_sesion_auth_version_inmutable_update
BEFORE UPDATE OF auth_version ON sesiones_usuario
WHEN NEW.auth_version <> OLD.auth_version
BEGIN
  SELECT RAISE(ABORT, 'La versión de autenticación de la sesión es inmutable');
END;
