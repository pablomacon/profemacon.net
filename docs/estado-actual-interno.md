# Estado interno de Profe Macón 2.0

Última actualización: 23 de septiembre de 2026.

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

La rama activa es `main`. Los checkpoints funcionales enviados a `origin/main` incluyen:

- `caaefa1`: Unidad 1 y autenticación propia;
- `8ddb60f`: validación segura de portafolios;
- `667ae7a`: importación segura de estudiantes.
- `5c2ab4e`: asistente de importación estudiantil;
- `7ed3c6a`: actualización del estado interno.
- `265301a`: instalación de Playwright para pruebas visuales.
- `8e09d99`: base segura de intentos de actividad.
- `349fd6c`: creación idempotente de intentos estudiantiles.
- `cce5d51`: guardado de respuestas en borrador.
- `d6f8ab9`: snapshots inmutables de preguntas por intento.
- `f8f4c08`: entrega, corrección y resultado seguro del intento.
- `fb7e4d4`: revisión final segura basada en snapshots.
- `0ab70a1`: descubrimiento y recuperación persistente de borradores.

El bloque de pruebas visuales y de navegador se mantiene separado para que sus referencias gráficas puedan revisarse en Git.

Antes de abrir otro frente importante conviene comprobar:

1. que el árbol de trabajo no contenga modificaciones inesperadas;
2. que las pruebas y la compilación continúen pasando;
3. que cada checkpoint funcional esté respaldado en el remoto antes de incorporar datos o cambios difíciles de reproducir.

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
- Algoritmo: PBKDF2-HMAC-SHA-256. Formato `v1` (sal de 16 bytes, 32 bytes derivados, base64).
- Política versionada en `worker/auth-crypto.ts` (`PASSWORD_POLICY`). Cada credencial conserva `algoritmo`, `formato` e `iteraciones`, y la verificación usa el costo persistido en la fila, nunca el objetivo vigente: no hay clamp ni degradación silenciosa.
- Iteraciones: objetivo de creación 100.000; mínimo verificable 50.000; máximo soportado 100.000, el techo duro del runtime de Cloudflare (rechaza PBKDF2 por encima de ese valor y el tope no es configurable por wrangler, por flags de compatibilidad ni por plan). Una credencial por debajo del mínimo verificable falla cerrada: no se verifica, no cuenta como intento fallido, no bloquea la cuenta y no crea sesión; `POST /api/auth/*` responde `500` con `{ code: "INTERNAL_ERROR" }` y un registro de mensaje fijo, sin datos sensibles.
- Rehash al iniciar sesión: desactivado (`PASSWORD_POLICY.rehashOnLogin` es `false`) hasta medir el `cpuTime` real de 100.000 iteraciones en Workers, porque un rehash duplicaría la derivación en el mismo request.
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
| `GET` | `/api/account-activations/candidates` | Implementado; lista sólo cuentas sin contraseña dentro de grupos autorizados |
| `POST` | `/api/account-activations/reissue` | Implementado; revoca códigos anteriores, genera uno nuevo y audita grupo y motivo |

La interfaz `/ingresar` permite alternar entre ingreso y primera activación. Cuando existe una sesión, la cabecera muestra el nombre de la persona y un botón para salir.

## 6. Cursos y contenidos

### 6.1. Unidad 0

La Unidad 0 de Programación I contiene material de introducción a informática, computadora, CPU, memoria, software, algoritmos, lenguajes, Java y JVM. Incluye Markdown, diagramas Mermaid, galería y actividad formativa en React.

La actividad histórica de esta unidad tenía respuestas expuestas en el componente React y en el Markdown empaquetado. Se retiraron la autocorrección local, los marcadores y las soluciones; la compilación actual ya no los contiene. Como estuvieron versionados, esas preguntas se consideran comprometidas y no deben reutilizarse como evaluación cuya seguridad dependa de una corrección confidencial. La pantalla conserva únicamente un aviso claro de material formativo en revisión.

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

### 6.3. Catálogo autenticado

El Hito 3 está completado. La pantalla “Mis cursos” consume `GET /api/me/courses` y el frontend distingue explícitamente los estados de sesión `checking`, `authenticated`, `anonymous` y `error`. La vista gestiona carga, error y reintento, sesión vencida, usuario sin cursos y catálogos con uno o varios accesos como estudiante, docente o practicante.

`src/course-registry.ts` mantiene un registro explícito y seguro del contenido frontend disponible. No se construyen rutas desde códigos arbitrarios recibidos de la API: un curso registrado ofrece su entrada conocida y cualquier otro se muestra sin navegación con “Contenido todavía no disponible”. En particular, `programacion-demo` conserva ese estado sin contenido.

Las comprobaciones de sesión se cancelan al desmontar y se invalidan cuando una solicitud posterior las vuelve obsoletas. Si la comprobación de `/api/session` posterior al ingreso falla, el formulario abandona correctamente el estado de envío y permite volver a intentar.

Los materiales no contienen información privada, por lo que las rutas internas estáticas de las unidades continúan accesibles durante el desarrollo sin protección basada en el catálogo. Esta limitación es consciente y quedó fuera del alcance del Hito 3. Antes de publicar por grupo, el Worker deberá decidir qué contenido está visible para cada sesión según las tablas de publicaciones.

## 7. Actividades autocorregibles

La migración `0002_actividades_autocorregibles.sql` implementa:

- actividades;
- preguntas;
- habilitaciones por grupo;
- intentos;
- respuestas de cada intento;
- calificaciones confirmadas por docentes.

La calificación de carnet no se genera automáticamente al resolver una actividad. Se conserva como decisión explícita del docente.

La migración `0007_actividad_entrega_segura.sql` establece la base segura de las entregas. Los intentos nuevos nacen exclusivamente `en_progreso`; tanto `en_progreso` como `enviado` reservan o consumen cupo y `anulado` no. `numero_intento` conserva la secuencia histórica, mientras que `ordinal_efectivo` representa el intento pedagógico visible y puede reutilizarse después de una anulación. Las únicas transiciones actuales son `en_progreso → enviado` y `en_progreso → anulado`; los intentos enviados y anulados son inmutables, al igual que las respuestas de un intento cerrado.

`submission_id` aporta idempotencia por usuario y actividad. D1 comprueba actividad, habilitación, inscripción, rol, ventana temporal y cantidad de intentos dentro de la escritura, e impide superar `maximo_intentos` incluso bajo concurrencia. Al cerrar un intento valida que estén todas y sólo las respuestas de la actividad, y que puntajes, total y porcentaje sean coherentes. Las fechas académicas se almacenan e interpretan en UTC mediante las funciones temporales de SQLite.

El endpoint `GET /api/me/activities/:slug` devuelve sólo la vista pública de una actividad habilitada para el estudiante y su grupo seleccionado de forma determinista. Informa los estados `available`, `not_open`, `closed`, `disabled` y `no_attempts`, el resumen acotado de intentos y el mejor intento enviado, sin consultas ni campos que expongan claves, respuestas correctas, criterios o retroalimentación privada. Sus respuestas usan `Cache-Control: no-store`.

`POST /api/me/activities/:slug/attempts` crea o recupera un intento mediante `submissionId` y un `groupCode` cuando es necesario desambiguar el grupo. La recuperación idempotente ocurre antes de volver a comprobar disponibilidad, por lo que un reintento del mismo contexto sigue recuperando su borrador aunque la actividad se cierre o deshabilite después. Para un identificador nuevo se mantienen las validaciones de disponibilidad y las invariantes de D1.

`PUT /api/me/activities/:slug/attempts/:attemptId/responses/:questionNumber` guarda o actualiza una respuesta únicamente en un intento propio `en_progreso`. Valida usuario, rol, matrícula, grupo, actividad, habilitación, intento y pregunta; no expone información privada y rechaza intentos enviados o anulados.

`GET /api/me/activities/:slug` informa también el único borrador propio `en_progreso` del grupo como `attempts.draft`, o `null`. `GET /api/me/activities/:slug/attempts/:attemptId` recupera ese borrador desde D1 con sus respuestas persistidas y sólo los campos públicos de sus snapshots. Esto permite continuar en otro navegador, dispositivo o sesión, sin depender de almacenamiento local. Los intentos enviados y anulados no son recuperables como borrador editable.

`POST /api/me/activities/:slug/attempts/:attemptId/submit` finaliza un borrador propio con cuerpo vacío. Corrige sólo a partir de snapshots privados y respuestas persistidas, exige que todas las preguntas tengan respuesta y actualiza atómicamente respuestas normalizadas, corrección, puntajes, porcentaje, juicio, fecha y estado `enviado`. Un reintento —incluso concurrente— de un intento ya enviado devuelve el resultado ya persistido sin volver a corregir. La respuesta pública incluye sólo puntajes, juicio, intento, resumen de cupos, mejor resultado, puntos y correcto/incorrecto por pregunta; nunca claves, respuestas correctas, modos de corrección, feedback privado ni revisión final.

El juicio actual se calcula con los umbrales de la actividad: antes de aprobación es `inicial`, desde aprobación y antes del umbral destacado es `en_proceso`, y desde éste es `logrado`. `reviewAvailable` es verdadero únicamente cuando la actividad permite revisión y el estudiante ya consumió todos sus intentos enviados. La revisión completa sigue siendo un endpoint separado.

`GET /api/me/activities/:slug/review` es el único endpoint estudiantil autorizado a devolver soluciones. Requiere sesión, rol estudiante, matrícula y grupo válidos, `mostrar_revision = 1` y al menos `maximo_intentos` propios con estado `enviado`; ni borradores ni anulaciones habilitan la revisión. Sigue disponible después del cierre de la ventana académica. Devuelve cada intento enviado y sus preguntas desde el snapshot correspondiente, además del mejor intento según porcentaje, puntaje y fecha de envío. La clave privada se transforma en una respuesta pedagógica pública sin serializar `clave_correccion_json`, `modo` ni otras estructuras internas.

La migración `0008_snapshots_preguntas_intento.sql` incorpora `preguntas_intento_actividad`: cada intento nuevo recibe atómicamente un snapshot inmutable de sus preguntas, incluidos enunciado, tipo, puntaje máximo y clave privada. La migración `0009_snapshot_revision_publica.sql` añade opciones públicas y explicación final al mismo snapshot; `0010_recuperacion_borrador_actividad.sql` completa instrucciones, recursos y placeholder para reconstruir un borrador. Las respuestas y los cierres se validan contra el snapshot, no contra preguntas que pudieran editarse luego. D1 impide más de un borrador `en_progreso` por usuario, actividad y habilitación. Los borradores existentes de esta beta se rellenan desde las preguntas actuales; no se fabrican snapshots para intentos históricos enviados o anulados.

`worker/activity-grading.ts` valida estrictamente claves, compatibilidad de tipos, respuestas checkbox y puntajes finitos, enteros seguros y positivos. Tiene pruebas unitarias con datos ficticios. Una barrera automatizada revisa archivos indexados y candidatos a Git para evitar incorporar claves privadas, incluso si se intenta forzar un archivo ignorado.

La revisión completa ya utiliza un endpoint separado, autorizado y basado en snapshots. Cuenta únicamente intentos `enviado`; los endpoints normales de catálogo, borrador, respuestas y entrega nunca devuelven respuestas correctas, valores aceptados, opciones correctas ni la estructura de la clave.

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

`worker/activity-grading.ts` se usa al finalizar un intento y recibe sólo snapshots privados y respuestas guardadas. El frontend genérico de actividades reutiliza contratos públicos: carga catálogo y borrador desde D1, guarda radio y checkbox inmediatamente, aplica debounce al texto, bloquea la entrega si hay respuestas incompletas o no persistidas, muestra el resultado público y consulta la revisión sólo bajo demanda. El piloto de Variables en Java se limita a aportar el `slug` y la ruta de entrada; no contiene lógica de corrección ni un motor específico.

El catálogo público ahora informa `attempts.reviewAvailable`, calculado exclusivamente con intentos propios `enviado`, para que el estudiante pueda abrir una revisión autorizada también al volver a ingresar después de agotar los cupos.

El modo prueba docente está disponible mediante la ruta de desarrollo `/docente/actividades/variables-java-01/prueba` y también desde la acción mínima del panel docente. Requiere rol `docente` y una asignación activa al grupo de la misma edición académica; no reutiliza la disponibilidad estudiantil, por lo que permite comprobar actividades borrador, deshabilitadas o fuera de fecha. Consulta las preguntas actuales, corrige en el Worker con `activity-grading.ts` y transforma las claves sólo en respuestas pedagógicas públicas. No crea ni modifica intentos, respuestas, cupos, mejores resultados, calificaciones, estadísticas ni historial académico.

### 7.2. Hito 6A — Pipeline de autoría JSON

**Filosofía.** No se construirá un editor manual de actividades tipo CREA ni una interfaz de edición visual. El flujo previsto es: el docente aporta materiales (PDF, Word, imágenes, apuntes, consignas), un asistente de IA diseña la actividad y produce un documento JSON canónico, el pipeline lo valida, se simula, se publica en D1 y la plataforma existente se ocupa de mostrarla, guardar borradores, corregir, registrar intentos, mostrar resultados, habilitar la revisión y alimentar el panel docente. El objetivo es eliminar la carga manual pregunta por pregunta. El JSON es un lenguaje de autoría, no un reflejo del esquema SQL: el publicador traduce desde él hacia la estructura privada de corrección.

**Contrato JSON v1.** Documento estricto: raíz `schemaVersion` (1), `activity`, `questions`, `tags`, `authoring`; cualquier clave desconocida en cualquier nivel es un error. Tipos de pregunta soportados: `radio`, `checkbox` y `text`. Deliberadamente fuera de v1: `ordenar`, `relacionar`, rúbricas, corrección parcial, IA dentro de la plataforma, aleatorización, banco de preguntas y reutilización compartida de preguntas entre actividades.

`activity` acepta `slug`, `title`, `description`, `topic`, `unitCode`, `order`, `edition.subjectCode`, `edition.year`, `maxAttempts`, `showReview`, `approvalThreshold`, `achievementThreshold` y `editorialState` (`draft`, `active`, `archived`, por defecto `draft`). `puntaje_total` nunca se escribe en el JSON: siempre se deriva de la suma de `questions[].points` y el publicador verifica esa coherencia antes de confirmar la transacción, porque los disparadores de D1 dependen de ella. No se admiten `totalPoints`, `puntaje_total`, `id`, `edicionAnualId`, `instructions` ni `resources` a nivel de actividad: la introducción general va en `activity.description`.

Cada pregunta lleva `number` (1..N contiguo y en orden), `type`, `prompt`, `instructions`, `points`, `options` (2..12 sólo en `radio` y `checkbox`), `placeholder` (sólo en `text`), `grading`, `explanation`, `feedback` y `resources`. El `grading` canónico es `{"mode":"single","correct":"a"}` para `radio`, `{"mode":"exact-selection","correct":["a","b"]}` para `checkbox` y `{"mode":"accepted-text","accepted":["int"],"trim":true,"caseSensitive":true}` para `text`; `trim:false` y `caseSensitive:false` son errores porque el corrector actual siempre recorta y siempre distingue mayúsculas. El publicador traduce esas claves a la forma privada real que exige `worker/activity-grading.ts`: `{"modo":"opcion","correctas":[...]}`, `{"modo":"seleccion-exacta","correctas":[...]}` (ordenada para determinismo) y `{"modo":"texto-exacto","aceptadas":[...]}`. Las opciones se persisten como `valor`/`texto`, `explanation` va a `explicacion_revision_final` y el feedback oficial del contrato v1 es `feedback.whenCorrect` y `feedback.whenIncorrect`, que se mapean a `retroalimentacion_correcta` y `retroalimentacion_incorrecta`. Se usa `whenCorrect`/`whenIncorrect` —y no `correct`/`incorrect`— para que `correct` siga reservado como nombre sensible de corrección privada y la barrera pública pueda continuar siendo estricta. El feedback se persiste, pero hoy no participa de la corrección estudiantil: el cierre del intento guarda la retroalimentación vacía y sólo el modo prueba docente lo muestra.

