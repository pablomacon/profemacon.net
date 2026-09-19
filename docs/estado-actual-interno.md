# Estado interno de Profe Macón 2.0

Última actualización: 19 de septiembre de 2026.

Este documento es la memoria operativa del proyecto. Describe qué existe, qué funciona realmente, qué decisiones ya fueron tomadas y cuál es el orden recomendado para continuar. No contiene credenciales ni datos personales reales y, por decisión del responsable, todavía no está enlazado desde el `README.md`.

## 1. Objetivo del sistema

Profe Macón 2.0 busca reunir en una sola plataforma:

- cursos y materiales organizados por asignatura, edición anual, grupo y unidad;
- acceso diferenciado para estudiantes, docentes, practicantes y administradores;
- actividades autocorregibles con intentos, devoluciones y resultados;
- publicación gradual de contenidos por grupo;
- seguimiento académico y calificaciones confirmadas por docentes;
- integración futura de actividades y resultados de los sistemas anteriores.

La beta se considerará apta para uso real cuando un estudiante pueda activar su cuenta, iniciar y cerrar sesión, consultar exclusivamente sus cursos, leer materiales publicados y resolver una actividad habilitada; cuando un docente pueda administrar sus grupos y consultar intentos; y cuando un practicante sólo pueda ver los grupos que le fueron asignados.

## 2. Tecnologías y ejecución

- TypeScript.
- React 19 y Vite 7.
- Cloudflare Worker como API y servidor de la aplicación.
- Cloudflare D1/SQLite para persistencia.
- Cloudflare Assets con fallback de aplicación de página única.
- Markdown para los materiales editoriales.
- Mermaid para diagramas y videos de YouTube integrados en las unidades.

