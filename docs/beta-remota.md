# Beta remota ficticia (A1)

Estado: **B1 completado**, **B2.1 completado** (D1 remota creada), **B2.3a completado** (migraciones `0001`–`0010` aplicadas y verificadas) y **B2.3b completado** (fixtures ficticios sembrados y verificados). **B2.2 sigue bloqueado** hasta el primer deploy del Worker `profemacon-net-2-beta`, que aún no existe. Sin secretos y sin datos reales.
Última actualización: 23 de septiembre de 2026.

## A. Propósito

Pasar del entorno exclusivamente local a un primer entorno remoto de Cloudflare **completamente ficticio y sin datos personales reales**. A1 no es la beta con estudiantes: es la comprobación de que el despliegue, los secretos, las migraciones, las cookies y el `Origin` funcionan de extremo a extremo sobre una base descartable.

## B. Separación de entornos

| Entorno | Worker | D1 | Uso |
|---|---|---|---|
| Local (top-level) | `profemacon-net-2` | `profemacon-beta-local` | desarrollo, pruebas y `.dev.vars` |
| Beta remota ficticia (`env.beta`) | `profemacon-net-2-beta` | `profemacon-beta-remote` | A1, datos ficticios, efímera |
| Real futuro | a definir | a definir | posterior a A2 |

## C. Nombres ya decididos

- environment de Wrangler: **`beta`**;
- Worker beta: **`profemacon-net-2-beta`**;
- base D1 beta: **`profemacon-beta-remote`**;
- binding D1: **`DB`** (igual que en local; el Worker no cambia);
- binding de Assets: **`ASSETS`** con fallback de aplicación de página única.

El binding es el mismo a propósito: el entorno se distingue por nombre de base y `database_id`, nunca por código distinto.

## D. Regla de ubicación de la D1

La D1 beta se crea **sin `--location`**: Cloudflare elige la ubicación primaria. No se fija `weur`, `enam` ni ninguna otra pista, ni jurisdicción, para no introducir decisiones prematuras de residencia de datos en un entorno ficticio.

## E. Regla de seguridad de A1

Durante A1 está **prohibido** introducir nombres reales, documentos reales, correos reales, contraseñas de personas, portafolios reales, grupos reales, intentos reales o resultados reales. Sólo se usan los datos ficticios ya versionados. El portafolio real de referencia no se aplica en A1.

## F. Guarda de destino (B1, local)

`npm run beta:verify-target` ejecuta `scripts/verify-beta-d1-target.mjs --dry`. Es local y de sólo lectura: no ejecuta Wrangler, no consulta Cloudflare, no escribe archivos y no imprime secretos. Comprueba que:

- exista `env.beta` y que el entorno local (top-level) siga intacto;
- el Worker beta, el binding, el nombre de la D1, `workers_dev` y los assets sean los esperados;
- el nombre de la D1 de la beta no coincida con el de la D1 local;
- el `database_id` no coincida con el del entorno local;
- el estado del `database_id` sea inequívoco: **PLACEHOLDER** o **REAL**.

Modos y códigos de salida: `--dry` (etapa local, el marcador de ceros es aceptable) y `--require-real` (previo a cualquier operación remota; el marcador de ceros es un error). `0` configuración válida, `1` configuración inconsistente, `2` uso incorrecto.

Antes de cada operación remota de B2 debe encadenarse `node scripts/verify-beta-d1-target.mjs --require-real`.

## G. Build beta (B1, local)

`npm run beta:build` ejecuta `scripts/build-beta.mjs`, que fija `CLOUDFLARE_ENV=beta` **sólo para los procesos hijos** (portable en Windows), corre `tsc -b` y `vite build --configLoader runner`, y después verifica el config aplanado que el plugin deja en `dist/<worker>/wrangler.json`:

- `name` = `profemacon-net-2-beta`;
- `DB` → `profemacon-beta-remote`;
- assets `ASSETS` con fallback de página única y directorio existente con `index.html`.

Si el `database_id` sigue siendo el marcador de ceros, el build lo informa como **PLACEHOLDER**: el artefacto local es válido, pero **no debe desplegarse**. El comando no despliega ni configura secretos.

## H. Secretos

`DOCUMENT_HMAC_KEY` de beta debe ser **nueva y distinta** de la local y de la futura real. Este documento no contiene su valor y B1 no la generó.

