-- Piloto local de Programación I / Unidad 1: contenido público de Variables en Java — Actividad 1.
-- Las claves correctas no están en este archivo ni se versionan con la aplicación.
INSERT OR IGNORE INTO asignaturas (codigo, nombre, descripcion) VALUES
  ('programacion-i', 'Programación I', 'Asignatura utilizada para el piloto local de actividades.');

INSERT OR IGNORE INTO ediciones_anuales (asignatura_id, anio, nombre, estado)
SELECT id, 2026, 'Programación I 2026 (piloto local)', 'activa'
FROM asignaturas WHERE codigo = 'programacion-i';

INSERT OR IGNORE INTO grupos (edicion_anual_id, codigo, nombre)
SELECT id, 'DEMO-PI-1', 'Grupo ficticio de Programación I'
FROM ediciones_anuales
WHERE anio = 2026 AND nombre = 'Programación I 2026 (piloto local)';

INSERT OR IGNORE INTO inscripciones (usuario_id, grupo_id, estado, aprobado_en)
SELECT u.id, g.id, 'activa', CURRENT_TIMESTAMP
FROM usuarios u CROSS JOIN grupos g
WHERE u.nombre_usuario = 'estudiante.demo' AND g.codigo = 'DEMO-PI-1';

INSERT OR IGNORE INTO actividades (slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado, puntaje_total, maximo_intentos, umbral_aprobacion, umbral_destacado, mostrar_revision)
SELECT 'variables-java-01', ea.id, 'unidad-1', 'Variables en Java', 1, 'Variables en Java — Actividad 1', 'Tipos primitivos, declaración, asignación, actualización y lectura simple de código.', 'borrador', 12, 2, 50, 76, 1
FROM ediciones_anuales ea
JOIN asignaturas a ON a.id = ea.asignatura_id
WHERE a.codigo = 'programacion-i' AND ea.anio = 2026;

INSERT OR IGNORE INTO habilitaciones_actividad (actividad_id, grupo_id, habilitada)
SELECT a.id, g.id, 0
FROM actividades a CROSS JOIN grupos g
WHERE a.slug = 'variables-java-01' AND g.codigo = 'DEMO-PI-1';

INSERT OR IGNORE INTO preguntas_actividad (actividad_id, numero, tipo, enunciado, opciones_json, placeholder, puntaje) VALUES
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 1, 'radio', '¿Cuál de estas líneas declara correctamente una variable entera llamada edad con valor 15?', '[{"valor":"a","texto":"edad int = 15;"},{"valor":"b","texto":"int edad = 15;"},{"valor":"c","texto":"edad = int 15;"},{"valor":"d","texto":"int = edad 15;"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 2, 'radio', 'En Java, una variable es un espacio con nombre donde se puede guardar un dato.', '[{"valor":"verdadero","texto":"Verdadero"},{"valor":"falso","texto":"Falso"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 3, 'radio', '¿Qué tipo de dato usarías para guardar un número entero como la cantidad de estudiantes de un grupo?', '[{"valor":"boolean","texto":"boolean"},{"valor":"char","texto":"char"},{"valor":"int","texto":"int"},{"valor":"double","texto":"double"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 4, 'radio', '¿Qué tipo de dato usarías para guardar un valor con decimales, como 9.5?', '[{"valor":"int","texto":"int"},{"valor":"double","texto":"double"},{"valor":"char","texto":"char"},{"valor":"boolean","texto":"boolean"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 5, 'text', 'Completa la línea para declarar una variable booleana llamada cursoAprobado con valor verdadero.', '[]', 'Escribí la línea completa acá', 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 6, 'radio', '¿Cuál de estas líneas declara correctamente una variable char con la letra A?', '[{"valor":"a","texto":"char seccion = \"A\";"},{"valor":"b","texto":"char seccion = ''A'';"},{"valor":"c","texto":"String seccion = ''A'';"},{"valor":"d","texto":"char seccion = A;"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 7, 'radio', 'La siguiente línea es correcta en Java: double promedio = 8;', '[{"valor":"verdadero","texto":"Verdadero"},{"valor":"falso","texto":"Falso"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 8, 'radio', 'Observa el código:\nint puntos = 10;\npuntos = 25;\n\n¿Qué valor tiene puntos al final?', '[{"valor":"10","texto":"10"},{"valor":"15","texto":"15"},{"valor":"25","texto":"25"},{"valor":"error","texto":"Error"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 9, 'radio', 'Observa el código:\nint edad = 16;\nedad++;\n\n¿Qué valor tiene edad al final?', '[{"valor":"15","texto":"15"},{"valor":"16","texto":"16"},{"valor":"17","texto":"17"},{"valor":"error","texto":"Error"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 10, 'text', 'Completa el código para que guarde una distancia grande en una variable long.', '[]', 'Escribí la línea completa acá', 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 11, 'radio', '¿Cuál de las siguientes asignaciones es incorrecta?', '[{"valor":"a","texto":"int cantidad = 20;"},{"valor":"b","texto":"double precio = 42.5;"},{"valor":"c","texto":"boolean activo = true;"},{"valor":"d","texto":"int nota = 7.5;"}]', NULL, 1),
((SELECT id FROM actividades WHERE slug = 'variables-java-01'), 12, 'radio', 'Observa el código:\nint a = 5;\nint b = a;\na = 8;\n\n¿Qué valor tiene b al final?', '[{"valor":"5","texto":"5"},{"valor":"8","texto":"8"},{"valor":"13","texto":"13"},{"valor":"error","texto":"Error"}]', NULL, 1);
