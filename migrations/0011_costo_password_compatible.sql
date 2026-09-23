-- 0011 — Costo de contraseña compatible con el runtime de Cloudflare.
--
-- Causa: WebCrypto en Workers rechaza PBKDF2 por encima de 100.000 iteraciones
-- ("Pbkdf2 failed: iteration counts above 100000 are not supported"), y el esquema
-- de 0004 exigía un mínimo de 600.000. Toda activación o login fallaba y el tope no
-- es configurable por wrangler ni depende del plan.
--
-- Rango resultante: `iteraciones BETWEEN 50000 AND 100000`.
--   * 50000  = minVerificable: mínimo de SEGURIDAD que la aplicación acepta verificar.
--   * 100000 = maxSoportado: techo duro del runtime.
-- El mínimo técnico del runtime (1) queda deliberadamente fuera: la aplicación es más
-- estricta que WebCrypto y una fila por debajo del piso debe fallar cerrada.
-- El piso de CREACIÓN (target = 100000) NO se codifica aquí: vive en
-- worker/auth-crypto.ts (PASSWORD_POLICY / createPasswordCredential).
--
-- Esta migración reconstruye la tabla porque SQLite no permite alterar un CHECK.
-- No borra filas: si alguna fila existente queda fuera del rango, la migración
-- FALLA ruidosamente en la guarda de precondición, antes de tocar el esquema.
PRAGMA foreign_keys = ON;

-- 1) Guarda de precondición. Falla antes de cualquier DDL sobre la tabla real si
--    existe una fila fuera del rango (por ejemplo una credencial antigua de 600000).
--    Es idempotente: un intento anterior fallido deja la guarda vacía y se reintenta.
CREATE TABLE IF NOT EXISTS verificacion_costo_0011 (
  iteraciones INTEGER NOT NULL CHECK (iteraciones BETWEEN 50000 AND 100000)
);

DELETE FROM verificacion_costo_0011;

INSERT INTO verificacion_costo_0011 (iteraciones) SELECT iteraciones FROM credenciales_locales;

DROP TABLE verificacion_costo_0011;

-- 2) Reconstrucción. La tabla se crea primero y sólo se reemplaza la original
--    después de copiar todas las filas, así que un fallo previo deja intacta la
--    tabla vigente. `DROP TABLE IF EXISTS` limpia el residuo de un intento fallido.
DROP TABLE IF EXISTS credenciales_locales_nueva;

CREATE TABLE credenciales_locales_nueva (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  algoritmo TEXT NOT NULL DEFAULT 'pbkdf2-sha256' CHECK (algoritmo IN ('pbkdf2-sha256')),
  formato TEXT NOT NULL DEFAULT 'v1' CHECK (formato IN ('v1')),
  iteraciones INTEGER NOT NULL CHECK (iteraciones BETWEEN 50000 AND 100000),
  sal_base64 TEXT NOT NULL CHECK (length(sal_base64) >= 20),
  hash_base64 TEXT NOT NULL CHECK (length(hash_base64) >= 40),
  intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  bloqueada_hasta TEXT,
  establecida_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copia con columnas explícitas: `formato` se escribe literal para no depender del
-- DEFAULT, y el CHECK de la tabla nueva vuelve a validar iteraciones fila por fila.
INSERT INTO credenciales_locales_nueva (
  usuario_id, algoritmo, formato, iteraciones, sal_base64, hash_base64,
  intentos_fallidos, bloqueada_hasta, establecida_en, actualizada_en
)
SELECT
  usuario_id, algoritmo, 'v1', iteraciones, sal_base64, hash_base64,
  intentos_fallidos, bloqueada_hasta, establecida_en, actualizada_en
FROM credenciales_locales;

DROP TABLE credenciales_locales;

ALTER TABLE credenciales_locales_nueva RENAME TO credenciales_locales;