- Generación: 32 bytes aleatorios codificados en `base64url` (43 caracteres) o 64 hex. La implementación exige un mínimo de 32 caracteres y devuelve `503` si no está configurada.
- **Requisito de orden (verificado el 2026-09-23):** Cloudflare no lista ni acepta secrets de un Worker inexistente. `wrangler secret list --env beta` responde `Worker "profemacon-net-2-beta" (env: beta) not found` y sugiere desplegar primero. Por eso la carga ocurre **después del primer deploy** de la beta y antes del recorrido de humo.
- **Generación y custodia:** las hace el responsable **fuera del agente** —terminal propia más gestor de contraseñas con la etiqueta `Profe Macón beta — DOCUMENT_HMAC_KEY`—. El valor no se imprime en el agente ni se pega en el chat, porque quedaría persistido en el transcript de la conversación. La carga puede hacerla el responsable directamente o el agente leyendo el valor por *stdin* desde una variable de entorno de usuario; nunca desde un archivo del repositorio.
- Carga: `wrangler secret put DOCUMENT_HMAC_KEY --env beta` (el valor se escribe por entrada estándar y nunca queda en el repositorio).
- Verificación sin exponer el valor: `wrangler secret list --env beta` (sólo nombres).
- Custodia: gestor de contraseñas y registro de fecha/cargador en este documento; nunca en `wrangler.jsonc`, `.dev.vars` versionado, README, docs, capturas ni Git.
- Rotación: con datos ficticios, la rotación válida es reconstruir la beta. Con datos reales habrá que versionar la clave, porque el HMAC participa de una restricción `UNIQUE` sobre la huella documental.

No hay otras variables ni secretos: el Worker sólo usa los bindings `DB`, `ASSETS` y este secreto.

## I. Migraciones

Las migraciones `0001` a `0010` se aplican en orden sobre una D1 vacía; son las mismas que ya se aplican contra bases locales temporales en las pruebas. La aplicación remota se hace con confirmación interactiva y sobre una base recién creada, en una sola pasada:

```powershell
wrangler d1 migrations list profemacon-beta-remote --remote --env beta
wrangler d1 migrations apply profemacon-beta-remote --remote --env beta
```

Según la documentación de Cloudflare, una migración que falla se revierte, mientras las migraciones anteriores ya aplicadas permanecen. La marca de cada archivo aplicado queda en la tabla `d1_migrations`. Aun así, el procedimiento mantiene una estrategia prudente:

1. anotar el **bookmark previo** con `wrangler d1 time-travel info profemacon-beta-remote`;
2. comparar el **inventario de esquema** remoto con el baseline local (tablas de dominio, tablas totales, índices, triggers y filas de `d1_migrations`);
3. si algo queda inservible, **reconstruir la D1 ficticia** (borrar, crear, migrar, sembrar) es la contingencia primaria, y Time Travel la secundaria.

No se escribe SQL de reversión a mano: las migraciones no son reversibles.

## J. Datos ficticios

El seed es `seed/001-datos-ficticios.sql`: es 100 % ficticio, repetible (`INSERT OR IGNORE`), no contiene personas, documentos ni resultados reales, y cubre roles, dos cuentas demo (`ana.docente`, `estudiante.demo`), la asignatura `programacion-demo`, la edición 2026, el grupo `DEMO-A`, la inscripción, la asignación docente, un mapeo de origen ficticio y una publicación de ejemplo.

Los códigos de activación demo están publicados en el `README.md` del repositorio. Se aceptan en la beta **sólo** porque A1 es efímera, usa únicamente datos ficticios y su URL no se publicita. Antes de cualquier dato real hay que eliminar o archivar esas cuentas y reconstruir la base.

El seed remoto se aplicó en **B2.3b** mediante el endpoint de importación de D1 (el archivo no contiene `BEGIN TRANSACTION` ni `COMMIT`), y la verificación de los fixtures está en la sección correspondiente más abajo:

```powershell
wrangler d1 execute profemacon-beta-remote --remote --env beta --file=seed/001-datos-ficticios.sql
```

`seed/actividades/programacion-i/unidad-1/variables-java-01.public.sql` es opcional y sólo sirve para comprobar el rechazo correcto de una actividad en borrador y deshabilitada. Las claves de corrección viven fuera del repositorio y **no** forman parte de A1.

## K. Dominio

