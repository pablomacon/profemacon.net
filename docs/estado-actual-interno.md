# Estado interno de Profe Macón 2.0

Última actualización: 22 de septiembre de 2026.

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

El portafolio real de referencia continúa produciendo una previsualización agregada de 19 filas válidas, cero filas inválidas, cero documentos duplicados y cero colisiones en las bases de usuario. Esa comprobación no imprime nombres ni documentos y no aplica el archivo a D1.

`tests/e2e/my-courses.spec.ts` cubre el catálogo autenticado, los estados de sesión, roles, contenido conocido y desconocido, errores, reintentos y ausencia de desbordamiento. Sus 17 escenarios pasan en escritorio y móvil: 34 casos aprobados. Las seis diferencias visuales preexistentes del resto de Playwright continúan pendientes de revisión y sus snapshots no fueron actualizados. Las capturas existentes contienen sólo estados e identidades ficticias; la prueba con el portafolio real no genera captura, traza ni video.

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
- El importador tiene API, pantalla administrativa y cobertura de navegador para el estado inicial y la entrega individual; falta una prueba de integración real de todas las etapas contra D1.
- El panel docente existe de forma parcial: listado y resumen de grupos, actividades con habilitaciones, matriz de resultados por grupo (C1), detalle de una actividad para todo el grupo (C2), detalle de un estudiante a través de todas las actividades (C3) y detalle de intentos y respuestas de un estudiante en una actividad (C4), todos de sólo lectura. Todavía no permite editar contenido ni preguntas, no incluye acciones administrativas sobre intentos y el panel de practicante sigue pendiente.
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

### Hito 6 — Piloto controlado

- Definir los grupos 2026 participantes.
- Cargar cuentas reales mediante el importador aprobado.
- Comunicar activación, privacidad y cierre de sesión.
- Ejecutar un piloto pequeño.
- Revisar incidencias antes de ampliar el alcance.

## 13. Próximo trabajo concreto

El próximo frente técnico antes de usar datos reales es preparar la configuración remota de `DOCUMENT_HMAC_KEY`. El **Hito 4 — Actividad 1 completa** está funcionalmente cerrado en entorno local, incluido el modo prueba docente sin persistencia académica. El **Hito 5 — Panel docente mínimo** está cerrado en su alcance mínimo acordado: alcance por grupo (listado y resumen), Bloque B (actividades y habilitaciones por grupo) y Bloque C completo, con C1 (matriz de resultados del grupo), C2 (detalle de una actividad para todo el grupo), C3 (detalle de un estudiante a través de todas sus actividades) y C4 (detalle de intentos y respuestas pregunta por pregunta, con la marca de correcto/incorrecto, los puntos obtenidos, la respuesta pedagógica esperada y la explicación, sin exponer nunca la clave de corrección, el modo de corrección ni snapshots privados), todos con backend y frontend verificados. Con C4 cerrado no queda ningún corte pendiente dentro del Hito 5. El próximo frente es la edición de contenido y preguntas, todavía no iniciada, y las deudas de C4 documentadas arriba (retroalimentación por respuesta, fecha de anulación, carga por intento y comparación lado a lado) quedan como mejoras posteriores dentro del mismo panel.

Hasta configurar y custodiar el secreto remoto no deben importarse cuentas reales. El portafolio de 2025 se mantiene únicamente como archivo de validación y no está mapeado a ningún grupo de D1.