`tags` es metadata del pipeline: hasta 8 etiquetas en minúsculas, sin espacios, de hasta 32 caracteres, con soporte Unicode (por ejemplo `programación` o `autoría`), y no se persiste en D1. `authoring` también es metadata: `createdBy` es obligatorio y `version`, `notes` y `generatedAt` son opcionales.

**Seguridad.** El documento canónico completo, que incluye el `grading`, nunca entra a Git ni a OneDrive: vive en `%USERPROFILE%\profemacon-authoring-private\<asignatura>\<unidad>\<slug>.json`, fuera del repositorio y fuera de la carpeta sincronizada. Lo que sí se versiona es la proyección pública `authoring/<asignatura>/<unidad>/<slug>.public.json`, generada por el publicador con `--emit-public`, que conserva metadata pública, preguntas, opciones, recursos, puntajes, explicación y feedback, y jamás contiene `grading`, `correct`, `accepted`, `correctas`, `aceptadas` ni `clave_correccion_json`. La barrera `tests/private-activity-files.test.mjs` se amplió para revisar `authoring/` con patrones canónicos y con un chequeo estructural recursivo, sin debilitar los controles previos ni escanear tests y documentación. El publicador nunca imprime claves privadas ni valores aceptados: su informe sólo indica que la clave es privada.

**Publicador.** `worker/activity-authoring.ts` es un módulo puro —sin D1, sin `env` y sin sistema de archivos— que valida, normaliza, materializa las filas de `actividades` y `preguntas_actividad`, traduce el `grading`, produce y verifica la proyección pública y se auto-prueba con el corrector real: la respuesta correcta derivada del propio `grading` debe obtener el puntaje completo de cada pregunta, y cada clave debe ser aceptada por `publicCorrectAnswerForReview`. No lo importa `worker/index.ts` y no forma parte de ningún bundle.

El CLI `scripts/activity-authoring.mjs` expone `npm run activity:validate -- <archivo>` y `npm run activity:publish:local -- <archivo>`, acepta rutas externas al repositorio y admite `--json`, `--emit-public`, `--allow-content-change-with-history`, `--persist-to` y `--database`. `publish:local` es simulación por defecto y sólo escribe con `--apply`, en una única transacción `BEGIN IMMEDIATE` sobre la D1 local, con rollback ante cualquier fallo. Antes de confirmar verifica la actividad, la cantidad y la numeración de las preguntas, la suma de puntos, que las claves sean interpretables por el corrector y que ninguna tabla ajena a la publicación haya cambiado de tamaño; sólo toca `actividades` y `preguntas_actividad`. Nada remoto.

**Identidad.** En esta etapa `actividades.slug` sigue siendo único global. El JSON igualmente declara la edición anual, y las reglas son: slug inexistente → creación; mismo slug y misma edición → actualización; mismo slug y otra edición → `EDITION_MISMATCH`, con la indicación de usar otro slug, por ejemplo con sufijo de año. El pipeline nunca cambia la edición de una fila existente. Si una actividad se reutiliza otro año, se crea una actividad nueva, se duplican sus preguntas publicando el mismo JSON con otro slug y no hay reutilización compartida de una misma fila de actividad entre ediciones.

**Actualización e historia.** Sin intentos, el contenido es editable: se puede agregar, eliminar, reordenar, cambiar puntajes y reescribir la corrección dentro de la misma transacción. Con intentos existentes sólo se admite metadata segura (título, descripción, tema, umbrales, revisión, estado editorial y orden), `maxAttempts` queda bloqueado y cualquier cambio de contenido exige `--allow-content-change-with-history`; aun con el flag no se eliminan ni renumeran preguntas existentes y sólo se agregan nuevas al final. Los snapshots protegen la historia: un borrador ya iniciado conserva la versión anterior y los intentos nuevos reciben la versión publicada. La barrera `tests/activity-authoring-pipeline.test.mjs` lo comprueba con el corrector real, verificando que la opción correcta de la versión nueva no puntúa en el borrador viejo y que la vieja no puntúa en el intento nuevo.

**Resources.** El contrato v1 acepta recursos `image` (ruta interna que empieza con `/`, sin `//`, sin `..`) y `code` (lenguajes `java`, `javascript`, `typescript`, `sql`, `bash`, `json`, `text`). Se validan y se persisten verbatim en `recursos_json`, y hoy también se muestran al estudiante y al modo prueba docente mediante el render del Hito 6B (§7.3). La validación de recursos —`RESOURCE_INVALID`, `IMAGE_ALT_WEAK`, same-origin y lista de lenguajes— permanece intacta; la advertencia `RESOURCES_NOT_RENDERED` fue retirada porque dejó de ser verdadera.

**Tests.** `npm test` queda en 56/56 e incluye 14 pruebas puras del contrato, la traducción privada, la auto-prueba y la redacción; 5 pruebas de pipeline sobre una D1 temporal con datos ficticios que cubren creación, idempotencia, actualización, no duplicación, rollback, conflicto de orden, edición inexistente, ausencia de escritura en tablas ajenas, actividad con intentos, contenido bloqueado sin flag y permitido con flag, `maxAttempts` bloqueado, borrador de la versión 1 intacto tras publicar la versión 2, intento nuevo con la versión 2, contrato de salida y no impresión de secretos; y la barrera de claves privadas ampliada.

### 7.3. Hito 6B — Render de resources

**Estado: COMPLETO** (22 de septiembre de 2026).

Tipos soportados: `image` y `code`. Ningún otro tipo se renderiza.

**Frontend.** El render vive en un único componente compartido, `src/student-activity/question-resources.tsx` (`QuestionResources`), integrado dentro de `QuestionRenderer`. Como la actividad del estudiante y el modo prueba docente ya dibujaban las preguntas con ese mismo componente, ambos muestran los recursos con una sola implementación y sin cambios de backend ni de API. Los recursos se pintan después del enunciado y de las instrucciones y antes de los controles de respuesta, respetando el orden del array recibido.

**Image.** Sólo rutas internas del sitio (`/…`): se rechazan `http://`, `https://`, `//` y `..`; `alt` obligatorio y real, nunca reemplazado por el título ni el epígrafe; `<figure>` con `<figcaption>` cuando existe `caption`; `loading="lazy"`, `max-width: 100%` y `height: auto`. Sin click, zoom, modal, galería ni lightbox.

**Code.** `<pre><code>` con el contenido tratado únicamente como texto —React lo escapa y no se usa `dangerouslySetInnerHTML`—, espacios y saltos preservados, desplazamiento horizontal contenido dentro del bloque y `title`/`language` opcionales como información discreta. Sin librerías de resaltado, sin `textarea` y sin botón de copiado.

**Seguridad.** El frontend falla cerrado ante datos inesperados aunque el pipeline ya los valide: un recurso desconocido o inválido se ignora en silencio, nunca se muestran datos crudos y, si ningún recurso de la pregunta es representable, el componente no emite ningún nodo. No hubo cambios de grading, de migraciones, de esquema ni de persistencia; el único cambio en el Worker fue retirar la advertencia `RESOURCES_NOT_RENDERED`, y no se agregaron dependencias ni se modificaron APIs.

**Cobertura.** Dos escenarios nuevos de Playwright —uno estudiantil y uno del modo prueba docente— comprueban `src`/`alt`, epígrafe, orden, contenido exacto con saltos de línea, texto no interpretado como HTML, fallo cerrado ante recursos desconocidos o inválidos, ausencia de bloque cuando la pregunta no tiene recursos y ausencia de desbordamiento horizontal en escritorio y móvil. La suite E2E focalizada de estudiante y preview queda en 44 casos aprobados.

**Fuera de alcance (deudas, no fallos).** Los recursos todavía no se muestran en la revisión final del estudiante ni en el detalle docente C4; las imágenes reales deben existir bajo el `publicDir` de Vite; no se declaran `width`/`height`, por lo que una imagen diferida puede producir un desplazamiento menor; y no hay resaltado de sintaxis, zoom, galería, lightbox ni tipos nuevos de recurso.

### 7.4. Hito 6C — Asignación y habilitación automatizada por grupos

**Estado: COMPLETO** (22 de septiembre de 2026).

**Filosofía.** 6A publica el *contenido* de una actividad; 6C publica su *contexto académico*: qué grupos la reciben, desde cuándo, hasta cuándo y si está habilitada. Son dos documentos distintos porque la actividad es contenido reutilizable dentro de una edición, mientras que la habilitación es específica de grupos y fechas. El archivo de 6C declara **estado deseado**, no un parche: describe cómo debe quedar cada grupo y el pipeline informa —y sólo con `--apply` escribe— la diferencia contra la D1 local. No hay UI nueva, ni endpoint nuevo, ni editor visual.

**Contrato JSON v1, separado de 6A.** Documento estricto con raíz `schemaVersion` (1), `activity`, `assignments` y `authoring`; cualquier clave desconocida en cualquier nivel es un error. `activity` contiene exactamente `slug` y `edition.subjectCode`/`edition.year`; incluir `maxAttempts` (o `maximo_intentos`) es un error con mensaje explícito de frontera, porque la cantidad de intentos pertenece a la actividad y se publica con 6A, igual que `title`, `questions` o `puntaje_total`. `assignments` admite de 1 a 50 entradas, cada grupo exactamente una vez (comparación sin distinguir mayúsculas) y cada entrada exige las cuatro claves: `groupCode`, `enabled`, `opensAt` y `closesAt`. `authoring.createdBy` es obligatorio, con `version`, `notes` y `generatedAt` opcionales, y `authoring` **no se persiste** en D1. Ejemplo completo:

```json
{
  "schemaVersion": 1,
  "activity": { "slug": "variables-java-01", "edition": { "subjectCode": "programacion-i", "year": 2026 } },
  "assignments": [
    { "groupCode": "1MF", "enabled": true, "opensAt": "2026-09-28T08:00:00-03:00", "closesAt": "2026-10-02T23:59:00-03:00" }
  ],
  "authoring": { "createdBy": "profe-macon-ai-workflow", "version": 1 }
}
```

**Actividad.** Se resuelve por `slug` + `subjectCode` + `year`: edición inexistente → `EDITION_NOT_FOUND`; actividad inexistente → `ACTIVITY_NOT_FOUND` (6C nunca crea contenido; hay que publicar antes con 6A); slug existente en otra edición → `EDITION_MISMATCH`; actividad `archivada` → blocker `ACTIVITY_ARCHIVED`; actividad `borrador` → advertencia `ACTIVITY_NOT_ACTIVE`; actividad `activa` → OK. «Activa» (estado editorial de la actividad) y «habilitada» (por grupo) siguen siendo cosas distintas: el estudiante necesita ambas.

**Grupos.** Se resuelven por `groupCode` + la edición anual de la actividad, nunca por ids internos. Código inexistente → `GROUP_NOT_FOUND`; existente sólo en otra edición → `GROUP_NOT_IN_EDITION`; grupo `archivado` → blocker `GROUP_ARCHIVED`; repetido en el documento —incluso `1MF` frente a `1mf`— → `GROUP_DUPLICATED`. Todos los grupos se resuelven **antes** de escribir: un solo blocker impide aplicar el archivo completo.

**Fechas.** `opensAt` y `closesAt` son obligatorios y su valor puede ser `null`, que significa «sin límite». Una fecha no nula debe ser ISO 8601 **con offset explícito** (`Z`, `-03:00`, `+03:00`); se rechazan la fecha sin offset, el texto libre, los vacíos y las fechas imposibles, y todo se normaliza a `YYYY-MM-DDTHH:MM:SS.sssZ` antes de comparar o persistir, con la misma forma que ya escribe el endpoint docente. Si ambas existen debe cumplirse `opensAt < closesAt`; los cuatro casos —ninguna, sólo apertura, sólo cierre y ambas— son válidos. La comparación es por instante, no por texto: el mismo momento expresado con otro offset no genera cambios.

**Idempotencia.** La UNIQUE existente `(actividad_id, grupo_id)` garantiza una sola fila por actividad y grupo: sin fila → `create`; fila con los mismos tres valores → `unchanged`, que **no ejecuta UPDATE** y deja `creada_en` intacto; fila con diferencias → `update` con `changedFields` exactos (`enabled`, `opensAt`, `closesAt`). Aplicar dos veces el mismo documento deja todo en `unchanged` y no escribe nada.

**Simulación y escritura.** `npm run activity:assign:validate -- <archivo.json>` valida el contrato sin abrir la base y `npm run activity:assign:local -- <archivo.json>` simula por defecto; sólo con `--apply` se escribe. Los únicos flags son `--apply`, `--json`, `--persist-to <dir>` y `--database <sqlite>`, y todo apunta siempre a la D1 local (por defecto `.wrangler`): nunca a una base remota. El informe —seguro en consola y en JSON— incluye `status`, `dryRun`, la ruta de la base usada, la actividad con su estado editorial y su `maxAttempts` de sólo lectura, y por grupo `groupCode`, `action`, `current`, `desired` y `changedFields`; además `summary`, `history`, `warnings`, `errors` y `postVerify`. Los estados del CLI son exactamente `validated` (sólo validación), `created` (todas las acciones del archivo son altas), `updated` (todas son actualizaciones), `unchanged` (ninguna fila cambia), `mixed` (el mismo archivo produjo más de un tipo de acción entre sus grupos) y `rejected` (contrato inválido, blocker de resolución o fallo de base/verificación). Los códigos de salida son 0 éxito, 1 documento inválido, 2 rechazo y 3 uso.

**Historia y advertencias.** Antes de aplicar se cuentan —por actividad y grupo, sin nombres ni respuestas— borradores (`en_progreso`), enviados y anulados. Con esa información se emiten advertencias que **nunca bloquean**: `ACTIVITY_NOT_ACTIVE` (actividad en borrador), `DISABLE_WITH_DRAFTS`, `DISABLE_WITH_SUBMITTED`, `OPENING_IN_FUTURE_WITH_DRAFTS`, `REOPENING_CLOSED_ASSIGNMENT`, `CLOSING_EARLY_WITH_DRAFTS` y `WINDOW_REMOVED_WITH_HISTORY`. Cerrar o deshabilitar una asignación **sólo impide intentos nuevos**: un borrador ya existente sigue pudiendo responderse y entregarse. Ese es el comportamiento actual de D1 y se documenta como **intencional** de 6C; no hay flag adicional para deshabilitar con historia, y los intentos, respuestas, snapshots y calificaciones nunca se modifican. El pipeline **no borra** habilitaciones: deshabilitar es `enabled: false`.

