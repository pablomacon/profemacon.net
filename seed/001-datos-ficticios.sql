-- Datos exclusivamente ficticios para comprobar el esquema local.
-- La semilla es repetible y no depende de identificadores numéricos fijos.
INSERT OR IGNORE INTO roles (codigo, nombre) VALUES
  ('administrador', 'Administrador'),
  ('docente', 'Docente'),
  ('practicante', 'Practicante'),
  ('estudiante', 'Estudiante');

INSERT OR IGNORE INTO usuarios (nombre_usuario, nombre_mostrado, correo) VALUES
  ('ana.docente', 'Ana Docente (prueba)', 'ana.docente@example.test'),
  ('estudiante.demo', 'Estudiante Demo (prueba)', 'estudiante.demo@example.test');

UPDATE usuarios SET nombres = 'Ana', apellidos = 'Docente'
WHERE nombre_usuario = 'ana.docente' AND nombres IS NULL AND apellidos IS NULL;

UPDATE usuarios SET nombres = 'Estudiante', apellidos = 'Demo'
WHERE nombre_usuario = 'estudiante.demo' AND nombres IS NULL AND apellidos IS NULL;

INSERT OR IGNORE INTO usuario_roles (usuario_id, rol_id)
SELECT u.id, r.id
FROM usuarios u
JOIN roles r ON
  (u.nombre_usuario = 'ana.docente' AND r.codigo = 'docente') OR
  (u.nombre_usuario = 'estudiante.demo' AND r.codigo = 'estudiante');

-- Códigos públicos únicamente para probar la activación en la D1 local ficticia:
-- estudiante.demo / PM-DEMO-ESTUDIANTE-2026
-- ana.docente / PM-DEMO-DOCENTE-2026
INSERT OR IGNORE INTO activaciones_cuenta (id, usuario_id, codigo_hash, expira_en)
SELECT 'demo-activacion-estudiante', id, 'af0548123050312af95dd2ff7a0860cbd8682a039862004dd3fa8f7b1d2caa14', '2099-12-31 23:59:59'
FROM usuarios WHERE nombre_usuario = 'estudiante.demo';

INSERT OR IGNORE INTO activaciones_cuenta (id, usuario_id, codigo_hash, expira_en)
SELECT 'demo-activacion-docente', id, 'ceac50de1fd84cbb8e20815c9deff052f25b9e7aee2e21ac03cf77c9c4faedc7', '2099-12-31 23:59:59'
FROM usuarios WHERE nombre_usuario = 'ana.docente';

INSERT OR IGNORE INTO asignaturas (codigo, nombre, descripcion) VALUES
  ('programacion-demo', 'Programación (demo)', 'Asignatura ficticia para verificar D1 local.');

INSERT OR IGNORE INTO ediciones_anuales (asignatura_id, anio, nombre, estado)
SELECT id, 2026, 'Programación 2026 (demo)', 'activa'
FROM asignaturas
WHERE codigo = 'programacion-demo';

INSERT OR IGNORE INTO grupos (edicion_anual_id, codigo, nombre)
SELECT ea.id, 'DEMO-A', 'Grupo de demostración A'
FROM ediciones_anuales ea
JOIN asignaturas a ON a.id = ea.asignatura_id
WHERE a.codigo = 'programacion-demo' AND ea.anio = 2026;

INSERT OR IGNORE INTO inscripciones (usuario_id, grupo_id, estado, aprobado_en)
SELECT u.id, g.id, 'activa', CURRENT_TIMESTAMP
FROM usuarios u
JOIN grupos g ON g.codigo = 'DEMO-A'
JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
JOIN asignaturas a ON a.id = ea.asignatura_id
WHERE u.nombre_usuario = 'estudiante.demo'
  AND a.codigo = 'programacion-demo'
  AND ea.anio = 2026;

INSERT OR IGNORE INTO asignaciones_grupo (usuario_id, grupo_id, tipo)
SELECT u.id, g.id, 'docente'
FROM usuarios u
JOIN grupos g ON g.codigo = 'DEMO-A'
JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
JOIN asignaturas a ON a.id = ea.asignatura_id
WHERE u.nombre_usuario = 'ana.docente'
  AND a.codigo = 'programacion-demo'
  AND ea.anio = 2026;

INSERT OR IGNORE INTO contenidos (asignatura_id, codigo, unidad_codigo, titulo, descripcion, estado)
SELECT id, 'bienvenida-demo', 'inicio', 'Bienvenida al curso de demostración', 'Material ficticio para verificar publicaciones por grupo.', 'activo'
FROM asignaturas
WHERE codigo = 'programacion-demo';

INSERT OR IGNORE INTO versiones_contenido (contenido_id, numero_version, ruta_fuente, notas)
SELECT id, 1, 'content/demo/bienvenida.md', 'Versión ficticia para desarrollo local.'
FROM contenidos
WHERE codigo = 'bienvenida-demo';

INSERT OR IGNORE INTO publicaciones_contenido (version_contenido_id, grupo_id, estado, publicada_en)
SELECT vc.id, g.id, 'publicada', CURRENT_TIMESTAMP
FROM versiones_contenido vc
JOIN contenidos c ON c.id = vc.contenido_id
JOIN grupos g ON g.codigo = 'DEMO-A'
JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
WHERE c.codigo = 'bienvenida-demo'
  AND c.asignatura_id = ea.asignatura_id
  AND vc.numero_version = 1;