El acceso inicial usa **`workers.dev`**. No se configura dominio propio ni DNS: la validación de `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, login, logout y `Origin` no depende del dominio, porque la implementación deriva el `Origin` de la propia petición y activa `Secure` cuando la URL es https. El subdominio exacto se conoce al desplegar y por eso no se escribe en este documento.

## L. Operaciones remotas (B2 — no ejecutadas todavía)

```powershell
wrangler d1 create profemacon-beta-remote                  # sin --location
wrangler secret put DOCUMENT_HMAC_KEY --env beta           # valor por entrada estándar
wrangler d1 time-travel info profemacon-beta-remote        # bookmark previo
wrangler d1 migrations apply profemacon-beta-remote --remote --env beta
wrangler d1 execute profemacon-beta-remote --remote --env beta --file=seed/001-datos-ficticios.sql
wrangler deploy                                            # tras npm run beta:build
npm run beta:smoke -- https://<host-beta>
wrangler d1 export profemacon-beta-remote --remote --output=<ruta-fuera-del-repositorio>
wrangler delete --name profemacon-net-2-beta               # cierre de A1
wrangler d1 delete profemacon-beta-remote                  # cierre de A1
```

Cada comando remoto se ejecuta de a uno, con la guarda en modo estricto por delante y sin `-y`. El recorrido de humo (`scripts/verify-beta-smoke.mjs`) es sólo HTTP contra la URL indicada, usa la cuenta demo ficticia y una contraseña generada en memoria; no contiene URLs fijas ni secretos. El verificador `scripts/verify-student-import-api.mjs` también puede apuntarse a la beta, porque recibe la URL base como argumento.

## M. Prohibiciones vigentes

- sin estudiantes reales, sin portafolios reales, sin resultados reales;
- sin secretos en el repositorio, en logs persistidos ni en capturas;
- sin publicitar la URL de la beta mientras siga viva;
- sin `--remote` en comandos de D1 sin la guarda `--require-real` por delante;
- sin escritura remota durante B1.

## N. Recursos remotos creados (B2.1)

| Fecha | Recurso | Identificador | Cómo se creó |
|---|---|---|---|
| 2026-09-23 | D1 `profemacon-beta-remote` | `42c1bbd1-c6e9-432a-a3b5-86eac4e9dd5e` | `wrangler d1 create profemacon-beta-remote` **sin `--location`**: Cloudflare eligió la región `ENAM` |

El `database_id` es un identificador de recurso, no un secreto: se registra aquí y vive en `wrangler.jsonc` → `env.beta.d1_databases[0].database_id`, que es lo que hace que el binding `DB` de la beta resuelva. El entorno local (top-level) conserva `profemacon-beta-local` con el marcador de ceros.

Estado de esa base al 2026-09-23, verificado con lecturas **read-only** (`wrangler d1 info`, `wrangler d1 list --json`):

- `version: production`, `jurisdiction: null`;
- 1 consulta de lectura y 1 de escritura en 24 h al momento de B2.1 (3 filas leídas, 5 escritas: la creación de `d1_migrations`, ver corrección más abajo);
- en B2.1 las 10 migraciones (`0001`–`0010`) figuraban como pendientes; **desde B2.3a están aplicadas** (§ «Verificación de B2.3a»);
- es la **única** D1 de la cuenta y el **único** recurso remoto real de A1.

**Corrección del 2026-09-23 (bloque B2.2).** En B2.1 se registró esta base como “vacía” tras ejecutar `wrangler d1 migrations list … --remote --env beta`, presentándolo como lectura estricta. **No lo era**: en Wrangler 4.112 el *handler* de `d1 migrations list` llama a `initMigrationsTable(...)`, que ejecuta `CREATE TABLE IF NOT EXISTS d1_migrations`. Es decir, ese comando **creó la tabla vacía `d1_migrations`** (una escritura: 1 consulta de escritura, 5 filas escritas de contabilidad interna, y el tamaño pasó de 12.3 kB a 24.6 kB). No se aplicó ninguna migración —la tabla quedó sin filas— ni ningún seed, y no existe ninguna otra tabla. Para inspeccionar el esquema remoto sin escribir, el comando correcto es un `SELECT` de `sqlite_master` (`wrangler d1 execute … --command`), nunca `migrations list`.

Lo que **no** se hizo en B2.1: ningún seed, ningún secreto configurado, ningún Worker desplegado, `--location` no fijado, ningún otro recurso creado ni borrado.

## Estado de verificación de B1

| Verificación | Resultado |
|---|---|
| `node scripts/verify-beta-d1-target.mjs --dry` | 0 (configuración coherente; `database_id` PLACEHOLDER) |
| `node scripts/verify-beta-d1-target.mjs --require-real` | 1 (esperado: falta el UUID real de B2) |
| `node --test tests/beta-infrastructure.test.mjs` | 19/19 |
| `npm test` | suite completa en verde |
| `npm run build` | correcto; el config aplanado sigue siendo el local `profemacon-net-2` |
| `npm run beta:build` | correcto; config aplanado `profemacon-net-2-beta` → `profemacon-beta-remote` (PLACEHOLDER) |
| Recursos remotos | **ninguno** creado, modificado ni consultado |

### Verificación de B2.1 (2026-09-23)

| Verificación | Resultado |
|---|---|
| `git status --porcelain -uall` antes de empezar | vacío; `HEAD` = `origin/main` = `b22df78` |
| `wrangler d1 list --json` antes de crear | `[]` (la base no existía; sin duplicados) |
| `wrangler d1 create profemacon-beta-remote` | ✅ creada en `ENAM`, sin `--location` ni `--update-config` |
| `node scripts/verify-beta-d1-target.mjs --dry` | 0 · `D1 database_id: REAL (42c1bbd1-…)`; el control local sigue en PLACEHOLDER |
| `node scripts/verify-beta-d1-target.mjs --require-real` | 0 · destino beta coherente con UUID real |
| `npm run beta:build` | 0 · aplanado `profemacon-net-2-beta`, `targetEnvironment: beta`, `DB` → `profemacon-beta-remote` (REAL) |
| `wrangler d1 info` / `d1 list --json` | base existente, creada sin `--location` (ENAM), sin datos |
| `wrangler d1 migrations list --remote` | 10 migraciones pendientes — pero **no era read-only**: creó la tabla vacía `d1_migrations` (ver §N) |
| Migraciones · seed · secretos · deploy | **no**, **no**, **no**, **no** |

### Verificación de B2.2 (2026-09-23) — bloqueado por prerequisito

| Verificación | Resultado |
|---|---|
| `git status --porcelain -uall` antes de empezar | vacío; `HEAD` = `origin/main` = `24b653d` |
| `node scripts/verify-beta-d1-target.mjs --require-real` | 0 · Worker `profemacon-net-2-beta`, D1 `profemacon-beta-remote`, `database_id` REAL |
| `wrangler secret list --env beta` | ✗ `Worker "profemacon-net-2-beta" (env: beta) not found` → *If this is a new Worker, run `wrangler deploy` first to create it* |
| Clave generada · `secret put` ejecutado · secret existente | **ninguna** · **no** · **no** |
| Migraciones · seed · deploy · escrituras en D1 | **no** · **no** · **no** · **no** (sólo `d1 info`, lectura) |

**Consecuencia de orden:** el secret se carga **después del primer deploy** del Worker beta y antes del recorrido de humo. Mientras no exista, los endpoints de importación responderían `503` si el Worker estuviera desplegado sin secreto.

### Verificación de B2.3a (2026-09-23) — migraciones remotas aplicadas

| Paso | Resultado |
|---|---|
| Esquema previo (`SELECT` a `sqlite_master`) | sólo `_cf_KV` (interna de D1) y `d1_migrations` vacía |
| `d1_migrations` previo | 0 filas |
| Bookmark previo (`time-travel info`, sólo lectura) | `00000003-00000000-000050ef-bd6269ac8ed965ba9bb7ddf408773289` |
| `wrangler d1 migrations apply profemacon-beta-remote --remote --env beta` | ejecutado **una sola vez** tras autorización humana; las 10 migraciones en estado ✅, sin errores |
| `d1_migrations` después | **10 filas**, 10 nombres distintos, todas con `applied_at`, orden `0001`→`0010` |
| Inventario remoto | **28 tablas** (26 de dominio + `d1_migrations` + `_cf_KV` interna), **24 índices**, **33 triggers** |
| Paridad con el baseline local | nombres de tablas, índices y triggers **idénticos**; la única diferencia es la tabla interna (`_cf_KV` remota vs `_cf_METADATA` local) |
| `PRAGMA foreign_key_check` · `PRAGMA foreign_keys` | 0 violaciones · `1` (claves foráneas aplicadas) |
| Datos de dominio | usuarios 0 · grupos 0 · asignaturas 0 · actividades 0 · sesiones 0 · documentos 0 · intentos 0 · auditoría 0 · contenidos 0 |
| Seed · deploy · secrets | **no** · **no** · **no** |

Wrangler imprimió su pregunta de confirmación y la respondió con su valor por defecto porque el proceso no es interactivo (`🤖 Using fallback value in non-interactive context: yes`): la autorización humana efectiva de este paso fue la del responsable, otorgada antes de ejecutar el comando. El bookmark previo queda registrado por si alguna vez hace falta restaurar este estado.

### Verificación de B2.3b (2026-09-23) — seed ficticio aplicado

| Paso | Resultado |
|---|---|
| Conteos previos (SELECT) | todas las tablas de dominio en 0: usuarios, roles, grupos, asignaturas, contenidos, activaciones, sesiones, inscripciones, asignaciones, publicaciones, auditoría |
| Inspección del seed (101 líneas, sin cambios) | sólo fixtures ficticios; `INSERT OR IGNORE` (idempotente por inspección); **sin** `BEGIN TRANSACTION`, `COMMIT`, `ROLLBACK`, `DELETE`, `DROP` ni `ALTER` |
| Bookmark PRE-SEED | `00000004-00000000-000050ef-20e9b76105f61fe5629e9a808f3d9572` |
| `wrangler d1 execute profemacon-beta-remote --remote --env beta --file=seed/001-datos-ficticios.sql` | ejecutado **una sola vez** tras autorización humana; exit 0 · **16 consultas** · 64 filas leídas · **54 filas escritas** · `changes: 22` · “if the execution fails to complete, your DB will return to its original state and you can safely retry” |
| Bookmark resultante | `00000005-00000006-000050ef-f19d0681d597bb310a77f15b043ba5d1` |

Fixtures verificados con `SELECT`:

| Objeto | Resultado |
|---|---|
| `usuarios` (2) | `ana.docente` · “Ana Docente (prueba)” · `ana.docente@example.test` · rol `docente` — `estudiante.demo` · “Estudiante Demo (prueba)” · `estudiante.demo@example.test` · rol `estudiante` |
| `roles` (4) | administrador, docente, estudiante, practicante |
| `usuario_roles` (2) | una asociación por usuario, coherente con su rol |
| `asignaturas` (1) | `programacion-demo` · “Programación (demo)” · activa |
| `ediciones_anuales` (1) | 2026 · “Programación 2026 (demo)” · activa |
| `grupos` (1) | `DEMO-A` · “Grupo de demostración A” · activo |
| `inscripciones` (1) | `estudiante.demo` en `DEMO-A` (activa) |
| `asignaciones_grupo` (1) | `ana.docente` en `DEMO-A` (docente, activa) |
| `mapeos_grupo_origen` (1) | `portafolio: programacion demo / grupo demo a / 2026` → `DEMO-A` |
| `contenidos` / `versiones_contenido` / `publicaciones_contenido` (1/1/1) | `bienvenida-demo` · unidad `inicio` · activo · v1 · `content/demo/bienvenida.md` · **publicada** para `DEMO-A` |
| `activaciones_cuenta` (2) | `demo-activacion-docente` y `demo-activacion-estudiante`, `expira_en` 2099-12-31, sin consumir y sin revocar, `codigo_hash` de 64 caracteres (no se registra su valor) |
| `eventos_auditoria` | **0 filas**: el seed no escribe auditoría |
| Ausencias confirmadas | documentos 0 · sesiones 0 · intentos 0 · respuestas 0 · calificaciones 0 · importaciones 0 · preguntas 0 · habilitaciones 0 · credenciales 0 |
| Integridad y esquema | `foreign_key_check` = **0** · `d1_migrations` = **10** filas (sin cambios) · 26 tablas de dominio + `d1_migrations` + `_cf_KV` (28 en total) · 24 índices · 33 triggers → **el seed no alteró el esquema** |

**Sobre los códigos demo:** `PM-DEMO-ESTUDIANTE-2026` y `PM-DEMO-DOCENTE-2026` están publicados en el `README.md` del repositorio y quedan activos hasta 2099. Se aceptan **exclusivamente** porque esta beta A1 contiene sólo datos ficticios, es efímera y su URL no se publicita; **no** es apta para datos reales y esas cuentas deberán eliminarse o archivarse antes de cualquier dato real.

No hubo deploy, ni secretos, ni seed adicional (`variables-java` queda fuera de B2.3b), ni escrituras fuera del seed versionado.

## Pendientes de A1

1. **B2.4 — primer deploy del Worker beta**, tras `npm run beta:build`. Crea el contenedor del Worker y habilita los secrets.
2. **B2.2 — `DOCUMENT_HMAC_KEY` de beta**: generar y custodiar la clave fuera del agente y cargarla con `wrangler secret put DOCUMENT_HMAC_KEY --env beta` **después** de ese deploy y antes del recorrido de humo.
3. **B2.5 — recorrido de humo**: `npm run beta:smoke -- https://<host-beta>`.
4. Export y bookmark del estado verificado; registro del resultado en `docs/estado-actual-interno.md`.
5. Cierre: decidir si la beta se destruye al terminar A1.
6. Todo lo de A2 (rate limiting, restablecimiento de contraseña, revocación global de sesiones, limpieza de sesiones y activaciones, auditoría consultable, privacidad, pruebas negativas de authz y revisión de errores) sigue bloqueando el uso con datos reales.