**Seguridad.** El pipeline es exclusivamente local: no hay endpoint nuevo, ni sesión HTTP, ni React, ni escritura remota, y `worker/index.ts` no importa el módulo. Escribe únicamente `habilitaciones_actividad`, en una sola transacción `BEGIN IMMEDIATE` por archivo, con rollback completo ante cualquier fallo; antes del `COMMIT` verifica que exista exactamente una fila por actividad y grupo, que `enabled`/`opensAt`/`closesAt` coincidan con el documento, que actividad y grupo sigan en la misma edición anual, que `PRAGMA foreign_key_check` esté vacío, que ninguna de las once tablas ajenas (actividades, preguntas, intentos, respuestas, snapshots, calificaciones, grupos, usuarios, inscripciones, contenidos y publicaciones) haya cambiado y que la cantidad de habilitaciones no haya disminuido. La salida no contiene nombres, usuarios, documentos, respuestas, `grading`, claves privadas ni identificadores de envío: sólo códigos de grupo, fechas, booleanos, acciones, contadores y códigos de error, y hay una prueba que lo verifica.

**Custodia de asignaciones reales.** Los documentos reales viven fuera del repositorio y fuera de OneDrive: `%USERPROFILE%\profemacon-authoring-private\assignments\<asignatura>\<año>\<slug>.json` (por ejemplo `…\assignments\programacion-i\2026\variables-java-01.json`). No se versionan en Git, no entran a la carpeta sincronizada y no existe —ni debe crearse— una carpeta `assignments/` dentro del repositorio. Por eso `tests/private-activity-files.test.mjs` no necesitó cambios: la barrera sigue igual de estricta.

**Tests.** 19 pruebas puras del contrato y de la comparación (`tests/activity-assignment.test.ts`) y 2 de pipeline sobre una D1 temporal con las migraciones reales y datos ficticios (`tests/activity-assignment-pipeline.test.mjs`): validación sin abrir la base, simulación sin escritura, alta y actualización de varios grupos con ventanas UTC exactas, idempotencia sin tocar `creada_en`, los siete blockers sin escritura, advertencia de actividad en borrador, atomicidad, historia con borrador/enviado/anulado, reapertura con apertura futura, nunca DELETE, `foreign_key_check`, tablas ajenas intactas, salida sin datos personales ni privados, documento inválido, `maxAttempts` rechazado con mensaje de frontera, JSON roto, archivo inexistente y BOM UTF-8 tolerado. `npm test` queda en 77/77.

**Limitaciones (deudas, no fallos).** La misma ventana se puede cambiar desde la UI docente y desde el CLI —dos writers sobre las mismas columnas, last-write-wins— y no existe auditoría de cambios de ventana: no hay columna `actualizada_en` ni historial de cambios. Tampoco hay asignaciones reales versionadas, ni export del estado actual, ni `maxAttempts` por grupo, ni excepciones o prórrogas por estudiante, ni scheduler, notificaciones o publicación remota.

### 7.5. Hito 6D-A — Pipeline de autoría de materiales teóricos

**Estado: COMPLETO** (22 de septiembre de 2026).

**Filosofía.** El docente aporta sus fuentes —PDF, Word, apuntes, imágenes, enlaces, consignas y contenido previo—; una IA diseña pedagógicamente el material; el resultado se expresa en un contrato de autoría reproducible; Cline lo valida e instala; y recién después la plataforma lo muestra. No se construyó un editor visual tipo CMS: el material es **Markdown con assets versionados en Git** y el pipeline existe para garantizar que sea seguro, consistente y reproducible. 6D-A resuelve la autoría y la publicación local del material; el consumo automático desde la aplicación queda para 6D-B.

**Alcance de este corte.** Sin D1, sin endpoints, sin migraciones, sin cambios en React, `main.tsx`, `course-registry.ts`, sin `import.meta.glob`, sin rutas dinámicas, sin dependencias nuevas y **sin instalar todavía ningún material real**. Unidad 0 y Unidad 1 permanecen intactas como material legacy. Archivos del corte: `worker/material-authoring.ts` (módulo puro), `scripts/material-authoring.mjs` (CLI), `tests/material-authoring.test.ts`, `tests/material-authoring-pipeline.test.mjs`, `tests/private-material-files.test.mjs` y los dos scripts nuevos de `package.json`.

**Contrato v1: Markdown + frontmatter plano.** El material declara un frontmatter plano y estricto entre dos líneas `---`. Claves **obligatorias**: `schemaVersion` (entero, exactamente `1`), `slug` (3 a 64 caracteres, `^[a-z0-9]+(?:-[a-z0-9]+)*$`), `title` (3 a 140), `unitCode` (`unidad-<número>`, 1 o 2 dígitos) y `order` (entero 1 a 99). Claves **opcionales**: `summary` (hasta 300 caracteres), `unitTitle` (hasta 140; si aparece debe ser idéntico en todos los materiales de la unidad), `estimatedMinutes` (entero 5 a 600), `tags` (hasta 8, separadas por comas, normalizadas a minúsculas, con formato simple de palabra o palabra-con-guiones) y `authoring` (hasta 100 caracteres, con valor asumido `profe-macon-ai-workflow`). Cualquier otra clave es un error: **no existen** `edition`, `status`, `prerequisites`, `resources`, `version`, `createdAt`, `updatedAt` ni timestamps. El título principal del material proviene del frontmatter, por eso el cuerpo **no usa `#`**.

```markdown
---
schemaVersion: 1
slug: arreglos-introduccion
title: Arreglos y memoria contigua
unitCode: unidad-2
order: 1
summary: Qué es un arreglo, cómo se indexa y por qué el índice empieza en cero.
estimatedMinutes: 90
tags: java, arreglos, memoria
authoring: profe-macon-ai-workflow
---
```

**Parser propio y estricto.** Sin dependencias YAML. Tolerar BOM UTF-8 y finales de línea CRLF; exige la línea de apertura y la de cierre `---`; rechaza claves duplicadas (`DUPLICATE_KEY`), claves desconocidas (`UNKNOWN_KEY`), líneas indentadas o anidadas, listas YAML (`- x`, `[a, b]`), comillas, anclas y escalares multilínea (`MATERIAL_SCHEMA`), y un **segundo bloque de frontmatter** en cualquier parte del cuerpo (`DUPLICATE_FRONTMATTER`). Cada observación lleva `severity`, `code`, `path` y `message`, con la ruta expresada sobre el frontmatter (por ejemplo `frontmatter.slug`) o sobre el cuerpo (`body[12]`).

**Seguridad del cuerpo.** Se rechazan el HTML arbitrario y los componentes React (`UNSAFE_CONTENT`), los comentarios HTML, los atributos `on*`, las directivas `import`/`export` de MDX y los `iframe`. Los enlaces sólo admiten `http:` y `https:` (más rutas internas sin esquema); se rechazan `javascript:`, `data:`, `vbscript:`, `file:`, los protocolos relativos `//` y los enlaces por referencia, que son sintaxis no soportada. El **código en línea** permite enseñar etiquetas —`` `<h1>` `` es texto, no markup— y el contenido de los **bloques cercados** es contenido de ejemplo legítimo: un bloque ` ```html ` con `<div>` es válido porque no es markup ejecutable. El `#` (h1) está prohibido en el cuerpo, un salto de nivel produce `HEADING_SKIP`, un encabezado vacío `HEADING_EMPTY` y dos encabezados con la misma ancla `DUPLICATE_HEADING`.

**Imágenes.** Convención única: `![alt](/materiales/<asignatura>/<unidad>/<slug>/<archivo>)`, que se corresponde con el destino físico `assets/materiales/<asignatura>/<unidad>/<slug>/<archivo>`. Extensiones admitidas: `webp`, `png`, `jpg`, `jpeg`, `svg` y `avif`. La ruta debe ser **same-origin** y vivir en la carpeta del material: se rechazan las URL externas, el traversal `..`, la doble barra, la barra invertida, las extensiones no admitidas y las rutas fuera de `/materiales/<asignatura>/<unidad>/<slug>/` (`IMAGE_INVALID`). Un `alt` vacío es error (`IMAGE_ALT_MISSING`); un `alt` de menos de 15 caracteres produce `IMAGE_ALT_WEAK`; una imagen de más de 400 KB, `IMAGE_HEAVY`; y un archivo presente en la carpeta del material que no se referencia, `IMAGE_ORPHAN`. **Los huérfanos nunca se borran automáticamente**: sólo se informan. El módulo puro no usa `fs`: recibe el índice de assets como contexto explícito, de modo que una fuente privada todavía sin instalar puede validarse contra su carpeta `img/`.


**Código.** Todo bloque cercado declara su lenguaje (`CODE_LANGUAGE_MISSING`). La whitelist es `java`, `javascript`, `typescript`, `sql`, `python`, `html`, `css`, `bash`, `json` y `text`, más los dos bloques declarativos `mermaid` y `youtube`; cualquier otro lenguaje es error (`CODE_LANGUAGE_UNSUPPORTED`). Un bloque de más de 80 líneas produce `CODE_BLOCK_LONG`. **No hay ejecución de código ni resaltado de sintaxis nuevo**: los bloques se muestran como texto, tal como ya hacen las unidades existentes.

**Mermaid.** Se admite el bloque ` ```mermaid ` con **validación estática** únicamente: no vacío, hasta 200 líneas, hasta 8 KB y primera palabra clave entre `flowchart`, `graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, `erDiagram`, `journey`, `gantt`, `pie`, `mindmap`, `quadrantChart`, `timeline` y `xychart` (`MERMAID_INVALID` en caso contrario). No se renderiza Mermaid en Node ni se agregan dependencias headless: la sintaxis profunda del diagrama se resuelve en el navegador. El render real reutilizará el componente `MermaidDiagram` existente y quedará cubierto en 6D-B.

**YouTube declarativo.** Bloque cercado con lenguaje `youtube` y contenido en pares `clave: valor`:

```text
id: iZTONYPJPs8
title: Recorrido de un arreglo en Java
description: Explicación opcional de una o dos líneas.
```

`id` es obligatorio y debe tener exactamente 11 caracteres `[A-Za-z0-9_-]`; `title` es obligatorio, entre 3 y 140 caracteres; `description` es opcional y admite hasta 300. Se rechazan la URL completa (`https://youtu.be/…`), las listas de reproducción, los parámetros de consulta (`?si=`, `&list=`), cualquier clave extra y las claves duplicadas (`YOUTUBE_INVALID`). Si falta `description` se emite la advertencia `VIDEO_WITHOUT_DESCRIPTION`. El parser queda disponible como `parseYoutubeBlock(...)` para que el renderer de 6D-B lo reutilice, y `VideoEmbed` no se modificó.

**Hash.** Convención única y documentada: **SHA-256 de los bytes UTF-8 del archivo tras retirar el BOM inicial y sin ninguna otra transformación** (en el código, `sha256Hex(stripBom(texto))`). El valor aparece en el informe del CLI junto al tamaño en bytes (`Hash SHA-256: … · … bytes`) y **no se persiste en D1**: sirve para trazabilidad —comparar origen y destino, y dejar constancia de qué versión se instaló— y es la base del modo `--check`.

**CLI.** Dos comandos y cinco flags, sin más:

```bash
npm run material:validate -- <archivo.md> [--json]
npm run material:install  -- <archivo.md> [--apply] [--with-images] [--force] [--check] [--json]
```

`--json` emite el informe estructurado (claves estables: `status`, `command`, `dryRun`, `check`, `source`, `contentPath`, `kind`, `material`, `hash`, `bytes`, `assets`, `actions`, `summary`, `drift`, `errors`, `warnings`, `notes`, `failures`). Las tres raíces se pueden redirigir con las variables de entorno `PROFEMACON_MATERIALS_ROOT`, `PROFEMACON_CONTENT_ROOT` y `PROFEMACON_ASSETS_ROOT`; son la costura que usan las pruebas para trabajar sobre directorios temporales y no constituyen flags nuevos.


**`material:validate`.** Sólo lee: nunca escribe. Verifica el contrato completo, el cuerpo, los enlaces y las imágenes; cruza la ruta con el frontmatter —la carpeta debe coincidir con `unitCode` y el nombre del archivo con `slug` (`UNIT_MISMATCH`, `SLUG_MISMATCH`, `CONTENT_PATH_INVALID`)—; comprueba la consistencia de `unitTitle` con los materiales ya instalados de la misma unidad (`UNIT_TITLE_MISMATCH`); y calcula el hash. Salidas: **0** válido (aunque haya advertencias), **1** error de validación, **2** rechazo por política o seguridad (`UNSAFE_CONTENT`, `UNSAFE_LINK`, `IMAGE_INVALID`) y **3** uso incorrecto (falta el archivo, comando o flag desconocidos).

