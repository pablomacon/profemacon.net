-- Datos exclusivamente ficticios para comprobar el esquema local.
INSERT INTO roles (codigo, nombre) VALUES
  ('administrador', 'Administrador'),
  ('docente', 'Docente'),
  ('practicante', 'Practicante'),
  ('estudiante', 'Estudiante');

INSERT INTO usuarios (nombre_usuario, nombre_mostrado, correo) VALUES
  ('ana.docente', 'Ana Docente (prueba)', 'ana.docente@example.test'),
  ('estudiante.demo', 'Estudiante Demo (prueba)', 'estudiante.demo@example.test');

INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (1, 2), (2, 4);

INSERT INTO asignaturas (codigo, nombre, descripcion) VALUES
  ('programacion-demo', 'Programación (demo)', 'Asignatura ficticia para verificar D1 local.');

INSERT INTO ediciones_anuales (asignatura_id, anio, nombre, estado) VALUES
  (1, 2026, 'Programación 2026 (demo)', 'activa');

INSERT INTO grupos (edicion_anual_id, codigo, nombre) VALUES
  (1, 'DEMO-A', 'Grupo de demostración A');

INSERT INTO inscripciones (usuario_id, grupo_id, estado, aprobado_en) VALUES
  (2, 1, 'activa', CURRENT_TIMESTAMP);