Comandos principales:

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run db:seed:variables-pilot:local
npm run dev
npm run build
```

El desarrollo utiliza únicamente una D1 local guardada bajo `.wrangler/`. `wrangler.jsonc` contiene un identificador UUID de ceros: es un marcador y no representa una base remota. No existe todavía un despliegue productivo ni una conexión configurada con datos reales.

## 3. Estado del repositorio

La rama activa es `main`. Al comenzar esta revisión el árbol de trabajo estaba limpio; esta actualización deja únicamente el presente documento modificado. Los tres últimos bloques funcionales fueron consolidados en commits locales:

- `caaefa1`: Unidad 1 y autenticación propia;
- `8ddb60f`: validación segura de portafolios;
- `667ae7a`: importación segura de estudiantes.

La rama local está tres commits por delante de `origin/main`. Esos checkpoints todavía no fueron enviados al remoto.

Antes de abrir otro frente importante conviene comprobar:

1. que el árbol de trabajo no contenga modificaciones inesperadas;
2. que las pruebas y la compilación continúen pasando;
3. que los tres checkpoints locales estén respaldados en el remoto antes de incorporar datos o cambios difíciles de reproducir.

No deben descartarse ni sobrescribirse cambios locales mediante `git reset --hard` o procedimientos equivalentes.

## 4. Arquitectura académica implementada

La migración `0001_nucleo_academico.sql` contiene:

- roles;
- usuarios;
- asignación de roles;
- asignaturas;
- ediciones anuales;
- grupos;
- inscripciones.

Las relaciones académicas utilizan el `id` interno de `usuarios`. Nunca deben relacionarse intentos, inscripciones o calificaciones directamente con una cédula, pasaporte, correo o nombre de usuario.

La migración `0003_acceso_publicaciones_y_coherencia.sql` agrega:

- sesiones de usuario;
- asignaciones de docentes y practicantes por grupo;
- contenidos versionados;
- publicaciones por grupo;
- auditoría;
- reglas SQL para impedir relaciones incoherentes entre actividad, edición, grupo, estudiante y calificación.

También existe una tabla de identidades externas inicialmente preparada para Google. No se utiliza y no define la estrategia de autenticación vigente.

## 5. Decisión de identidad y autenticación

Se descartó Google OAuth como mecanismo principal. El motivo es evitar que, en computadoras compartidas, el sistema contribuya a que estudiantes dejen abierta una cuenta personal de Google. Profe Macón debe controlar y revocar únicamente sus propias sesiones.

La identidad se divide en tres conceptos:

1. **ID interno:** permanente, generado por la base y utilizado por todas las relaciones.
2. **Nombre de usuario:** generado de forma controlada e independiente del documento.
3. **Documento administrativo:** cédula, pasaporte u otro identificador utilizado para conciliación e importación, pero nunca como clave primaria ni usuario cotidiano.

La convención implementada usa `primernombre.primerapellidosignificativo.sufijo`, donde el sufijo son 12 caracteres de la huella HMAC y no procede de los dígitos visibles del documento.

### 5.1. Cambios de documento

Un estudiante extranjero puede inscribirse con pasaporte y obtener posteriormente una cédula uruguaya. Esto no debe crear una segunda cuenta.

La migración `0004_autenticacion_local.sql` permite guardar múltiples documentos históricos vinculados al mismo usuario. La migración `0005_importacion_estudiantes.sql` agrega nombres y apellidos estructurados y la trazabilidad de lotes, sin almacenar el archivo ni documentos en claro. El procedimiento previsto es:

1. localizar y confirmar manualmente la cuenta existente;
2. agregar el nuevo documento;
3. marcarlo como principal cuando corresponda;
4. conservar el documento anterior como histórico;
5. mantener intactos usuario, inscripciones, intentos y resultados;
6. registrar el cambio en auditoría.

El número completo del documento no persiste en D1. El Worker calcula HMAC-SHA-256 con `DOCUMENT_HMAC_KEY`, un secreto externo a la base, y conserva sólo la huella y una terminación corta para reconocimiento administrativo. La previsualización y aplicación están implementadas; falta configurar y custodiar el secreto en cada entorno real.

### 5.2. Activación de cuentas

No habrá registro público en la primera etapa. Las cuentas serán creadas o importadas por personal autorizado.

El flujo implementado es:

1. se crea previamente el usuario;
2. se genera un código aleatorio de activación;
3. D1 conserva solamente SHA-256 del código;
4. el estudiante introduce usuario, código y una contraseña nueva;
5. el código se consume una sola vez;
6. se crea inmediatamente una sesión local.

Un código de activación no puede modificar una cuenta que ya posea credenciales. El restablecimiento de contraseña será un flujo administrativo separado.

### 5.3. Contraseñas y bloqueo

- Longitud admitida: entre 12 y 128 caracteres.
- Algoritmo: PBKDF2-HMAC-SHA-256.
- Iteraciones: 600.000.
- Sal aleatoria e independiente para cada contraseña.
- Nunca se almacena ni registra la contraseña en claro.
- Después de cinco fallos, la cuenta queda bloqueada durante 15 minutos.
- Las respuestas no indican si falló el usuario, la contraseña o el código.

La implementación se encuentra en `worker/auth-crypto.ts` y `worker/local-auth.ts`.

### 5.4. Sesiones

- Token aleatorio de 256 bits.
- D1 almacena sólo SHA-256 del token.
- Cookie `HttpOnly`, `SameSite=Strict`, `Path=/` y `Secure` cuando se utiliza HTTPS.
- Duración absoluta máxima de 8 horas.
- Expiración después de 30 minutos sin actividad.
- Actualización de último uso con una frecuencia máxima aproximada de cinco minutos.
- Cierre explícito mediante revocación en D1 y eliminación de la cookie.
- Validación estricta del encabezado `Origin` para solicitudes de autenticación que modifican estado.

Endpoints actuales:

| Método | Ruta | Estado |
| --- | --- | --- |
| `POST` | `/api/auth/activate` | Implementado y probado |
| `POST` | `/api/auth/login` | Implementado y probado |
| `POST` | `/api/auth/logout` | Implementado y probado |
| `GET` | `/api/session` | Implementado y protegido |
| `GET` | `/api/me/courses` | Implementado y protegido |
| `POST` | `/api/student-imports/preview` | Implementado; requiere sesión, origen válido y autorización sobre el grupo |
| `POST` | `/api/student-imports/apply` | Implementado; repite las validaciones y aplica el lote transaccionalmente |

La interfaz `/ingresar` permite alternar entre ingreso y primera activación. Cuando existe una sesión, la cabecera muestra el nombre de la persona y un botón para salir.

## 6. Cursos y contenidos

### 6.1. Unidad 0

La Unidad 0 de Programación I contiene material de introducción a informática, computadora, CPU, memoria, software, algoritmos, lenguajes, Java y JVM. Incluye Markdown, diagramas Mermaid, galería y actividad formativa en React.

Sus archivos actuales están bajo:

- `content/programacion-i/unidad-0/`;
- `src/courses/programacion-i/unidad-0/`.

El antiguo `src/unit0.tsx` fue retirado después de confirmar que no conservaba comportamiento exclusivo.

### 6.2. Unidad 1

La Unidad 1, “Variables, tipos de datos y operadores”, está incorporada como borrador local. Incluye:

- cuatro clases;
- cuatro videos integrados;
- material Markdown;
- variables y tipos primitivos;
- declaración, asignación y actualización;
- operaciones aritméticas;
- intercambio de valores mediante una variable auxiliar;
- acceso visual a la Actividad 1;
- marcador pendiente para una segunda actividad.

Sus archivos están bajo:

- `content/programacion-i/unidad-1/`;
- `src/courses/programacion-i/unidad-1/`.

### 6.3. Limitación actual del catálogo

`GET /api/me/courses` consulta correctamente inscripciones y asignaciones del usuario autenticado. Sin embargo, la pantalla “Mis cursos” todavía muestra tarjetas codificadas directamente en React y no consume este endpoint. Tampoco redirige a usuarios anónimos.

Los materiales no contienen información privada, por lo que las rutas estáticas pueden verse durante el desarrollo. Antes de publicar por grupo, el Worker deberá decidir qué contenido está visible para cada sesión según las tablas de publicaciones.

## 7. Actividades autocorregibles

La migración `0002_actividades_autocorregibles.sql` implementa:

- actividades;
- preguntas;
- habilitaciones por grupo;
- intentos;
- respuestas de cada intento;
- calificaciones confirmadas por docentes.

La calificación de carnet no se genera automáticamente al resolver una actividad. Se conserva como decisión explícita del docente.

### 7.1. Piloto de Variables en Java

Existe un piloto local con:

- una actividad;
- doce preguntas;
- dos intentos máximos;
- conservación conceptual del mejor resultado;
- aprobación desde 50 %;
- nivel logrado desde 76 %;
- claves de corrección separadas de los datos públicos.

Los enunciados y opciones se encuentran en `seed/actividades/`. Las claves privadas están en `private/`, carpeta ignorada por Git. Las doce claves están cargadas en la D1 local, pero todavía deben verificarse contra la base Neon original antes de publicar.

`worker/activity-grading.ts` contiene el corrector, pero todavía no es llamado por ningún endpoint. La pantalla de la actividad sólo explica su estado y no muestra preguntas.

Falta implementar el circuito transaccional:

1. autenticar al estudiante;
2. comprobar inscripción activa y habilitación del grupo;
3. comprobar fechas y cantidad de intentos;
4. devolver preguntas sin claves privadas;
5. aceptar respuestas;
6. corregir exclusivamente en el Worker;
7. guardar intento y respuestas como una operación coherente;
8. devolver el resultado permitido por la configuración;
9. conservar y mostrar el mejor resultado.

## 8. Estado de la D1 local

Las migraciones `0001` a `0006` están aplicadas localmente. Después de las pruebas y su limpieza, el estado relevante incluye un único mapeo de grupo ficticio y cero importaciones aplicadas.

| Entidad | Cantidad o estado |
| --- | ---: |
| Usuarios ficticios | 2 |
| Sesiones activas | 0 |
| Credenciales activadas | 0 |
| Activaciones ficticias disponibles | 2 |
| Asignaturas | 2 |
| Grupos | 2 |
| Actividades | 1 |
| Preguntas | 12 |
| Claves privadas de corrección | 12 |
| Habilitaciones | 1 |
| Intentos de actividad | 0 |
| Contenidos versionados | 1 |
| Publicaciones | 1 |

La semilla local incorpora dos perfiles ficticios:

- `estudiante.demo`, rol estudiante;
- `ana.docente`, rol docente.

Los códigos ficticios de activación están documentados en `README.md` y en la propia semilla. Nunca deben copiarse a una base remota.

No hay estudiantes, documentos, credenciales ni resultados reales en el repositorio o la D1 local conocida.

## 9. Verificaciones realizadas

La implementación actual superó las siguientes comprobaciones:

- compilación TypeScript y build de Vite;
- aplicación de las seis migraciones locales;
- ejecución repetible de la semilla general;
- activación de estudiante y docente ficticios;
- rechazo de un código de activación reutilizado;
- rechazo de contraseña incorrecta;
- creación de sesión con contraseña correcta;
- lectura de usuario y roles desde `/api/session`;
- catálogo de cursos correspondiente a la inscripción;
- revocación y eliminación de cookie al cerrar sesión;
- respuesta `401` después del cierre;
- respuesta `403` ante un origen ajeno en una operación de autenticación;
- ausencia de sesiones activas al terminar las pruebas;
- `git diff --check` sin errores de espacios;
- 11 pruebas automatizadas aprobadas, incluidas normalización, HMAC documental, nombres de usuario y validación del lote;
- build de producción aprobado con los endpoints de previsualización y aplicación.

El portafolio real de referencia continúa produciendo una previsualización agregada de 19 filas válidas, cero filas inválidas, cero documentos duplicados y cero colisiones en las bases de usuario. Esa comprobación no imprime nombres ni documentos y no aplica el archivo a D1.

No fue posible realizar la inspección visual automatizada porque esta sesión de trabajo no tenía navegador interactivo disponible. La pantalla compila, pero requiere una revisión manual en escritorio y móvil.

## 10. Seguridad y privacidad pendientes

Antes de utilizar datos reales se debe completar:

- interfaz administrativa para el importador de cuentas;
- descarga y entrega privada de códigos de activación;
- configuración, custodia y estrategia de rotación de `DOCUMENT_HMAC_KEY`;
- restablecimiento de contraseña;
- revocación de todas las sesiones de una cuenta;
- limitación de frecuencia por dirección/origen además del bloqueo por cuenta;
- limpieza periódica de sesiones vencidas y activaciones expiradas;
- auditoría de altas, cambios documentales, restablecimientos y acciones docentes;
- aviso de privacidad y finalidad del tratamiento;
- mecanismo de acceso, rectificación y actualización de datos;
- política de conservación y eliminación;
- revisión de permisos de docentes y practicantes;
- pruebas automatizadas de autenticación y autorización;
- comprobación de que errores internos nunca exponen SQL, hashes o datos personales.

No se deben introducir datos personales reales en semillas, fixtures, Markdown, código React, archivos de prueba o commits.

## 11. Deuda técnica conocida

- La rama local contiene tres commits todavía no enviados a `origin/main`.
- “Mis cursos” todavía está codificado en React.
- Los contenidos no están filtrados por publicación/grupo.
- El corrector de actividades está desconectado.
- No hay flujo de restablecimiento de contraseña.
- El importador tiene API segura, pero todavía no tiene pantalla administrativa.
- No hay panel docente ni de practicante funcional.
- Hay pruebas automatizadas para criptografía, lectura del portafolio y preparación del lote, pero todavía no existe un script de lint ni pruebas de integración completas para los endpoints del importador.
- Mermaid genera fragmentos grandes durante el build; es una advertencia de rendimiento, no un error funcional.
- `npm audit` informa 11 avisos en la cadena preexistente de herramientas de Cloudflare y Mermaid (7 altos y 4 moderados al 17 de septiembre de 2026). Las dependencias nuevas del lector XLSX no aparecen afectadas. Se debe actualizar y volver a probar esa cadena antes de un despliegue real.
- Wrangler intenta escribir registros bajo el perfil del usuario y puede mostrar advertencias de permisos dentro del entorno restringido. Las operaciones locales se completan igualmente.
- La tabla de identidades Google de `0003` quedó como estructura no utilizada y deberá evaluarse antes de consolidar el esquema definitivo.

## 12. Dirección acordada

El orden recomendado es el siguiente.

### Hito 1 — Consolidar la base actual

- Completado: revisar y eliminar archivos legados.
- Completado: crear pruebas mínimas de criptografía de autenticación.
- Completado: confirmar en Git el bloque actual.
- Pendiente: hacer revisión visual de ingreso/activación.
- Pendiente: enviar el checkpoint al remoto cuando corresponda.

### Hito 2 — Importación controlada de estudiantes

- Completado: reconocer el formato de portafolio y el grupo desde el nombre del archivo.
- Completado: separar nombre y apellido e ignorar nacimiento y carné de salud.
- Completado: previsualizar y validar sin mostrar datos personales.
- Completado: definir el nombre de usuario con una base legible y 12 caracteres derivados del HMAC.
- Completado: vincular etiquetas de origen con grupos internos mediante un mapeo explícito.
- Completado: detectar duplicados, colisiones y posibles cuentas existentes.
- Completado: aplicar usuarios, roles, documentos, inscripciones, activaciones y auditoría mediante un lote transaccional.
- Completado: generar códigos de activación aleatorios y guardar solamente sus hashes.
- Pendiente: construir la interfaz administrativa de carga, revisión y doble confirmación.
- Pendiente: producir una salida privada para entregar individualmente los accesos.
- Pendiente: implementar la operación administrativa que agrega una nueva cédula a quien estaba registrado con pasaporte, sin crear otra cuenta. El esquema ya permite conservar ambos documentos.

### Hito 3 — Catálogo autenticado

- Consumir `/api/me/courses` desde React.
- Mostrar cursos y roles reales de la sesión.
- Gestionar estados de carga, sesión vencida y ausencia de cursos.
- Proteger vistas administrativas por rol.

### Hito 4 — Actividad 1 completa

- Implementar consulta segura de actividad.
- Implementar entrega, corrección y persistencia transaccional.
- Aplicar habilitación, fechas e intentos.
- Mostrar devolución y mejor resultado.
- Verificar las claves contra Neon antes de cualquier piloto real.

### Hito 5 — Panel docente mínimo

- Consultar grupos asignados.
- Importar o aprobar inscripciones.
- Habilitar actividades y fechas.
- Ver intentos y resultados.
- Confirmar o ajustar calificaciones con auditoría.

### Hito 6 — Piloto controlado

- Definir los grupos 2026 participantes.
- Cargar cuentas reales mediante el importador aprobado.
- Comunicar activación, privacidad y cierre de sesión.
- Ejecutar un piloto pequeño.
- Revisar incidencias antes de ampliar el alcance.

## 13. Próximo trabajo concreto

El próximo frente funcional debe ser la **interfaz administrativa del importador**. Debe ejecutar el lector, permitir confirmar tipo y país de los documentos, mostrar la previsualización y exigir una confirmación separada antes de aplicar.

La decisión aún abierta es el mecanismo privado de entrega de códigos de activación. Hasta resolverlo, configurar `DOCUMENT_HMAC_KEY` y completar las pruebas de integración no deben importarse cuentas reales. El portafolio de 2025 se mantiene únicamente como archivo de validación y no está mapeado a ningún grupo de D1.