**`material:install`.** La fuente esperada es `%USERPROFILE%\profemacon-authoring-private\materials\<subjectCode>\<unitCode>\<slug>\<slug>.md`, con las imágenes en la subcarpeta `img\` del mismo material. Destinos: `content/<subjectCode>/<unitCode>/<slug>.md` y `assets/materiales/<subjectCode>/<unitCode>/<slug>/`. Reglas: **simula por defecto** y sólo `--apply` escribe; `--with-images` copia las imágenes de `img\` (las de extensión no admitida se informan como nota `IMAGE_IGNORED` y no se copian); sin `--with-images`, cualquier imagen referenciada que no esté instalada **bloquea** la instalación completa (`IMAGES_NOT_INSTALLED`); nunca se borra nada; y jamás se escribe fuera de `content/` o `assets/materiales/` (cada destino se verifica con una comprobación de raíz y los nombres se validan con patrones estrictos).

**Idempotencia y conflictos.** Cada operación planificada se informa como `create`, `update`, `unchanged` o `conflict`. Una segunda ejecución idéntica queda en `unchanged` (sin reescrituras). Si el destino existe con **otro** contenido: sin `--force` se emite `TARGET_CONFLICT` y **no se escribe absolutamente nada**; con `--force` se permite la actualización. Nunca se sobrescribe en silencio.

**Atomicidad: la garantía real.** El pipeline valida todo, planifica todas las operaciones, escribe **todos** los temporales `<destino>.pm-material.tmp` en el directorio de destino y recién al final los renombra; si la preparación falla, elimina los temporales y no toca ningún destino. **No existe una transacción multiarchivo real y Windows no garantiza el reemplazo múltiple atómico**: si un renombrado falla, se informa archivo por archivo (`REPLACE_FAILED`) y se limpian los temporales restantes, sin borrar nunca un destino existente como rollback. El objetivo es evitar estado parcial durante la preparación y evitar residuos temporales, no simular una transacción compleja.

**`--check`.** `material:install <archivo> --check` no escribe nunca y detecta drift entre la fuente privada y el resultado instalado: material instalado distinto del origen, imagen faltante, imagen distinta o destino esperado ausente. Los estados del informe son `synced` (salida 0) y `drifted` (salida 2, con el detalle de cada diferencia).

**Barrera Git.** `tests/private-material-files.test.mjs` comprueba que no existan rutas privadas dentro del repositorio (`fuentes/`, `private/`, `materials/` en la raíz, `profemacon-authoring-private/`, `.private.*`), que ningún material publicado contenga `<script`, `<iframe`, `javascript:`, `vbscript:` ni `data:text/html`, que **cada material v1 parsee** con el contrato y que todas las imágenes referenciadas existan en `assets/`. La carpeta privada de autoría vive fuera del repositorio y fuera de OneDrive, y la barrera también lo verifica.

**Compatibilidad legacy.** Unidad 0 y Unidad 1 quedan intactas: su Markdown, sus `lesson.tsx`, sus videos, sus imágenes externas y los PNG huérfanos existentes no se tocaron ni se migraron. `detectMaterialDocumentKind(...)` e `isMaterialV1Document(...)` distinguen `material-v1`, `legacy-material` y `unknown`; la validación completa sólo se aplica a los archivos con `schemaVersion: 1`, y `material:validate` rechaza el material legacy con un mensaje explícito que aclara que no se migra automáticamente.


**Advertencias implementadas.** Doce advertencias objetivas y baratas, todas no bloqueantes: `MATERIAL_NO_INTRO` (el material no comienza con un párrafo), `MATERIAL_TOO_LONG` (más de 4 000 palabras o más de 250 líneas), `HEADING_SKIP` (salto de nivel), `HEADING_EMPTY`, `DUPLICATE_HEADING` (dos encabezados con la misma ancla), `TABLE_WITHOUT_HEADER`, `IMAGE_ALT_WEAK` (`alt` demasiado breve o excesivamente largo), `IMAGE_ORPHAN`, `IMAGE_HEAVY` (más de 400 KB), `CODE_BLOCK_LONG` (más de 80 líneas), `VIDEO_WITHOUT_DESCRIPTION` y `MANY_RESOURCES` (más de 12 imágenes o más de 6 videos). El validador **no** es un evaluador pedagógico: no opina sobre calidad, coherencia curricular ni estrategias didácticas. Además hay tres **notas** informativas, no advertencias: `AUTHORING_DEFAULT` (se asumió el autor por defecto), `ASSETS_INDEX_UNAVAILABLE` (se validó sin índice de assets) e `IMAGE_IGNORED` (una imagen de `img\` con extensión no admitida no se copió). Los rechazos propios de la instalación son errores: `IMAGES_NOT_INSTALLED`, `TARGET_CONFLICT` y `MATERIAL_DRIFT`, más los fallos de entrada/salida `INSTALL_FAILED` y `REPLACE_FAILED`.

**Tests.** 45 pruebas nuevas, todas verdes: 25 puras del contrato en `tests/material-authoring.test.ts` (frontmatter, cuerpo, seguridad, imágenes, código, Mermaid, YouTube, límites, anclas, hash determinista y consistencia de `unitTitle`); 15 de pipeline en `tests/material-authoring-pipeline.test.mjs` sobre directorios temporales —nunca sobre `content/`, `assets/` ni la carpeta privada reales— que cubren validación, salidas 0/1/2/3, simulación sin escritura, alta con `--apply`, idempotencia, never-delete, conflicto sin `--force`, actualización con `--force`, `IMAGES_NOT_INSTALLED`, `--check` sincronizado y con drift, fallo a mitad sin estado parcial ni temporales, no-escritura fuera de raíces, contrato del informe JSON y BOM; y 5 de barrera en `tests/private-material-files.test.mjs`. En la corrida de este corte `npm test` quedó en 122 pruebas —121 verdes, con el único fallo siendo el flake ambiental conocido `EPERM … rmSync` de un directorio temporal docente, que pasa aislado— y `npm run build` continuó limpio. El **flake `EPERM` no volvió a aparecer** en las corridas posteriores: la verificación final del cierre 6D-B (§7.6) fue 143/143 sin fallos, 0 flakes.

**Deudas y límites (no fallos).** `.pm-material.tmp` podría quedar como residuo sólo ante una caída anormal extrema del proceso y no está en `.gitignore`; `img\` se trata como carpeta plana, de modo que dos archivos con el mismo nombre en subcarpetas distintas colisionarían; el cruce de `unitTitle` con los hermanos omite silenciosamente un material hermano que no parsee; Mermaid no se valida en profundidad (la sintaxis real se resuelve en el navegador); la clasificación legacy es heurística; y falta todo el consumo automático —integración con el catálogo, `import.meta.glob`, página genérica, navegación, ruteo dinámico, render de Mermaid y YouTube y un material real de prueba— junto con la publicación por grupo. Nada de esto se implementa en 6D-A.


### 7.6. Hito 6D-B — Consumo automático de materiales

**Estado: COMPLETO** (23 de septiembre de 2026). Cierra el consumo automático de los materiales que instala 6D-A: un material v1 publicado en `content/` se descubre y se muestra en la aplicación **sin crear un `lesson.tsx` por material, sin registrar cada unidad y sin editar ninguna lista de rutas**. Sin D1, sin endpoints, sin migraciones, sin dependencias nuevas y sin cambios en el contrato de autoría.

**Objetivo y flujo completo.** El docente aporta sus fuentes; una IA diseña el material; el material se expresa en el contrato v1; el pipeline 6D-A lo valida e instala; y la plataforma lo muestra sola:

```text
ChatGPT / Gemini
      ↓ (diseño pedagógico)
Markdown + assets
      ↓ material:validate → material:install (dry-run) → --apply → --check
content/<asignatura>/<unidad>/<slug>.md
assets/materiales/<asignatura>/<unidad>/<slug>/<archivo>
      ↓ Vite: import.meta.glob lazy (un chunk por material)
material-registry.ts → material-registry-core.ts
      ↓ parseContentPath + parseMaterialDocument (contrato 6D-A)
/curso/<asignatura>
/curso/<asignatura>/<unidad>
/curso/<asignatura>/<unidad>/<slug>
      ↓ ReactMarkdown + remarkGfm
MermaidDiagram · VideoEmbed · imágenes same-origin · Markdown normal
```

Instalar **otro material v1 dentro de una unidad existente** no requiere editar TSX; instalar una **unidad v1 nueva bajo Programación I** tampoco. Agregar una **asignatura nueva** al consumo automático sí exige declararla en `course-registry.ts`: esa frontera sigue siendo explícita por seguridad, igual que el resto del catálogo.

**Contrato compartido.** `src/courses/material-consumption/material-contract.ts` es la única frontera entre el frontend y `worker/material-authoring.ts`. Reexporta únicamente lo que el consumo necesita (`parseMaterialDocument`, `parseContentPath`, `materialAssetPrefix`, `parseYoutubeBlock`, `anchorIdOf`, `SLUG_PATTERN`, `SUBJECT_CODE_PATTERN`, `UNIT_CODE_PATTERN` y los tipos asociados) con la extensión `.ts` explícita, para que el mismo módulo lo importen Vite y `node --test`. **No se duplica ninguna regla, patrón ni mensaje del contrato**, y el módulo puro no se movió a `shared/` (decisión mantenida). Como consecuencia aceptada, el parser completo entra al bundle del cliente (ver *Bundle* y *Deudas*). Requirió `allowImportingTsExtensions` en `tsconfig.app.json` (una línea; ya estaba activo en `tsconfig.node.json`).

**Descubrimiento.** `material-registry.ts` usa **un solo glob literal y perezoso**: `import.meta.glob<string>("/content/*/*/*.md", { query: "?raw", import: "default" })`. Sin `eager`, sin imports construidos desde la URL ni desde `subjectCode`/`unitCode`/`slug`: los parámetros de ruta sólo se consultan como claves del mapa que Vite fija en build time. `material-registry-core.ts` es puro (sin React, DOM, `import.meta` ni `fs`) y recibe ese mapa.

**Registry.** Descubre por claves sin ejecutar ningún loader (`listSubjects`, `hasSubject`, `listUnitCodes`, `listRefs`, `hasMaterial`); todo el índice vive en `Map`, de modo que `constructor`, `__proto__` o `toString` no devuelven nada; carga **sólo la unidad solicitada**; memoiza por material, por unidad y por asignatura (una segunda consulta no vuelve a leer el archivo ni a parsear); pasa `assets: null` al parser porque en el navegador no hay índice de assets (la nota `ASSETS_INDEX_UNAVAILABLE` se ignora en la UI); **excluye el material legacy** y **excluye los documentos inválidos**; aísla un loader caído (`status: "load-error"`) sin arrastrar al resto; y ordena por `order` y, ante empate, por slug.

**Ruteo.** Tres rutas genéricas nuevas: `/curso/:subjectCode`, `/curso/:subjectCode/:unitCode` y `/curso/:subjectCode/:unitCode/:slug`. `parseCourseRoute` reutiliza los patrones del contrato y rechaza segmentos extra, vacíos, barras dobles, `%`, `..`, mayúsculas, `_`, `:` y longitudes fuera de rango, sin aplicar `decodeURIComponent`. Las rutas legacy profundas (por ejemplo `/curso/programacion-i/unidad-1/actividad/variables-java-01`) quedan fuera del parser genérico porque tienen cuatro segmentos. El **deep-link y el F5 funcionan** porque `isSupportedPath(path)` —rutas exactas actuales ∪ rutas dinámicas docentes ∪ rutas de curso v1— se usa tanto al iniciar la aplicación como en `popstate`. Las **rutas legacy se evalúan primero** y dentro del bloque v1 el orden es material → unidad → curso. Una ruta bien formada pero inexistente **no redirige a Inicio**: muestra un estado neutro («Material no encontrado» + vuelta a Mis cursos) y **no refleja en pantalla el valor recibido**.

**Páginas genéricas.** `material-pages.tsx` contiene `MaterialCoursePage` (h1 «Materiales del curso», unidades v1 con `unitTitle`, «Unidad N», cantidad de materiales; vacío → «Todavía no hay materiales publicados para este curso.»), `MaterialUnitPage` (h1 = `unitTitle`, contexto asignatura·unidad, materiales ordenados con título, resumen, minutos y etiquetas, botón «Abrir material») y `MaterialPage` (contexto, h1 = `title`, `summary`, chips, índice generado desde `parsed.headings`, cuerpo renderizado, «← Volver a la unidad» y anterior/siguiente **sólo si existen**: con un único material no se inventan destinos). Estados de carga, error, vacío y no encontrado con `role="status"`/`role="alert"`, `aria-live` y `aria-label` en listas y navegaciones. Ninguna página conoce una asignatura, una unidad o un material en particular, y no se recalcula metadata con regex sobre el Markdown.

**Renderer Markdown.** `material-markdown.tsx` usa `ReactMarkdown` + `remarkGfm` (las mismas dependencias que las unidades legacy) con `skipHtml`, **sin** `rehype-raw`, **sin** `dangerouslySetInnerHTML` nuevo y **sin** resaltado de sintaxis ni ejecución de código. Los bloques cercados se interceptan desde `pre` (nunca se devuelve un `div` dentro de un `pre`): `mermaid` → `MermaidDiagram`; `youtube` → `parseYoutubeBlock` → `VideoEmbed`; cualquier otro lenguaje → `pre/code` normal. Los encabezados `h2`/`h3`/`h4` no cambian de nivel y sus anclas salen de `anchorIdOf` (el mismo algoritmo que usa el parser para el índice, así índice y render coinciden). Los enlaces sólo admiten `#ancla` (misma pestaña) y `http(s)` con `target="_blank"` y `rel="noreferrer"`; cualquier otro `href` no crea enlace y deja sólo el texto. `urlTransform` restringe además las URL al ancla, a `http(s)` y —sólo para `src`— al prefijo de assets del material.

**Mermaid y YouTube.** `MermaidDiagram` se reutiliza **sin modificarlo**: recibe el contenido del bloque sin el newline final y el tema actual de la aplicación, mantiene `securityLevel: "strict"` y su id por instancia, y ante un error de sintaxis conserva su degradación a `<pre class="diagram-fallback">`. El bundle de Mermaid sigue entrando por import dinámico, así que sólo se descarga en materiales que tienen diagrama. `VideoEmbed` también se reutiliza sin cambios: `youtubeId = id` del bloque, `id` accesible `youtube-<id>` y `description ?? ""`; un bloque inválido no produce iframe. El soporte de YouTube es genérico y está cubierto por pruebas puras, aunque **el material piloto no incluye video** porque no existe todavía un video real y pedagógicamente aprobado sobre arreglos.

**Imágenes.** Renderer defensivo: sólo se acepta un `src` que sea string y empiece exactamente con el `assetPrefix` del material (`/materiales/<asignatura>/<unidad>/<slug>/`). React Markdown envuelve una imagen suelta en un párrafo, así que el render usa elementos **en línea** (`span.material-figure` + `<img loading="lazy" decoding="async">` con `alt` obligatorio y `span.material-figure-caption` opcional) y nunca `figure`, `p` ni `div` anidados: un `figure` dentro de un `p` es HTML inválido y produce errores de React. Ese defecto se detectó y se corrigió en la verificación del cierre, y quedó cubierto por una aserción del E2E que vigila el marcado real y los errores de anidamiento de React. Si la carga falla, se muestra un aviso textual que **conserva el `alt`**, porque el fallback de página única de Cloudflare puede devolver `index.html` con `200` ante un asset inexistente y una imagen rota sería un hueco mudo. El material v1 nunca acepta imágenes externas.

**Navegación desde Mis cursos.** `course-registry.ts` mantiene el registro explícito y suma `materialEntryPath`. Programación I conserva `entryPath = /curso/programacion-i/unidad-0` («Abrir curso» → Unidad 0 legacy) y agrega `materialEntryPath = /curso/programacion-i` («Ver materiales»). `materialEntryPath` **no se deriva del glob**: el índice también ve los Markdown legacy de Unidad 0 y Unidad 1 y la autorización a nivel de curso sigue siendo explícita; lo dinámico empieza en unidades y materiales. Un curso desconocido o sin `materialEntryPath` no obtiene botón ni ruta inventada, y `getCourseContent` conserva su protección `Object.hasOwn`.

**Compatibilidad legacy.** Unidad 0 y Unidad 1 quedan **intactas**: sus `lesson.tsx`, su Markdown, sus videos y sus imágenes no se tocaron ni se migraron. Sus cuatro rutas exactas se evalúan **antes** del router v1 y no dependen del registry. El glob puede descubrir sus Markdown, pero `parseMaterialDocument` los clasifica como `legacy-material`, no entran al catálogo v1 y no rompen `loadSubject`/`loadUnit`. Una futura colisión (un material v1 dentro de `unidad-0` o `unidad-1`) queda fuera de este corte: la ruta de unidad legacy seguiría ganando y el material se alcanzaría sólo por su URL propia.

**Material piloto.** `content/programacion-i/unidad-2/arreglos-introduccion.md` — «Arreglos: un nombre para muchos datos», `unitTitle: Arreglos`, `order: 1`, `estimatedMinutes: 45`, `tags: java, arreglos, índices`; 60 líneas / 291 palabras con Markdown, lista, blockquote, dos bloques `java`, una imagen same-origin y un Mermaid `flowchart LR`, sin YouTube. Asset: `assets/materiales/programacion-i/unidad-2/arreglos-introduccion/01-indices.svg`. Es **autoría pedagógica aprobada**: no se reescribió ni se amplió. Se creó primero en la carpeta privada `%USERPROFILE%\profemacon-authoring-private\materials\programacion-i\unidad-2\arreglos-introduccion\` y se instaló con el pipeline 6D-A: `material:validate` → `material:install --with-images` (simulación: 2 crear) → `material:install --with-images --apply` → `material:install --with-images --check` (**synced**, 2 sin cambios). **No se escribió manualmente** en `content/` ni en `assets/`.

**Cifras de la corrida final.** `material:validate` (archivo instalado): `validated`, hash SHA-256 `3550d6d87b2b6e945cf39ad2f76039c28cd9febbee476815df2b6e7100a23ff8`, 2 644 bytes, 1 imagen referenciada e instalada. `npm test`: **143 pruebas, 143 aprobadas, 0 fallos, 0 flakes**. `tsc -b` y `npm run build` limpios. Bundle: el chunk principal pasa de 144,68 kB a **156,74 kB gzip** (+12,1 kB por el parser/contrato compartido y las páginas nuevas) y el material piloto queda en un **chunk perezoso propio de ~2,8 kB**, fuera del bundle inicial. E2E `material-consumption`: **14 casos por proyecto, 28 ejecuciones, todas aprobadas** (escritorio y móvil). E2E `my-courses`: 18 escenarios por proyecto, 36 casos aprobados, con «Abrir curso» y «Ver materiales». Suite E2E completa: 220 aprobados, 2 omitidos y **6 diferencias visuales preexistentes** (`toHaveScreenshot` de activación e importación) que ya estaban documentadas: se comprobó con los cambios apartados que son idénticas sin 6D-B (mismos pixeles y mismas dimensiones) y **no se regeneró ningún snapshot**. El flake `EPERM` de Windows no apareció.

**Deudas y límites (no fallos).** La publicación de materiales por grupo y edición queda pendiente (etapa posterior, sobre `contenidos`, `versiones_contenido` y `publicaciones_contenido`); `materialEntryPath` es explícito por asignatura, así que un curso nuevo se declara a mano; el parser completo del contrato entra al bundle del cliente para no duplicar reglas (aumento aceptado conscientemente, no se optimiza ahora); Vite emite un aviso benigno porque los dos Markdown legacy se importan de forma estática y dinámica a la vez (ya viajaban en el chunk principal por las lecciones legacy y nunca entran al catálogo v1); pedir la metadata de una unidad implica leer los materiales de esa unidad (memoizado); el frontend no comprueba la existencia física de los assets (la garantizan el pipeline y la barrera `private-material-files`); no hay restauración de scroll entre rutas ni `aria-current` en el índice; y la carpeta se llama `src/courses/material-consumption/` y no `src/courses/materials/` porque `tests/private-material-files.test.mjs` interpreta cualquier segmento `materials/` como ruta privada sensible: se mantuvo la barrera sin debilitarla y se renombró el código. `MermaidDiagram` no se modificó: su bundle dinámico (~600 kB en desarrollo) puede tardar más de 45 s bajo la contención de la suite completa en esta máquina (servidor Vite frío con seis workers sobre una carpeta sincronizada), así que el caso E2E espera hasta 90 s e informa explícitamente el desenlace (`svg`, `fallback` o `timeout`); en las corridas focalizadas el diagrama se dibuja siempre en uno o dos segundos y una prueba de diagnóstico con el chunk retrasado a propósito confirmó que el render no depende de la velocidad de carga.

## 8. Estado de la D1 local


Las migraciones `0001` a `0010` están disponibles y se verifican sobre D1 local limpia. La semilla aporta dos perfiles, una asignatura y un grupo de demostración; las pruebas de integración agregan una tercera cuenta y lotes, activaciones y eventos de auditoría exclusivamente ficticios. Esas cantidades pueden aumentar al repetir las comprobaciones y no deben tratarse como datos de referencia. Cada recorrido cierra su sesión al terminar.

También están cargados localmente una actividad con 12 preguntas y sus claves privadas de corrección, una habilitación y un contenido versionado publicado. No existen intentos académicos reales y nunca se aplicó el portafolio real de referencia.

La semilla local incorpora dos perfiles ficticios:

- `estudiante.demo`, rol estudiante;
- `ana.docente`, rol docente.

Los códigos ficticios de activación están documentados en `README.md` y en la propia semilla. Nunca deben copiarse a una base remota.

No hay estudiantes, documentos, credenciales ni resultados reales en el repositorio o la D1 local conocida.

## 9. Verificaciones realizadas

La implementación actual superó las siguientes comprobaciones:

- compilación TypeScript y build de Vite;
- aplicación de las diez migraciones locales (`0001` a `0010`);
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
- 36 pruebas automatizadas aprobadas, incluidas criptografía, importación, activaciones, corrector de actividades, resultados docentes por grupo, por actividad y por estudiante, detalle docente de intentos y respuestas, y barrera contra claves privadas;
- migraciones completas aplicadas sobre una D1 local limpia y pruebas de persistencia aprobadas, incluida una competencia simultánea donde D1 acepta un solo cupo y rechaza el otro por `maximo_intentos`;
- build de producción aprobado con los endpoints de previsualización y aplicación;
- recorrido HTTP ficticio aprobado: autenticación docente, previsualización, aplicación, devolución única de activación, rechazo del lote repetido y cierre de sesión.
- política versionada de contraseñas probada en Node y en workerd real: creación siempre con 100.000 iteraciones, verificación de credenciales históricas de 50.000 y 75.000, rechazo tipado de 49.999 y 100.001, y comprobación semántica de que no hay clamp ni una segunda derivación en el login (`tests/auth-crypto.test.ts`, `tests/auth-crypto-policy.test.ts`, `tests/auth-policy-contract.test.ts`, `tests/local-auth-flow.test.mjs`).
- flujo de autenticación completo contra `wrangler dev` real y D1 temporal: activación, cookie `HttpOnly`/`SameSite=Strict`/`Path=/`, código reutilizado, contraseña incorrecta y usuario inexistente con `401` y nunca `500`, sesión, logout y `401` posterior, sin ninguna falla de PBKDF2 en la salida del runtime.
- migración `0011` probada sobre D1 local: rango `50000`–`100000` aplicado, `formato` con `DEFAULT 'v1'`, inventario de tablas, índices y disparadores sin cambios, `PRAGMA foreign_key_check` sin violaciones, rechazo ruidoso de una credencial antigua de 600000 sin pérdida de la fila y recuperación posterior tras limpiarla.
- fallo cerrado comprobado de punta a punta: con una credencial fuera de política persistida en una D1 de prueba, el login responde `500` saneado sin `Set-Cookie`, no incrementa intentos fallidos, no bloquea la cuenta y no crea sesión.
- fallback de aplicación de página única corregido y verificado con workerd real (`tests/local-routing.test.mjs`): las rutas de interfaz (`/`, `/curso/programacion-i` y una ruta inexistente) devuelven el shell con `200`, `text/html` y **sin `Location`**, tanto para una navegación HTML como para un pedido con `Accept: application/json`; los assets reales se sirven con su tipo; y las rutas `/api/*` conservan la semántica de API y nunca devuelven la SPA. La causa era `worker/index.ts`, que reescribía el fallback a `/index.html`: esa ruta no es canónica con el `html_handling` por defecto (`auto-trailing-slash`) y el servidor de assets respondía `307` hacia `/`. Ahora se sirve la entrada canónica `/`.

El portafolio real de referencia continúa produciendo una previsualización agregada de 19 filas válidas, cero filas inválidas, cero documentos duplicados y cero colisiones en las bases de usuario. Esa comprobación no imprime nombres ni documentos y no aplica el archivo a D1.

`tests/e2e/my-courses.spec.ts` cubre el catálogo autenticado, los estados de sesión, roles, contenido conocido y desconocido, errores, reintentos, la entrada al índice de materiales del cierre 6D-B —«Abrir curso» hacia Unidad 0 legacy y «Ver materiales» hacia `/curso/programacion-i`, sin botón ni ruta inventada para un curso desconocido— y ausencia de desbordamiento. Sus 18 escenarios pasan en escritorio y móvil: 36 casos aprobados. Las seis diferencias visuales preexistentes del resto de Playwright continúan pendientes de revisión y sus snapshots no fueron actualizados. Las capturas existentes contienen sólo estados e identidades ficticias; la prueba con el portafolio real no genera captura, traza ni video.

La verificación final del cierre 6D-B (§7.6) dejó además: `npm test` en **143/143, sin fallos y sin el flake `EPERM`**; `tsc -b` y `npm run build` limpios; `tests/e2e/material-consumption.spec.ts` con **14 casos por proyecto, 28 ejecuciones aprobadas**; la suite E2E completa con 220 aprobados, 2 omitidos y las seis diferencias visuales preexistentes (idénticas sin 6D-B, sin regenerar snapshots); `material:validate` sobre el material piloto instalado en estado `validated` con hash SHA-256 propio y su imagen existente bajo `assets/materiales/`; `material:install --with-images --check` en estado `synced`; y `git diff --check` sin errores de espacios.

La integración local contra D1 reemitió dos códigos sucesivos para una cuenta ficticia, comprobó que el primero fuese rechazado inmediatamente después de la segunda emisión y confirmó que una cuenta con contraseña ya no admite reemisión. La salida de la prueba contiene sólo contadores y estados agregados.

`tests/student-activity.test.mjs` verifica con Worker y D1 local el GET seguro, la creación y recuperación idempotente de borradores, el guardado y envío de respuestas, la revisión final autorizada, el aislamiento por usuario, grupo, actividad y habilitación, y la separación entre respuestas públicas normales y soluciones de revisión. Las claves ficticias se transforman sólo dentro del endpoint de revisión.

## 10. Seguridad y privacidad pendientes

Antes de utilizar datos reales se debe completar:

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

- Las preguntas y respuestas históricas de la Actividad 0 estuvieron versionadas y deben considerarse comprometidas. La autocorrección y las soluciones fueron retiradas del bundle actual, pero esas preguntas no deben reutilizarse como actividad evaluativa cuya seguridad dependa de mantener oculta la corrección.
- Las rutas internas estáticas de las unidades todavía no están protegidas por pertenencia al catálogo; fue una decisión consciente fuera del alcance del Hito 3.
- Los contenidos no están filtrados por publicación/grupo.
- Los componentes de presentación de preguntas no dependen de D1 ni de roles, y ya se reutilizan por el modo prueba docente con una estrategia sin persistencia académica.
- No existe todavía un editor de contenido ni de preguntas; la entrada actual al modo prueba es deliberadamente mínima.
- No hay flujo de restablecimiento de contraseña.
- El factor de trabajo de contraseñas está limitado por la plataforma: el runtime de Cloudflare rechaza más de 100.000 iteraciones de PBKDF2, así que el costo efectivo queda por debajo de la recomendación OWASP (600.000 para PBKDF2-HMAC-SHA-256). La cobertura depende de la longitud mínima de 12 caracteres, del bloqueo tras cinco fallos y de la limitación de frecuencia por origen, que sigue pendiente.
- No hay rehash al iniciar sesión: la política lo deja desactivado hasta medir el `cpuTime` real de 100.000 iteraciones en Workers (A2).
- Una credencial por debajo del mínimo verificable falla cerrada y exige una intervención administrativa que todavía no existe, porque el restablecimiento de contraseña sigue sin implementarse.
- El login de una cuenta bloqueada responde sin derivar PBKDF2, así que su tiempo difiere del de una contraseña incorrecta; es una diferencia preexistente que se resolverá junto con la limitación de frecuencia.
- El importador tiene API, pantalla administrativa y cobertura de navegador para el estado inicial y la entrega individual; falta una prueba de integración real de todas las etapas contra D1.
- El panel docente existe de forma parcial: listado y resumen de grupos, actividades con habilitaciones, matriz de resultados por grupo (C1), detalle de una actividad para todo el grupo (C2), detalle de un estudiante a través de todas las actividades (C3) y detalle de intentos y respuestas de un estudiante en una actividad (C4), todos de sólo lectura. Todavía no permite editar contenido ni preguntas, no incluye acciones administrativas sobre intentos y el panel de practicante sigue pendiente.
- Hay pruebas automatizadas para criptografía, lectura del portafolio y preparación del lote, pero todavía no existe un script de lint ni pruebas de integración completas para los endpoints del importador.
- Mermaid genera fragmentos grandes durante el build; es una advertencia de rendimiento, no un error funcional.
- `npm audit` informa 11 avisos en la cadena preexistente de herramientas de Cloudflare y Mermaid (7 altos y 4 moderados al 17 de septiembre de 2026). Las dependencias nuevas del lector XLSX no aparecen afectadas. Se debe actualizar y volver a probar esa cadena antes de un despliegue real.
- Wrangler intenta escribir registros bajo el perfil del usuario y puede mostrar advertencias de permisos dentro del entorno restringido. Las operaciones locales se completan igualmente.
- La tabla de identidades Google de `0003` quedó como estructura no utilizada y deberá evaluarse antes de consolidar el esquema definitivo.
- El render de recursos del Hito 6B (§7.3) está acotado a `image` y `code` en la actividad del estudiante y en el modo prueba docente: la revisión final del estudiante y el detalle docente C4 todavía no muestran recursos, las imágenes reales deben existir bajo el `publicDir` de Vite, no se declaran `width`/`height` (una imagen diferida puede producir un desplazamiento menor) y no hay resaltado de sintaxis, zoom, galería ni copiado.
- La asignación de actividades del Hito 6C (§7.4) tiene dos writers sobre la misma ventana —la UI docente y el CLI— con last-write-wins, y no deja auditoría: no hay columna `actualizada_en` ni historial de cambios de ventana. Tampoco existen asignaciones reales versionadas, export del estado actual, `maxAttempts` por grupo, excepciones o prórrogas por estudiante, ni scheduler, notificaciones o publicación remota.
- El consumo automático de materiales del Hito 6D-B (§7.6) es público dentro de la aplicación, igual que las unidades legacy: todavía no existe publicación por grupo ni por edición. `materialEntryPath` se declara explícitamente por asignatura, el parser completo del contrato viaja en el bundle del cliente para no duplicar reglas, la metadata de una unidad implica leer los materiales de esa unidad (memoizado), los assets no se comprueban con índice en runtime, no hay restauración de scroll ni `aria-current`, y persiste un aviso benigno de Vite por los dos Markdown legacy importados de forma estática y dinámica. Nada de esto se resuelve ahora.

## 12. Dirección acordada

El orden recomendado es el siguiente.

### Hito 1 — Consolidar la base actual

- Completado: revisar y eliminar archivos legados.
- Completado: crear pruebas mínimas de criptografía de autenticación.
- Completado: confirmar en Git el bloque actual.
- Pendiente: hacer revisión visual de ingreso/activación.
- Completado: instalar Playwright y revisar el importador en escritorio y móvil.

### Hito 2 — Importación controlada de estudiantes

- Completado: reconocer el formato de portafolio y el grupo desde el nombre del archivo.
- Completado: separar nombre y apellido e ignorar nacimiento y carné de salud.
- Completado: previsualizar y validar sin mostrar datos personales.
- Completado: definir el nombre de usuario con una base legible y 12 caracteres derivados del HMAC.
- Completado: vincular etiquetas de origen con grupos internos mediante un mapeo explícito.
- Completado: detectar duplicados, colisiones y posibles cuentas existentes.
- Completado: aplicar usuarios, roles, documentos, inscripciones, activaciones y auditoría mediante un lote transaccional.
- Completado: generar códigos de activación aleatorios y guardar solamente sus hashes.
- Completado: construir la interfaz administrativa de carga, revisión y doble confirmación.
- Completado: entregar cada acceso mediante copia individual o ficha imprimible y retirar los códigos de la memoria al finalizar.
- Completado: revocar y reemitir una activación perdida o vencida sólo para cuentas todavía sin contraseña y dentro del alcance docente.
- Pendiente: implementar la operación administrativa que agrega una nueva cédula a quien estaba registrado con pasaporte, sin crear otra cuenta. El esquema ya permite conservar ambos documentos.

### Hito 3 — Catálogo autenticado

- Completado: consumir `/api/me/courses` desde React.
- Completado: mostrar cursos, grupos y accesos reales de la sesión.
- Completado: gestionar comprobación de sesión, carga, errores, reintentos, sesión vencida y ausencia de cursos.
- Completado: vincular códigos conocidos con contenido mediante un registro explícito sin construir rutas desde datos de la API.
- Completado: cubrir el catálogo en Playwright para escritorio y móvil.

### Hito 4 — Actividad 1 completa

- Completado: sanear la Actividad 0 histórica y retirar sus respuestas del bundle actual.
- Completado: crear el corrector estricto, la migración de entregas seguras y sus pruebas unitarias y locales contra D1.
- Completado: implementar GET seguro de actividad, sin información privada.
- Completado: implementar la creación y recuperación idempotente del intento y el guardado de respuestas en borrador.
- Completado: persistir snapshots inmutables de preguntas por intento.
- Completado: implementar `submit` idempotente, con autocorrección desde snapshots y persistencia atómica sin devolver respuestas correctas.
- Completado: implementar GET separado de revisión final, autorizado y basado en snapshots.
- Completado: construir frontend funcional genérico de actividad, con borrador, persistencia, entrega, resultado y revisión autorizada.
- Completado: modo prueba docente sin persistencia académica, reutilizando los renderizadores de preguntas y el corrector del Worker.
- Verificar las claves contra Neon antes de cualquier piloto real.

### Hito 5 — Panel docente mínimo

- Completado: alcance docente centralizado por grupo, listado real y resumen mínimo de grupos asignados.
- Completado (Bloque B): actividades por grupo y habilitaciones, con backend y frontend verificados por pruebas Worker/D1 y E2E.
- Completado (Bloque C, C1): matriz de resultados del grupo, con backend y frontend verificados por pruebas Worker/D1 y E2E.
- Completado (Bloque C, C2): detalle de una actividad para todo el grupo, con resumen numérico (promedio y mediana), tabla de estudiantes por mejor intento y orden local, con backend y frontend verificados por pruebas Worker/D1 y E2E.
- Completado (Bloque C, C3): detalle de un estudiante a través de todas sus actividades, con resumen numérico, tabla semántica por actividad y evolución de los intentos enviados, con backend y frontend verificados por pruebas Worker/D1 y E2E.
- Completado (Bloque C, C4): detalle de los intentos y las respuestas de un estudiante en una actividad, con resumen, selector de intentos enviados, respuestas pregunta por pregunta, anulados en colección separada y borrador sólo informado, con backend y frontend verificados por pruebas Worker/D1 y E2E. Con este corte el Bloque C y el alcance mínimo del Hito 5 quedan completos; la edición de contenido y preguntas permanece pendiente.

El Hito 5 comenzó con `requireTeacherGroupScope`: cada consulta docente exige sesión, rol `docente`, grupo existente y activo, asignación docente activa y, si hay actividad, coincidencia de edición anual. `groupId` interno se usa sólo como selector de routing, nunca como autorización. `GET /api/teacher/groups` lista únicamente los grupos autorizados y `GET /api/teacher/groups/:groupId` reutiliza el mismo alcance. `/docente` muestra la lista real y `/docente/grupos/:groupId` su resumen mínimo. El preview docente también rechaza un `groupCode` de otra edición.

El Bloque B está implementado y verificado. `GET /api/teacher/groups/:groupId/activities` lista las actividades de la misma edición anual, incluso sin habilitación, y devuelve sólo metadatos públicos, estado temporal (`disabled`, `not_open`, `closed`, `available`) calculado por D1 y participantes únicos (estudiantes distintos con intentos ligados a la habilitación). `PUT /api/teacher/groups/:groupId/activities/:activityId/availability` crea o actualiza idempotentemente la habilitación, exige rol docente, grupo autorizado y actividad de la misma edición, valida fechas ISO UTC con la regla apertura < cierre y requiere Origin válido. `/docente/grupos/:groupId/actividades` permite configurar habilitación, apertura y cierre con guardado explícito, pide confirmación al deshabilitar una actividad habilitada y muestra las fechas en hora local (persistidas en UTC). `maximo_intentos` se mantiene deliberadamente como sólo lectura para no alterar intentos históricos sin una política académica explícita. El modo prueba docente reutiliza el preview existente y puede abrirse de forma contextual desde el listado, heredando el grupo vía `sessionStorage`. Las APIs heredan `Cache-Control: no-store`.

El Bloque C tiene implementados y verificados sus cortes C1, C2, C3 y C4. C1 expone `GET /api/teacher/groups/:groupId/results`: es de sólo lectura, usa `requireTeacherGroupScope` y devuelve `group`, `activities`, `students` y `cells`. Las actividades son las de la misma edición anual del grupo, incluso sin habilitación. Los estudiantes son los activos con inscripción activa y rol `estudiante`. `cells` contiene una celda explícita por cada combinación estudiante × actividad con `best` (o `null`), `attemptsUsed`, `hasDraft` y `lastSubmittedAt`. El `best` se elige únicamente entre intentos `enviado`, con el mismo desempate que ya usa el resto del sistema: porcentaje descendente, puntaje descendente y fecha de envío ascendente. El `judgment` se lee tal cual de `intentos_actividad`: no se recalcula ni se aplican umbrales en el endpoint. Los borradores sólo informan `hasDraft` y nunca compiten como mejor resultado; los intentos anulados no cuentan para `attemptsUsed` ni para el mejor. La respuesta no incluye umbrales, claves, respuestas, snapshots privados ni estructuras de corrección, y hereda `Cache-Control: no-store`. El frontend `/docente/grupos/:groupId/resultados` presenta una matriz semántica (filas = estudiantes, columnas = actividades) con el porcentaje visible y el juicio textual; el color se deriva del `judgment` recibido y nunca de un cálculo de porcentaje en React. Cuando coexisten un mejor intento y un borrador se conserva el juicio y se muestra un indicador secundario de borrador. Las celdas distinguen sin intento, en progreso, `inicial`, `en_proceso` y `logrado`, con etiqueta accesible por celda y scroll horizontal controlado en pantallas angostas. Cada encabezado de actividad de la matriz abre el detalle C2.

C2 —`GET /api/teacher/groups/:groupId/activities/:activityId/results`— es el detalle de una única actividad para todo el grupo. Es de sólo lectura y usa `requireTeacherGroupScope` con `activityId`, así que además de sesión, rol docente, grupo existente y activo y asignación docente activa exige que la actividad pertenezca a la misma edición anual del grupo. Devuelve `group`, `activity`, `summary` y `students`. `activity` se informa siempre que la actividad pertenezca a la edición, incluso cuando su disponibilidad es `disabled`, `not_open` o `closed`: el alcance no depende de la habilitación. `summary` trae los conteos mutuamente excluyentes `withoutAttempt`, `inProgress`, `inicial`, `en_proceso` y `logrado`, cuya suma equivale a `totalStudents`, más `averageBestPercentage` y `medianBestPercentage`, calculados únicamente sobre los mejores intentos `enviado` y redondeados a un decimal; si no hay envíos, ambos son `null`. Cada fila de `students` trae `displayName`, `username`, `best` (o `null`), `attemptsUsed`, `hasDraft` y `lastSubmittedAt`, con el mismo criterio de mejor intento y el mismo `judgment` persistido que C1: un borrador nunca compite como mejor resultado (`attemptsUsed` incluye enviados y borradores y excluye anulados) y el juicio no se recalcula ni se derivan umbrales en el endpoint. Cuando coexisten un mejor intento y un borrador, la fila conserva el `judgment` del mejor y el borrador queda como dato secundario. La respuesta no incluye claves, respuestas, snapshots, correcciones, umbrales ni documentos, y hereda `Cache-Control: no-store`.

El frontend `/docente/grupos/:groupId/actividades/:activityId/resultados` se abre desde el encabezado de cada actividad de la matriz y ofrece un botón para volver a ella. Muestra grupo, asignatura, actividad y estado de disponibilidad, ocho indicadores numéricos —total, sin intento, en progreso, inicial, en proceso, logrado, promedio y mediana— consumidos del backend sin que React recalcule nada (`—` cuando el backend devuelve `null`) y una tabla semántica por estudiante con mejor resultado, estado textual, intentos usados con pluralización, borrador y último envío en hora local. El orden se resuelve sólo en React —nombre A–Z por defecto, resultado menor→mayor y resultado mayor→menor— sin repetir consultas al backend, y los estudiantes sin mejor intento quedan siempre al final en ambos sentidos.
C3 —`GET /api/teacher/groups/:groupId/students/:studentId/results`— es el detalle de un estudiante a través de todas las actividades de su grupo. Es de sólo lectura y usa `requireTeacherGroupStudentScope`, que exige sesión, rol `docente`, grupo existente y activo, asignación docente activa y, dentro de ese grupo, estudiante activo con inscripción activa y rol `estudiante`; un estudiante de otro grupo responde `403 TEACHER_GROUP_REQUIRED` y un identificador inexistente `404 STUDENT_NOT_FOUND`. `studentId` es sólo selector de routing: nunca autoriza por sí mismo y el error no revela pertenencia. Devuelve `group`, `student`, `summary` y `activities[]`. `summary` trae `totalActivities`, los conteos mutuamente excluyentes `withoutAttempt`, `inProgress`, `inicial`, `en_proceso` y `logrado` —cuya suma equivale a `totalActivities`— y `averageBestPercentage` y `medianBestPercentage`, calculados únicamente sobre las actividades con al menos un intento enviado (`null` si no hay ninguno) y redondeados a un decimal. Cada fila de `activities[]` informa `activityId`, `slug`, `title`, `unitCode`, `editorialState`, disponibilidad (`disabled`, `not_open`, `closed`, `available`), `maxAttempts`, `best` (o `null`), `attemptsUsed`, `hasDraft`, `lastSubmittedAt` y `submittedAttempts`: la secuencia cronológica completa de intentos `enviado` con `ordinal`, `percentage`, `judgment` y `submittedAt`, ordenada por fecha de envío y luego por id (nunca por ordinal, que puede reutilizarse tras una anulación). Las reglas académicas son las mismas que en C1/C2: el `judgment` se lee persistido de `intentos_actividad` y no se recalcula, no se derivan umbrales, los intentos anulados quedan excluidos de `attemptsUsed`, del mejor intento y de la secuencia, y los borradores no compiten como mejor resultado. Cuando coexisten un mejor intento y un borrador se conserva el juicio del best y el borrador queda como dato secundario. La respuesta no incluye respuestas, respuestas correctas, claves, snapshots privados, documentos, `submissionId` ni umbrales, y hereda `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.

El frontend `/docente/grupos/:groupId/estudiantes/:studentId/resultados` cambia el eje de C2: una fila por actividad. Se abre haciendo click en el nombre del estudiante tanto desde la matriz del grupo (C1) como desde el detalle de una actividad (C2), y el botón de volver regresa siempre a la matriz. Muestra el encabezado del estudiante —nombre visible, usuario, grupo, asignatura, edición, año y total de actividades—, ocho indicadores numéricos (total de actividades, sin intento, en progreso, inicial, en proceso, logrado, promedio y mediana) consumidos del backend sin que React recalcule promedio, mediana ni juicio, y una tabla semántica con disponibilidad, mejor resultado, estado textual, intentos usados respecto del máximo, borrador, último envío en hora local y evolución completa de los envíos (`42 % → 83 %`). La evolución se muestra tal como llegó, sin resumir, sin marcar el mejor intento y sin interpretaciones pedagógicas, con una etiqueta accesible que la describe en palabras. El orden se resuelve sólo en React —natural según lo recibido, resultado menor→mayor y resultado mayor→menor— sin repetir consultas, y las actividades sin mejor intento quedan siempre al final en ambos órdenes. C3 abre el detalle de intentos y respuestas (C4) haciendo click en el nombre de la actividad, y el botón de volver de C4 regresa siempre a C3. La edición de contenido y preguntas sigue pendiente.

C4 queda implementado y verificado, y con él se cierra el Bloque C. `GET /api/teacher/groups/:groupId/students/:studentId/activities/:activityId/attempts` es de sólo lectura y compone su autorización: sesión, rol `docente`, acceso activo al grupo mediante `requireTeacherGroupStudentActivityScope`, estudiante activo, inscripción activa, rol `estudiante`, actividad de la misma edición anual del grupo y aislamiento estricto por grupo + estudiante + actividad, de modo que un `activityId` de otro grupo, de otra edición o inexistente responde `ACTIVITY_NOT_FOUND`. El contrato devuelve `group`, `student`, `activity`, `summary`, `submittedAttempts`, `annulledAttempts` y `defaultAttemptId`. `summary` informa `attemptsUsed`, `submittedCount`, `annulledCount`, `best`, `judgment`, `lastSubmittedAt`, `hasDraft` y `draftStartedAt`. Los intentos enviados se ordenan cronológicamente por fecha de envío y, en empate, por id; el mejor intento usa el mismo criterio que C1, C2 y C3 —porcentaje descendente, puntaje descendente y fecha de envío ascendente— y `judgment` se lee tal cual de `intentos_actividad`, sin recalcularlo ni aplicar umbrales. Las preguntas se arman desde el snapshot histórico de `preguntas_intento_actividad` y las respuestas desde `respuestas_intento_actividad`: nunca se reconstruyen intentos históricos a partir de las preguntas actuales de la actividad. Los intentos anulados viajan en una colección separada, sin preguntas ni respuestas, y no cuentan para `attemptsUsed`, para el mejor resultado ni para el juicio. El borrador sólo informa existencia y fecha de inicio: no expone respuestas, progreso ni cantidad respondida. La respuesta no incluye clave de corrección, modo de corrección, respuestas normalizadas, `submissionId`, snapshots privados crudos ni umbrales; la respuesta correcta se transforma a forma pedagógica con `publicCorrectAnswerForReview` y la respuesta hereda `Cache-Control: no-store`.

El frontend `/docente/grupos/:groupId/estudiantes/:studentId/actividades/:activityId/intentos` se abre desde C3 haciendo click en el nombre de la actividad y vuelve siempre a C3. Muestra el encabezado del grupo, el estudiante y la actividad con su disponibilidad; un resumen de seis indicadores —mejor resultado, estado, intentos usados sobre el máximo, intentos enviados, último envío en hora local y borrador— consumidos del backend sin que React recalcule nada; un selector local de intentos enviados en el orden recibido y sin repetir consultas, donde el mejor intento queda seleccionado por defecto y lleva la insignia visible "Mejor intento"; y el detalle pregunta por pregunta de cada intento, con enunciado, tipo, resultado correcta/incorrecta en texto, puntos obtenidos sobre el máximo, la respuesta del estudiante y la respuesta esperada en forma pedagógica. La respuesta se presenta según el tipo: opción única como valor legible, selección múltiple como lista, respuesta escrita como texto exacto con "Referencias aceptadas" cuando hay más de una, "Sin respuesta" explícito cuando no hubo respuesta y un mensaje neutro cuando `expected` es `null` por tratarse de un tipo no revisable. La explicación histórica se muestra sólo si existe. Los intentos anulados quedan ocultos por defecto detrás de un control expandible, sin preguntas, sin respuestas, rotulados con su fecha de inicio y con la aclaración de que no cuentan para resultados. El borrador se informa como estado y fecha de inicio, sin contenido. La vista es de sólo lectura: no permite editar, anular, restaurar, reabrir ni otorgar intentos extra, no compara intentos lado a lado y no genera análisis automático de ningún tipo.

Cobertura del Bloque B: pruebas Worker/D1 en `tests/student-activity.test.mjs` (listado, estados temporales, participantes únicos, validaciones del PUT, autorización, Origin, `no-store`) y E2E en `tests/e2e/teacher-group-activities.spec.ts` (navegación, listado, guardado, fechas en hora local, confirmación al deshabilitar, preview contextual) y `tests/e2e/teacher-activity-preview.spec.ts` (preview docente desde la ruta contextual).

Cobertura de C1: pruebas Worker/D1 en `tests/teacher-group-results.test.mjs` (autorización y grupo ajeno/inexistente/archivado, estudiantes activos vs inactivos/sin rol/pendientes, actividad de otra edición excluida, actividad sin habilitación incluida, celda sin intento, sólo borrador, varios enviados con desempates, enviado + borrador coexistiendo, anulado excluido, `attemptsUsed`, aislamiento por grupo, `no-store` y ausencia explícita de datos privados y umbrales) y E2E en `tests/e2e/teacher-group-results.spec.ts` (navegación grupo → resultados, render de la matriz, estados de celda, etiqueta accesible e intentos usados, error con reintento, estado vacío y ausencia de desbordamiento, en escritorio y móvil).

Cobertura de C2: pruebas Worker/D1 en `tests/teacher-group-activity-results.test.mjs` (401 sin sesión, 403 para estudiante y practicante, docente ajeno, grupo archivado, actividad de otra edición y actividad inexistente, 404 grupo inexistente, grupo sin estudiantes, metadatos de actividad sin habilitación, deshabilitada, no abierta y cerrada, estudiantes activos con rol e inscripción activa, conteos mutuamente excluyentes del resumen con suma igual al total, promedio y mediana con cantidad impar y par de enviados y con decimales, promedio y mediana `null` sin envíos, sin intento, sólo borrador, juicios persistidos `inicial`, `en_proceso` y `logrado` sin recalcular, mejor intento con desempate, enviado + borrador coexistiendo, anulado excluido de `attemptsUsed`, aislamiento entre grupos, `no-store`, `nosniff` y ausencia explícita de datos privados, umbrales y documentos) y E2E en `tests/e2e/teacher-group-activity-results.spec.ts` (navegación matriz → detalle y vuelta, URL con grupo y actividad, encabezado y estado de disponibilidad, los ocho indicadores, `—` cuando el backend no calcula promedio ni mediana, sin intento, sólo borrador, inicial, en proceso y logrado, borrador como insignia secundaria sin reemplazar el juicio, intentos usados y último envío en hora local, orden alfabético por defecto, orden por resultado ascendente y descendente con los estudiantes sin mejor intento al final y sin repetir consultas, error con reintento, estado de carga, estado vacío y ausencia de desbordamiento con scroll contenido, en escritorio y móvil).

Cobertura de C3: pruebas Worker/D1 en `tests/teacher-group-student-results.test.mjs` (autorización por alcance de grupo y membresía del estudiante —docente ajeno, grupo archivado, grupo inexistente, estudiante inexistente y estudiante de otro grupo—, inscripción pendiente, usuario suspendido y usuario sin rol, universo y orden natural de actividades, disponibilidad en los cuatro estados, estados sin intento, sólo borrador, inicial, en proceso y logrado, mejor intento con desempates, anulado excluido, evolución completa con secuencia descendente, resumen con categorías excluyentes que suman el total, promedio y mediana con cantidad par e impar y con decimales, promedio y mediana `null` sin envíos, edición sin actividades, aislamiento entre grupos, `no-store`, `nosniff` y ausencia explícita de datos privados y umbrales) y E2E en `tests/e2e/teacher-group-student-results.spec.ts` (24 casos aprobados entre escritorio y móvil: navegación desde C1 y desde C2 con vuelta a la matriz, encabezado, ocho indicadores, tabla semántica, estados, borrador secundario, intentos usados, último envío en hora local, evolución de 0, 1, 2 y 3 o más envíos, órdenes natural, ascendente y descendente, estado de carga, error con reintento, estado vacío, ausencia de desbordamiento del documento, scroll propio de la tabla y navegación al detalle de intentos de una actividad). También se actualizó `tests/e2e/teacher-group-activity-results.spec.ts` para verificar la navegación del detalle de actividad al detalle del estudiante. En el corte C3 `npm test` quedó en 35/35 pruebas y los E2E relacionados —C1, C2, grupos y actividades docentes— sumaban 58 casos aprobados.

Deudas conocidas de C4: no hay retroalimentación por respuesta porque hoy no se snapshotea en la entrega; los tipos ordenar y relacionar degradan la respuesta esperada a `expected: null` con un mensaje neutro; el esquema no guarda fecha de anulación, por lo que los intentos anulados se rotulan con su fecha de inicio; el endpoint devuelve todos los intentos enviados con su detalle completo en una sola respuesta, de modo que conviene evaluar carga por intento sólo si el volumen crece; la comparación lado a lado entre intentos y el análisis semántico o con IA quedan para una etapa posterior.

Cobertura de C4: pruebas Worker/D1 en `tests/teacher-group-student-attempts.test.mjs` (autorización compuesta —sin sesión, estudiante y practicante, docente ajeno, grupo archivado, grupo inexistente, estudiante inexistente, estudiante de otro grupo, inscripción pendiente, usuario suspendido, actividad de otra edición y actividad inexistente—, aislamiento por grupo, estudiante y actividad, orden cronológico de los intentos enviados con desempate por id, elección del mejor intento con el criterio compartido, `judgment` persistido sin recalcular, preguntas y respuestas desde el snapshot histórico, anulados en colección separada sin preguntas ni respuestas y excluidos de `attemptsUsed` y del mejor, borrador sólo como bandera con fecha de inicio, `defaultAttemptId`, `no-store`, `nosniff` y ausencia explícita de clave de corrección, modo, respuestas normalizadas, `submissionId`, snapshots privados y umbrales) y E2E en `tests/e2e/teacher-group-student-attempts.spec.ts` (24 casos aprobados entre escritorio y móvil: navegación C3 → C4 y vuelta, encabezado, los seis indicadores, selector con mejor intento por defecto e insignia, cambio de intento sin repetir consultas, respuestas de opción única, selección múltiple y respuesta escrita, "Sin respuesta", puntos y resultado, explicación histórica, `expected: null` degradado, anulados ocultos y expandibles sin efecto en el resumen, sin enviados con y sin borrador, estado de carga, error con reintento, ausencia de acciones administrativas, de comparación y de análisis automático, y ausencia de desbordamiento). En este corte `npm test` queda en 36/36 pruebas y los E2E relacionados —C1, C2, C3, C4, grupos y actividades docentes— suman 82 casos aprobados.
El panel docente está pensado para cubrir, de forma gradual, estas capacidades:

- Consultar grupos asignados.
- Importar o aprobar inscripciones.
- Habilitar actividades y fechas.
- Ver intentos y resultados.
- Confirmar o ajustar calificaciones con auditoría.

### Hito 6 — Pipeline de autoría asistida

- **6A COMPLETO: pipeline JSON de actividades.** Contrato JSON v1 (`radio`, `checkbox`, `text`), validación estricta, traducción a la clave privada que exige el corrector, auto-prueba con el corrector real, proyección pública sin material de corrección, publicador local con simulación por defecto y `--apply`, idempotencia, política de actualización con historia, snapshots y borradores protegidos, barrera Git ampliada y `npm test` en 56/56. El detalle está en §7.2.
- **6B COMPLETO: render de recursos `image` y `code`** en la interfaz del estudiante y en el modo prueba docente, mediante un único renderer compartido, defensa en runtime ante datos inválidos, responsive y accesibilidad básica, sin dependencias nuevas, sin cambios de grading, de esquema ni de persistencia. La advertencia `RESOURCES_NOT_RENDERED` fue retirada porque dejó de ser verdadera. El detalle está en §7.3.
- **6C COMPLETO: asignación y habilitación automatizada por grupos.** Contrato JSON propio —separado del documento de autoría— que declara el estado deseado por grupo (`groupCode`, `enabled`, `opensAt`, `closesAt`), resuelve la actividad por slug y edición y los grupos por código y edición, normaliza las fechas a UTC y escribe sólo con `--apply` en una única transacción `BEGIN IMMEDIATE` sobre la D1 local: idempotente, atómico, con rollback, `foreign_key_check`, verificación posterior, advertencias con historia y salida sin datos personales. El detalle está en §7.4.
- **6D-A COMPLETO: pipeline de autoría de materiales teóricos.** Contrato Markdown + frontmatter plano y estricto, parser propio sin YAML completo ni dependencias, validación técnica del cuerpo (HTML, MDX, iframes y esquemas peligrosos rechazados; código en línea y bloques cercados como excepciones legítimas), imágenes same-origin bajo `/materiales/`, whitelist de lenguajes, Mermaid con validación estática, bloque declarativo de YouTube, hash SHA-256 en el informe, CLI local con `material:validate` y `material:install`, simulación por defecto, `--apply`, `--with-images`, `--force` y `--check`, idempotencia, barrera Git propia y compatibilidad legacy total. Sin D1, sin frontend, sin navegación automática y sin material real todavía. El detalle está en §7.5.
- **6D-B COMPLETO: consumo automático de materiales.** `import.meta.glob` perezoso sobre `content/*/*/*.md`, registry genérico con memoización, contrato 6D-A reutilizado como única fuente de reglas mediante una frontera de re-export, tres rutas genéricas (curso, unidad y material), página genérica con estado neutro de no encontrado, renderer Markdown compartido con `MermaidDiagram` y `VideoEmbed` reutilizados sin cambios, imágenes same-origin, deep-link y F5, navegación desde Mis cursos con `materialEntryPath` explícito, compatibilidad legacy absoluta y un material piloto real de Unidad 2 instalado por 6D-A. Sin D1, sin endpoints y sin dependencias nuevas. El detalle está en §7.6.
- Publicación de materiales por grupo y edición (etapa posterior, sobre `contenidos`, `versiones_contenido` y `publicaciones_contenido`): posterior a 6D-B. **No forma parte del cierre de 6D-B.**
- Integración de IA más profunda dentro de la plataforma: posterior.

6A, 6B, 6C, 6D-A y 6D-B están terminados. El **Hito 6 — Pipeline de autoría asistida queda COMPLETO** en su alcance de autoría, instalación, consumo y asignación de actividades. La publicación de materiales por grupo y edición (6D2) se mantiene como **etapa posterior separada**, sobre `contenidos`, `versiones_contenido` y `publicaciones_contenido`, y no se mezcla con este cierre.

El piloto controlado con grupos reales —definir los grupos 2026 participantes, cargar cuentas mediante el importador aprobado, comunicar activación y privacidad, ejecutar un piloto pequeño y revisar incidencias— continúa pendiente como frente separado de 6A–6D.

## 13. Próximo trabajo concreto

El próximo frente técnico antes de usar datos reales ya no es preparar la configuración remota de `DOCUMENT_HMAC_KEY`: eso quedó resuelto dentro de A1 (B2.2 cargó el secreto sin que su valor pasara por el agente ni por el repositorio, y B2.4/R2 desplegaron el Worker compatible con el runtime), así que el frente vigente es **A2 — seguridad operacional**. El **Hito 4 — Actividad 1 completa** está funcionalmente cerrado en entorno local, incluido el modo prueba docente sin persistencia académica. El **Hito 5 — Panel docente mínimo** está cerrado en su alcance mínimo acordado: alcance por grupo (listado y resumen), Bloque B (actividades y habilitaciones por grupo) y Bloque C completo, con C1 (matriz de resultados del grupo), C2 (detalle de una actividad para todo el grupo), C3 (detalle de un estudiante a través de todas sus actividades) y C4 (detalle de intentos y respuestas pregunta por pregunta, con la marca de correcto/incorrecto, los puntos obtenidos, la respuesta pedagógica esperada y la explicación, sin exponer nunca la clave de corrección, el modo de corrección ni snapshots privados), todos con backend y frontend verificados. Con C4 cerrado no queda ningún corte pendiente dentro del Hito 5. El **Hito 6A — Pipeline de autoría JSON** quedó cerrado (ver §7.2): contrato JSON v1, validación estricta, traducción a la clave privada del corrector, auto-prueba con el corrector real, proyección pública, publicador local con simulación por defecto y `--apply`, idempotencia, política de actualización con historia, snapshots protegidos, barrera Git ampliada y `npm test` en 56/56. El **Hito 6B — Render de resources `image` y `code`** también quedó cerrado (ver §7.3): renderer compartido `QuestionResources` reutilizado por la actividad del estudiante y el modo prueba docente, defensa en runtime ante datos inválidos, responsive, accesibilidad básica, sin dependencias nuevas, sin cambios de grading, de esquema ni de persistencia, y con la advertencia `RESOURCES_NOT_RENDERED` retirada. El **Hito 6C — Asignación y habilitación automatizada por grupos** quedó cerrado (ver §7.4): contrato JSON propio y separado del de autoría, resolución de actividad y grupos por edición, normalización temporal a UTC, simulación por defecto con escritura sólo mediante `--apply`, idempotencia, atomicidad con rollback, verificación posterior, advertencias con historia y salida sin datos personales, sin migraciones, sin endpoint, sin UI y sin cambios de esquema ni de grading. El **Hito 6D-A — Pipeline de autoría de materiales teóricos** quedó cerrado (ver §7.5): contrato Markdown + frontmatter plano, parser propio y estricto, validación técnica del cuerpo, imágenes same-origin, Mermaid y YouTube declarativos con validación estática, hash SHA-256, CLI local con `material:validate` y `material:install`, simulación por defecto, `--apply`, `--with-images`, `--force` y `--check`, idempotencia, barrera Git propia y compatibilidad legacy, sin D1, sin frontend, sin navegación automática y sin material real todavía. El **Hito 6D-B — consumo automático de materiales** también quedó cerrado (ver §7.6): `import.meta.glob` perezoso sobre `content/*/*/*.md`, registry genérico con memoización y contrato 6D-A reutilizado como única fuente de reglas, tres rutas genéricas (curso, unidad y material) con prioridad absoluta de las rutas legacy, página genérica con estado neutro de no encontrado, renderer Markdown compartido con `MermaidDiagram` y `VideoEmbed` reutilizados sin cambios, imágenes same-origin, enlaces seguros, deep-link y F5, navegación desde Mis cursos con `materialEntryPath` explícito y un material piloto real de Unidad 2 instalado por 6D-A; `npm test` en 143/143 y la suite E2E completa con 220 aprobados sin regresiones funcionales. Con eso, el **Hito 6 queda completo** en su alcance de autoría, instalación, consumo y asignación: no falta ningún corte dentro de 6A, 6B, 6C, 6D-A y 6D-B. La publicación de materiales por grupo y edición (6D2) permanece como **etapa posterior separada**, sobre `contenidos`, `versiones_contenido` y `publicaciones_contenido`. La edición de contenido y preguntas dentro del panel docente y las deudas de C4 documentadas arriba (retroalimentación por respuesta, fecha de anulación, carga por intento y comparación lado a lado) quedan como mejoras posteriores dentro del mismo panel.

Con el Hito 6 cerrado, el trabajo siguiente queda deliberadamente separado en dos caminos y **ninguno se inicia en este corte**:

**A. Antes de usar datos reales — seguridad y operación.** Configuración, custodia y rotación de `DOCUMENT_HMAC_KEY` en el entorno remoto; restablecimiento de contraseña; revocación global de sesiones de una cuenta; limitación de frecuencia por dirección u origen; auditoría de altas, cambios documentales, restablecimientos y acciones docentes; y aviso de privacidad, acceso, rectificación, conservación y eliminación de datos personales, según la lista de §10.

**B. Evolución funcional — publicación de materiales por grupo y edición.** Sobre las tablas que ya existen (`contenidos`, `versiones_contenido` y `publicaciones_contenido`): decidir qué unidad o material ve cada grupo en cada edición anual, con su estado de publicación, sin tocar Unidad 0 ni Unidad 1. Es la continuación natural del consumo automático de 6D-B y de las deudas registradas en §7.6.

Hasta configurar y custodiar el secreto remoto no deben importarse cuentas reales. El portafolio de 2025 se mantiene únicamente como archivo de validación y no está mapeado a ningún grupo de D1.

## 14. A1 — Infraestructura remota ficticia (completada)

El 23 de septiembre de 2026 se inició A1 con el objetivo de preparar un primer entorno remoto de Cloudflare **completamente ficticio**, sin datos personales reales. El bloque **B1 — preparación local** quedó cerrado y publicado (`b22df78`): existe el entorno `beta` en `wrangler.jsonc` (Worker `profemacon-net-2-beta`), junto con la guarda local `beta:verify-target`, el build portable `beta:build`, el recorrido de humo ya preparado `beta:smoke`, sus pruebas (`tests/beta-infrastructure.test.mjs`) y el procedimiento en `docs/beta-remota.md`. El bloque **B2.1** también quedó completado: se creó la **única** base D1 remota de la cuenta, `profemacon-beta-remote` (`42c1bbd1-c6e9-432a-a3b5-86eac4e9dd5e`), **sin `--location`** (Cloudflare eligió `ENAM`) y su `database_id` quedó registrado en `env.beta`. El entorno top-level local no cambió: sigue siendo el Worker `profemacon-net-2` con la D1 `profemacon-beta-local` y el UUID de ceros.

La base remota contiene **una sola tabla y ninguna fila de migración**: `d1_migrations`, creada —sin que fuera evidente— por el comando `wrangler d1 migrations list … --remote` ejecutado en B2.1, porque en Wrangler 4.112 ese comando llama a `initMigrationsTable` y ejecuta `CREATE TABLE IF NOT EXISTS d1_migrations`. Es una escritura real, documentada en `docs/beta-remota.md` §N, y explica que `num_tables` haya pasado de 0 a 1. No se aplicó ninguna migración, ningún seed ni ningún dato, real ni ficticio, y el comando correcto para inspeccionar el esquema remoto sin escribir es un `SELECT` de `sqlite_master`. El Worker beta **no está desplegado** y **no hay ningún secreto configurado**.

**B2.3a quedó completado**: se aplicaron las diez migraciones (`0001`–`0010`) a `profemacon-beta-remote` en una sola pasada autorizada y la verificación read-only confirmó 10 filas en `d1_migrations`, **26 tablas de dominio, 24 índices y 33 triggers** —paridad exacta con el esquema local, salvo la tabla interna `_cf_KV` remota frente a `_cf_METADATA` local—, `PRAGMA foreign_key_check` sin violaciones y claves foráneas activas (`PRAGMA foreign_keys = 1`). Las tablas de dominio están **vacías**: ningún seed y ningún dato. El bookmark previo a la migración quedó registrado en `docs/beta-remota.md`. El Worker beta sigue **sin desplegar** y sigue **sin secretos**.

**B2.3b quedó completado**: se aplicó una sola vez `seed/001-datos-ficticios.sql` con el endpoint de importación de D1 (16 consultas, 54 filas escritas, exit 0) sobre la base ya migrada. La verificación read-only confirma los fixtures ficticios: 2 usuarios (`ana.docente` y `estudiante.demo`, ambos “(prueba)” y con correos `@example.test`), 4 roles, 2 asociaciones de rol, la asignatura `programacion-demo`, la edición 2026, el grupo `DEMO-A`, 1 inscripción, 1 asignación docente, 1 mapeo ficticio, el contenido `bienvenida-demo` publicado para `DEMO-A` y 2 activaciones demo vigentes hasta 2099 (sólo con hash). `eventos_auditoria` quedó en 0 porque el seed no escribe auditoría, y siguen en 0 documentos, sesiones, intentos, respuestas, calificaciones, importaciones, preguntas y credenciales. `foreign_key_check` sigue sin violaciones, `d1_migrations` conserva sus 10 filas y el esquema no cambió (26 tablas de dominio, 24 índices, 33 triggers). Los códigos demo son públicos en el repositorio y se aceptan sólo porque A1 es ficticia y efímera.

**B2.4 quedó completado**: el Worker beta existe y está desplegado. El build beta local produjo el artefacto aplanado (`profemacon-net-2-beta`, `targetEnvironment: beta`, binding `DB` → `profemacon-beta-remote`, assets `ASSETS`) y el primer deploy se ejecutó una sola vez con autorización humana previa (`wrangler deploy --config dist/profemacon_net_2/wrangler.json`): 77 assets subidos, bindings `env.DB` y `env.ASSETS`, URL `https://profemacon-net-2-beta.pablomacon.workers.dev` y Version ID `2307ceb8-7467-4c54-baac-f5e4368c58b3`. Las lecturas posteriores muestran **1** deployment y **1** version, y `wrangler secret list --env beta` ahora responde `[]` (el prerequisito de B2.2 quedó resuelto). Verificado por HTTPS: `GET /` y `GET /curso/programacion-i` responden 200 con el HTML de la aplicación y el bundle React, las rutas desconocidas caen al fallback SPA, los assets estáticos (logos y material de unidad 2) responden 200, y sin cookie `GET /api/session` y `GET /api/me/courses` responden 401. No hubo smoke autenticado, ni secretos, ni escrituras en D1, ni dominio propio, ni Access.

**B2.2 quedó completado**: `DOCUMENT_HMAC_KEY` existe en el environment beta. La clave fue generada y cargada **manualmente por el responsable, fuera del agente** (`wrangler secret put DOCUMENT_HMAC_KEY --env beta`), y su valor nunca pasó por Cline, Git ni esta documentación. La verificación se hizo **sólo por nombre**: `wrangler secret list --env beta` devuelve `[{ "name": "DOCUMENT_HMAC_KEY", "type": "secret_text" }]` (un único secret), y la carga produjo una segunda versión del Worker, `82dea70d-dfa0-4f58-806f-2ab9e285333f` (2026-09-23T21:31:58.217Z, `Source: Secret Change`), que quedó activa al 100 % hasta el deploy de R2. No hubo deploy de código adicional ni escrituras en D1. Con el secret presente, los endpoints de importación dejan de responder `503` por clave ausente.

**B2.5 falló en su primer intento (2026-09-23)**: el recorrido de humo remoto respondió **HTTP 500** en `POST /api/auth/login`. Observability mostró la causa exacta: `Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)`. El runtime de Cloudflare —el mismo que usa `wrangler dev` en local— impone un tope duro de 100.000 iteraciones de PBKDF2 que no depende del plan y no es configurable por wrangler ni por flags de compatibilidad; la implementación usaba 600.000 y por eso ni los tests en Node ni los E2E podían detectarlo (Node no tiene ese tope y los E2E simulan `/api/auth/login`). El intento **no creó ninguna credencial**: la derivación falla antes de `db.batch`, así que no hubo ninguna escritura en D1 (`credenciales_locales = 0`, `sesiones_usuario = 0`, activaciones demo sin consumir) y ninguna contraseña quedó comprometida. El arreglo quedó implementado y verificado **sólo en local** (política versionada con rango verificable 50.000–100.000 y objetivo de creación 100.000, migración `0011`, frontera de error saneada y pruebas contra `wrangler dev` real); **no se aplicó al remoto**: `0011` no está aplicada en la D1 beta y el Worker beta sigue con el código anterior. El orden remoto previsto es esquema primero y código después, porque `0011` es compatible con el Worker desplegado (hoy no puede activar ni iniciar sesión) y el orden inverso violaría el `CHECK` vigente. La decisión sobre Workers Paid queda condicionada a medir el `cpuTime` real de 100.000 iteraciones en Workers: el plan no cambia el tope de PBKDF2, sólo el presupuesto de CPU.

**R1 quedó completado (2026-09-23)**: se aplicó **una sola** escritura remota, `wrangler d1 migrations apply profemacon-beta-remote --remote --env beta` (sin `-y`), que ejecutó únicamente `0011_costo_password_compatible.sql` sobre la D1 beta ficticia. Bookmark previo registrado: `0000000b-00000005-000050f0-768c7f8e957f7811f83db06306b8f754` (sin ejecutar `restore`). La verificación se hizo **sólo con `SELECT`** (nunca con `migrations list`): `d1_migrations` = **11** filas sin duplicados (última `0011_costo_password_compatible.sql`); `credenciales_locales` reconstruida con `formato TEXT NOT NULL DEFAULT 'v1' CHECK (formato IN ('v1'))` y `CHECK (iteraciones BETWEEN 50000 AND 100000)`, conservando el resto de columnas y defaults; **0 filas** de credenciales y 0 fuera de rango; `pragma_foreign_key_check` = **0**; 26 tablas de dominio, 24 índices y 33 disparadores (sin regresiones sobre B2.3a); ninguna tabla auxiliar (`credenciales_locales_nueva`, `verificacion_costo_*`); y fixtures intactos (2 usuarios, 1 grupo, 2 activaciones vigentes sin consumir, 0 sesiones, 0 intentos). No hubo deploy, ni seed, ni `secret put`, ni smoke, ni activaciones, ni login, ni datos reales.

**R2 quedó completado (2026-09-23)**: el código con PBKDF2 compatible con el runtime de Cloudflare ya está desplegado y verificado en el Worker beta. Con `git status` limpio, `HEAD` = `origin/main` = `c1054c5` y `rev-list` `0 0`, la guarda `verify-beta-d1-target.mjs --require-real` volvió a dar exit 0 (Worker `profemacon-net-2-beta`, D1 `profemacon-beta-remote`, `database_id` real) y `npm run beta:build` terminó con exit 0: aplanado `targetEnvironment: beta`, `DB` → `profemacon-beta-remote`, `ASSETS` con fallback SPA, `vars: {}` y la copia local de secretos (`.dev.vars`) eliminada del artefacto y su ausencia verificada. El deploy se ejecutó **una sola vez** con autorización humana previa: `wrangler deploy --config dist/profemacon_net_2/wrangler.json` (binario local, Wrangler 4.112.0, porque `wrangler` no está en el `PATH`) → 85 archivos leídos, 0 assets nuevos por huellas idénticas, 121.80 KiB (gzip 22.39 KiB), bindings `env.DB (profemacon-beta-remote)` y `env.ASSETS`, exit 0. **Version ID activo nuevo: `07d2b360-ad43-4c3c-8304-9c4ccfca8b72`** (2026-09-24T02:11:15Z; deployment 02:11:16Z al 100 %). Para rollback quedan la versión anterior `82dea70d-dfa0-4f58-806f-2ab9e285333f` (`Secret Change`) y el código de B2.4, `2307ceb8-7467-4c54-baac-f5e4368c58b3`. Toda la verificación posterior fue de sólo lectura: `secret list --env beta` sigue mostrando únicamente `DOCUMENT_HMAC_KEY` (no se ejecutó `secret put`), `GET /` → **200** `text/html`, `GET /curso/programacion-i` → **200** `text/html` **sin 307 ni `Location`** (fallback SPA corregido) y `/api/session` sin cookie → **401** `application/json`; no se hizo ningún `POST`. En D1 **no hubo ninguna escritura** (`d1_migrations` = 11, `credenciales_locales` = 0, 2 usuarios, 1 grupo, 2 activaciones demo vigentes sin consumir, 0 sesiones, `pragma_foreign_key_check` = 0, con `rows_written: 0` y `changed_db: false` en todas las lecturas). La migración `0011` ya estaba aplicada desde R1 y este bloque no ejecutó migraciones ni seeds. `node --test tests/beta-infrastructure.test.mjs` pasó **20/20** y `git diff --check` no encontró problemas.

Con R2 desplegado, el estado transitorio **esquema nuevo con el Worker viejo quedó cerrado**: la versión activa ya usa el rango verificable 50.000–100.000 y el tope del runtime dejó de ser un bloqueo. **B2.5 quedó completado el 2026-09-23** (2026-09-24 02:30:54 UTC en D1, hora local del responsable 2026-09-23): el recorrido de humo ficticio se ejecutó **una sola vez**, previa autorización humana explícita, como `npm run beta:smoke -- https://profemacon-net-2-beta.pablomacon.workers.dev` contra la versión activa `07d2b360-ad43-4c3c-8304-9c4ccfca8b72`, y terminó con **23/23 comprobaciones correctas** y exit 0, sin reintentos y sin ningún fallo. La contraseña ficticia de `estudiante.demo` se inyectó desde un script **fuera del repositorio** y nunca pasó por el agente, Git, esta documentación ni logs persistidos. Quedaron verdes: `GET /` (200 `text/html`), `GET /curso/programacion-i` (200 `text/html` **sin `Location`**), activación ficticia `POST /api/auth/activate` (200 en la primera corrida), cookie de sesión `Set-Cookie` con `Path=/`, `HttpOnly`, `SameSite=Strict` y `Secure`, `GET /api/session` (200, `estudiante.demo`), `GET /api/me/courses` (200, 1 curso), rechazo de la actividad deshabilitada (404 `ACTIVITY_NOT_FOUND`, nunca 200), `POST /api/auth/logout` (200 con cookie de limpieza `Max-Age=0`), `GET /api/session` posterior (401), login de usuario ficticio inexistente (401 y **nunca 500**), `Origin` ajeno (403) y petición sin `Origin` (403). La verificación posterior de D1 fue **sólo de lectura** (`rows_written: 0`, `changed_db: false` en todas las consultas): `credenciales_locales` = **1**, la de `estudiante.demo`, con `algoritmo = pbkdf2-sha256`, `formato = v1` e `iteraciones = 100000` —**PBKDF2 a 100.000 iteraciones verificado en producción**—; su activación quedó **consumida**; `ana.docente` quedó **intacta** (0 credenciales, 0 sesiones y activación sin consumir); `sesiones_usuario` = **1** fila creada y **revocada por el logout** (0 vigentes); `eventos_auditoria` = **1** fila nueva (`cuenta_activada`); `d1_migrations` = 11, `usuarios` = 2, `grupos` = 1, `intentos_actividad` = 0, `respuestas_intento_actividad` = 0, `calificaciones_actividad` = 0 y `pragma_foreign_key_check` = **0**. No hubo deploy, ni migraciones, ni seeds, ni `secret put`, ni datos reales. La medición de CPU con `wrangler tail --env beta --format json` (sólo lectura, en paralelo al recorrido) dio `outcome: ok` y `exceptions: []` en todos los eventos capturados, **sin error 1102 y sin `Pbkdf2 failed`**, con `cpuTime` máximo de **28 ms** en `POST /api/auth/activate` y **22 ms** en `POST /api/auth/login` (ruta PBKDF2): el plan vigente alcanza para este smoke y **no corresponde contratar un plan pago por estimación**, aunque antes de dimensionar carga real conviene confirmar el nivel del plan de la cuenta en el panel de Cloudflare, porque esa cifra supera el techo histórico de 10 ms citado para Free y esta medición es una muestra de un flujo ficticio, no una prueba de carga. Con esto **A1 — infraestructura remota ficticia queda completada** de punta a punta sobre recursos remotos ficticios. **A1 no autoriza datos personales reales**: siguen prohibidos los nombres, documentos, correos, portafolios, grupos, intentos y resultados reales, y la URL beta sigue sin publicitarse. La fase siguiente es **A2 — seguridad operacional** (limitación de frecuencia, restablecimiento de contraseña, revocación global de sesiones, limpieza de sesiones y activaciones, auditoría consultable, privacidad, pruebas negativas de autorización y revisión de errores), que **no se inicia automáticamente**.
