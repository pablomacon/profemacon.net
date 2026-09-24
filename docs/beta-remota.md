# Beta remota ficticia (A1)

Estado: **B1 completado**, **B2.1 completado** (D1 remota creada), **B2.2 completado** (`DOCUMENT_HMAC_KEY` cargado y verificado por nombre), **B2.3a completado** (migraciones `0001`–`0010`), **B2.3b completado** (fixtures ficticios), **B2.4 completado** (Worker beta desplegado y disponible por HTTPS), **R1 completado** (migración `0011` aplicada en la D1 beta) y **R2 completado** (Worker con PBKDF2 compatible desplegado y verificado por HTTPS). **B2.5 completado** (recorrido de humo ficticio 23/23 sobre el Worker desplegado, con medición de `cpuTime`) y **A1 — infraestructura remota ficticia completada**. Sin datos reales: **A1 no autoriza datos personales reales**.
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
- **Requisito de orden (verificado el 2026-09-23):** Cloudflare no lista ni acepta secrets de un Worker inexistente. `wrangler secret list --env beta` respondía `Worker "profemacon-net-2-beta" (env: beta) not found` y sugería desplegar primero. **Resuelto en B2.4**: con el Worker ya desplegado, ese comando responde `[]` (lista vacía) y la carga del secreto queda habilitada.
- **Estado (2026-09-23):** la clave **está cargada** en el environment beta. Fue generada y cargada **manualmente por el responsable, fuera del agente**, y su custodia externa (gestor de contraseñas, etiqueta `Profe Macón beta — DOCUMENT_HMAC_KEY`) está a su cargo. `wrangler secret list --env beta` la lista **por nombre** como `secret_text` y la carga generó una versión de tipo `Secret Change`. Esta documentación **no** registra —y no debe registrar— el valor, ni su prefijo, sufijo, hash o longitud.
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

El acceso inicial usa **`workers.dev`**. No se configura dominio propio ni DNS: la validación de `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, login, logout y `Origin` no depende del dominio, porque la implementación deriva el `Origin` de la propia petición y activa `Secure` cuando la URL es https. Desde B2.4 la URL real existe y queda registrada **únicamente** en la sección «Verificación de B2.4» de este documento interno: **no** debe publicarse en el `README.md`, en los sistemas actuales ni en capturas.

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

### Verificación de B2.4 (2026-09-23) — primer deploy del Worker beta

| Paso | Resultado |
|---|---|
| Estado previo del Worker | `wrangler deployments list --name profemacon-net-2-beta` → **`This Worker does not exist on your account` (code 10007)** |
| `npm run beta:build` | exit 0 · aplanado `profemacon-net-2-beta`, `targetEnvironment: beta`, `DB` → `profemacon-beta-remote` (REAL), `ASSETS` → `../client` con fallback de página única, `workers_dev: true`; **sin** secretos, tokens ni `account_id` en el artefacto |
| Redirección `.wrangler/deploy/config.json` | `{"configPath":"..\\..\\dist\\profemacon_net_2\\wrangler.json","auxiliaryWorkers":[]}` → apunta al artefacto beta |
| Comando ejecutado (**una sola vez**, previa autorización humana) | `wrangler deploy --config dist/profemacon_net_2/wrangler.json` |
| Resultado | 85 archivos leídos · **77 assets subidos** · Total Upload 119.69 KiB (gzip 21.88 KiB) · bindings `env.DB (profemacon-beta-remote)` → D1 Database y `env.ASSETS` → Assets · `Uploaded profemacon-net-2-beta` · `Deployed profemacon-net-2-beta triggers` |
| **URL de la beta** (registro interno, no publicitar) | `https://profemacon-net-2-beta.pablomacon.workers.dev` |
| Version ID activo | `2307ceb8-7467-4c54-baac-f5e4368c58b3` |
| `deployments list` posterior | **1** deployment (2026-09-23T21:12:44.075Z · Source Upload · “Automatic deployment on upload.” · 100 %) |
| `versions list` posterior | **1** version: `2307ceb8-7467-4c54-baac-f5e4368c58b3` |
| `wrangler secret list --env beta` | **`[]`** → comando ya operativo y **sin secretos**: `DOCUMENT_HMAC_KEY` sigue ausente |
| HTTPS y rutas públicas | `https` · `GET /` → 200 `text/html` (782 bytes, `<title>Profe Macón 2.0</title>` y `/assets/index-…`) · `GET /curso/programacion-i` → 200 `text/html` · `GET /ruta-inexistente` → 200 `text/html` (fallback SPA) · `/logo-pm.svg` → 200 `image/svg+xml` · `/materiales/programacion-i/unidad-2/arreglos-introduccion/01-indices.svg` → 200 `image/svg+xml` (1208 bytes) · `/assets/index-DvxFw3A5.js` → 200 `text/javascript` (524 kB) |
| API sin sesión (sólo GET) | `GET /api/session` → **401** y `GET /api/me/courses` → **401**; sin `POST`, sin `activate`, sin `login`, sin importaciones |
| D1 | **ninguna escritura**: el deploy no toca datos. `d1 info` confirma la base disponible (`num_tables: 27`, 401 kB) |

No se configuró ningún secreto, no se ejecutó smoke autenticado, no se aplicaron migraciones ni seeds adicionales, no se configuró dominio propio ni Access, y no hubo reintentos ni segundo deploy.

### Verificación de B2.2 (2026-09-23) — `DOCUMENT_HMAC_KEY` cargado

| Paso | Resultado |
|---|---|
| Primer intento (antes del deploy) | Bloqueado: `wrangler secret list --env beta` respondía `Worker "profemacon-net-2-beta" (env: beta) not found` |
| Carga | realizada **manualmente por el responsable, fuera del agente**: la clave se generó y custodió en su gestor de contraseñas y se cargó con `wrangler secret put DOCUMENT_HMAC_KEY --env beta` |
| `wrangler secret list --env beta` | `[{ "name": "DOCUMENT_HMAC_KEY", "type": "secret_text" }]` → **un único secret, verificado por nombre** |
| `wrangler versions list --name profemacon-net-2-beta` | 2 versiones: `2307ceb8-…` (deploy de B2.4) y **`82dea70d-dfa0-4f58-806f-2ab9e285333f`** (2026-09-23T21:31:58.217Z · `Source: Secret Change`) |
| `wrangler deployments list --name profemacon-net-2-beta` | 2 deployments; el activo al 100 % es el de `Secret Change` |
| Valor del secret | **nunca pasó por Cline, Git ni esta documentación**; no se registran valor, prefijo, sufijo, hash ni longitud |
| Deploy de código adicional | **no** |
| Escrituras adicionales en D1 | **ninguna** |

Con el secret presente, los endpoints `POST /api/student-imports/preview` y `/apply` dejan de responder `503` por clave ausente. Queda B2.5 para comprobarlo de punta a punta.

### Verificación de B2.5 (2026-09-23) — primer intento FALLIDO por el tope de PBKDF2

| Paso | Resultado |
|---|---|
| Comando | `npm run beta:smoke -- https://<host-beta>` (cuenta demo ficticia; la contraseña no se imprimió ni se registró) |
| `POST /api/auth/activate` | **HTTP 500**; la activación ficticia **no** se consumió |
| `POST /api/auth/login` (reintento del propio smoke) | **HTTP 500** |
| Causa exacta (Observability) | `Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)` |
| Alcance del fallo | El runtime de Cloudflare impone un tope duro de 100.000 iteraciones de PBKDF2: no depende del plan y no es configurable en `wrangler.jsonc` |
| Escrituras en D1 | **ninguna**: la derivación falla antes de `db.batch`; `credenciales_locales = 0`, `sesiones_usuario = 0` y las activaciones demo siguen vigentes hasta 2099 |
| Datos reales | ninguno: el intento usó sólo la cuenta demo ficticia |
| Credenciales comprometidas | ninguna: no llegó a crearse ninguna credencial |
| Estado al terminar ese intento | **B2.5 no completado**; luego se corrigió el tope (R1/R2) y el reintento quedó verde (ver «Verificación de B2.5 (2026-09-23) — COMPLETADA») |

El arreglo quedó implementado y verificado **sólo en local** (política versionada con rango verificable 50.000–100.000 y objetivo de creación 100.000, migración `0011`, frontera de error saneada y pruebas contra `wrangler dev` real), pero **no se aplicó al remoto**: no se ejecutó `wrangler d1 migrations apply` sobre la D1 beta, no se desplegó el Worker y no se reintentó el smoke. El orden previsto para ese bloque es bookmark, `0011`, verificación de esquema, `beta:build`, deploy, verificación y smoke. `0011` es compatible con el Worker desplegado porque el flujo de autenticación actual falla antes de escribir; el orden inverso, en cambio, violaría el `CHECK` vigente (`>= 600000`).

La decisión sobre Workers Paid **no se toma todavía**: el plan no elimina el tope de PBKDF2, sólo amplía el presupuesto de CPU (Free: 10 ms por request). Después del deploy hay que medir el `cpuTime` real de una activación y un login con 100.000 iteraciones y recién entonces decidir.

### Verificación de R1 (2026-09-23) — migración `0011` aplicada en la D1 beta

| Paso | Resultado |
|---|---|
| Preflight | `git status` limpio · `HEAD` = `origin/main` = `ac57cc7` · `node scripts/verify-beta-d1-target.mjs --require-real` → exit 0 |
| Estado previo (sólo `SELECT`) | `credenciales_locales` = **0** · filas fuera del rango `50000`–`100000` = **0** · `d1_migrations` = **10** (`0001`–`0010`) · `pragma_foreign_key_check` = **0** · esquema de `0004` con `CHECK (iteraciones >= 600000)` y sin `formato` · fixtures: 2 usuarios, 1 grupo, 2 activaciones vigentes sin consumir, 0 sesiones, 0 intentos |
| Bookmark pre-`0011` | `0000000b-00000005-000050f0-768c7f8e957f7811f83db06306b8f754` (registrado; **no** se ejecutó `restore`) |
| Escritura remota | **una sola**: `wrangler d1 migrations apply profemacon-beta-remote --remote --env beta` (sin `-y`; Wrangler usó su valor por defecto en contexto no interactivo) |
| Resultado | `Migrations to be applied: 0011_costo_password_compatible.sql` → ejecutada (11 comandos) con estado ✅ |
| `d1_migrations` posterior | **11** filas, ids 1–11, sin duplicados, última `0011_costo_password_compatible.sql` |
| Esquema posterior | `algoritmo` con allowlist `IN ('pbkdf2-sha256')` · `formato TEXT NOT NULL DEFAULT 'v1' CHECK (formato IN ('v1'))` · `iteraciones INTEGER NOT NULL CHECK (iteraciones BETWEEN 50000 AND 100000)` · resto de columnas y defaults conservados |
| `PRAGMA table_info` | `usuario_id` (pk), `algoritmo`, `formato`, `iteraciones`, `sal_base64`, `hash_base64`, `intentos_fallidos`, `bloqueada_hasta`, `establecida_en`, `actualizada_en` |
| Datos posteriores | `credenciales_locales` = **0** · fuera de rango = **0** · usuarios 2 · grupos 1 · activaciones 2 vigentes sin consumir · sesiones 0 · intentos 0 → **ningún fixture cambió** |
| Integridad | `pragma_foreign_key_check` = **0** · 26 tablas de dominio · 24 índices · 33 disparadores (mismo inventario que B2.3a) · sin tablas auxiliares (`credenciales_locales_nueva`, `verificacion_costo_*`) |
| Lecturas | todas las consultas de verificación informaron `rows_written: 0` y `changed_db: false` |

**Estado transitorio aceptado: esquema nuevo + Worker viejo.** El Worker desplegado sigue siendo el de B2.4 (PBKDF2 con 600.000 iteraciones, que el runtime rechaza) y **no se desplegó código**. Es seguro porque el flujo de autenticación anterior ya **no podía completar** la derivación —fallaba antes de escribir— y `credenciales_locales` sigue con **0 filas**, así que no existe ninguna credencial que pudiera quedar ilegible con el `CHECK` nuevo. La ventana se cerró el 2026-09-23 con el deploy del Worker compatible (**Fase R2**, ver «Verificación de R2»).

No hubo deploy, ni seed, ni `secret put`, ni smoke, ni activaciones, ni login, ni datos reales. **B2.5 sigue pendiente y A1 sigue abierto.**

### Verificación de R2 (2026-09-23) — Worker con PBKDF2 compatible desplegado

| Paso | Resultado |
|---|---|
| Preflight | `git status --porcelain -uall` **vacío** · `HEAD` = `origin/main` = `c1054c5` · `git rev-list --left-right --count HEAD...origin/main` = `0 0` · `node scripts/verify-beta-d1-target.mjs --require-real` → exit **0** |
| Estado previo de la D1 (sólo `SELECT`/`PRAGMA`) | `d1_migrations` = **11** · `credenciales_locales` = **0** · `pragma_foreign_key_check` = **0** · 2 usuarios · 0 sesiones · todas las consultas con `rows_written: 0` y `changed_db: false` |
| `npm run beta:build` | exit **0** · aplanado `profemacon-net-2-beta`, `targetEnvironment: beta`, `DB` → `profemacon-beta-remote` (**REAL**), `ASSETS` → `../client` con fallback de página única e `index.html` verificado, `vars: {}` · la copia local de secretos (`dist/profemacon_net_2/.dev.vars`) quedó **eliminada del artefacto** y su ausencia verificada (`0` coincidencias de `.dev.vars*` en `dist/`) |
| Estado del Worker antes | `versions list` → 2 versiones (`2307ceb8-…` de B2.4 y `82dea70d-…` de `Secret Change`) · `deployments status` → activo al 100 % **`82dea70d-dfa0-4f58-806f-2ab9e285333f`** |
| Gate humano | se mostró el comando exacto, el Worker y la D1 destino, la versión activa y el alcance (cambia código; no ejecuta smoke; no toca D1; no cambia secretos) y se esperó **autorización explícita** |
| Comando ejecutado (**una sola vez**) | `wrangler deploy --config dist/profemacon_net_2/wrangler.json` (binario local `node_modules\.bin\wrangler.cmd`, Wrangler 4.112.0; `wrangler` no está en el `PATH`) |
| Resultado | 85 archivos leídos de `dist/client` · **0 assets nuevos** (huellas idénticas a las ya publicadas) · Total Upload 121.80 KiB (gzip 22.39 KiB) · bindings `env.DB (profemacon-beta-remote)` → D1 Database y `env.ASSETS` → Assets · `Uploaded profemacon-net-2-beta` · `Deployed profemacon-net-2-beta triggers` · exit **0** |
| **Version ID nuevo (activo)** | **`07d2b360-ad43-4c3c-8304-9c4ccfca8b72`** (2026-09-24T02:11:15.076Z · deployment 2026-09-24T02:11:16.436Z al 100 %) |
| **Versión anterior (rollback)** | `82dea70d-dfa0-4f58-806f-2ab9e285333f` (`Secret Change`, 2026-09-23T21:31:58.217Z) · código previo de B2.4: `2307ceb8-7467-4c54-baac-f5e4368c58b3` |
| URL | `https://profemacon-net-2-beta.pablomacon.workers.dev` (registro interno, no publicitar) |
| `wrangler secret list --env beta` | `[{ "name": "DOCUMENT_HMAC_KEY", "type": "secret_text" }]` → **sin cambios**, sigue presente; no se ejecutó `secret put` |
| HTTPS `GET /` | **200** `text/html` |
| HTTPS `GET /curso/programacion-i` | **200** `text/html` **sin `Location` ni 307** (el fallback SPA quedó corregido) |
| HTTPS `/api/session` sin cookie | **401** `application/json; charset=utf-8` (`{"error":"Sesión requerida"}`) |
| Métodos usados en la verificación HTTPS | sólo `GET`: **ningún `POST`** |
| D1 posterior | **ninguna escritura**: `d1_migrations` = 11 · `credenciales_locales` = 0 · `usuarios` = 2 · `grupos` = 1 · activaciones demo vigentes sin consumir = **2** · `sesiones_usuario` = 0 · `pragma_foreign_key_check` = **0** (`rows_written: 0`, `changed_db: false`) |
| Pruebas locales | `node --test tests/beta-infrastructure.test.mjs` → **20/20** aprobadas · `git diff --check` → sin hallazgos |
| Migraciones y seeds | **ninguno**: `0011` ya estaba aplicada desde R1 y este bloque no las volvió a ejecutar |

El deploy no activó cuentas, no inició sesión, no ejecutó `beta:smoke`, no aplicó migraciones ni seeds, no tocó `DOCUMENT_HMAC_KEY` y no escribió en D1. Con el Worker compatible ya desplegado, **B2.5 — recorrido de humo** quedó como único paso pendiente; se ejecutó más tarde el mismo día y quedó **verde**, incluida la medición del `cpuTime` real de 100.000 iteraciones (ver «Verificación de B2.5 (2026-09-23) — COMPLETADA»).

### Verificación de B2.5 (2026-09-23) — COMPLETADA

| Paso | Resultado |
|---|---|
| Gate humano | antes de ejecutar se mostró el comando exacto, se explicó el alcance (sólo `estudiante.demo`; consumo definitivo de su código de activación; creación de una credencial ficticia; creación y cierre de sesión; prueba de `Origin`; `ana.docente` intacta; sin deploy, sin migraciones y sin seeds) y se esperó **autorización explícita** |
| Custodia de la contraseña ficticia | el responsable la preparó **fuera del agente** y la inyectó en el proceso del recorrido mediante un script **fuera del repositorio**; su valor nunca pasó por Cline, Git, esta documentación ni logs persistidos, y la salida del recorrido se revisó enmascarando cookie y token |
| Comando ejecutado (**una sola vez**) | `npm run beta:smoke -- https://profemacon-net-2-beta.pablomacon.workers.dev`, contra la versión activa `07d2b360-ad43-4c3c-8304-9c4ccfca8b72` |
| Resultado | **23/23 comprobaciones correctas** con exit **0** · ningún fallo y **ningún reintento** |
| `GET /` | **200** `text/html` con el shell de la aplicación presente |
| `GET /curso/programacion-i` | **200** `text/html` · **sin `Location`** (fallback SPA corregido) · shell presente |
| Activación ficticia | `POST /api/auth/activate` → **200** en la primera corrida, con el código demo ficticio ya publicado en el `README.md` |
| Cookie de sesión | `Set-Cookie` presente con `Path=/`, `HttpOnly`, `SameSite=Strict` y `Secure`; el valor nunca se registró en esta documentación |
| `GET /api/session` | **200** autenticado y `user.username` = `estudiante.demo` |
| `GET /api/me/courses` | **200** con una lista de **1** curso |
| Actividad deshabilitada | `GET /api/me/activities/variables-java-01?groupCode=DEMO-A` → **404** `ACTIVITY_NOT_FOUND`, nunca `200` |
| `POST /api/auth/logout` | **200** y cookie de limpieza `pm_session=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0` |
| `GET /api/session` posterior | **401** |
| Login de usuario ficticio inexistente | **401**, **nunca 500** (la regresión de PBKDF2 quedó cerrada) y sin filtrado de detalles internos |
| `Origin` ajeno | **403** |
| Petición sin `Origin` | **403** |
| D1 posterior (sólo `SELECT` / `PRAGMA`) | `credenciales_locales` = **1** —sólo `estudiante.demo`— con `algoritmo = pbkdf2-sha256`, `formato = v1`, `iteraciones = 100000`, `intentos_fallidos = 0` y sin bloqueo · activación de `estudiante.demo` **consumida** (2026-09-24 02:30:54 UTC) · activación de `ana.docente` **sin consumir** · `sesiones_usuario` = **1** fila, creada a las 02:30:54 y **revocada por el logout** (0 vigentes) · `eventos_auditoria` = **1** fila nueva (`cuenta_activada`, entidad `usuario`, `datos_json` vacío) · `d1_migrations` = 11 · `usuarios` = 2 · `grupos` = 1 · `intentos_actividad` = 0 · `respuestas_intento_actividad` = 0 · `calificaciones_actividad` = 0 · `pragma_foreign_key_check` = **0** |
| `ana.docente` | **0 credenciales · 0 sesiones · activación sin consumir**: no se tocó |
| Deploy · migraciones · seeds · `secret put` | **ninguno** · **ninguna** · **ninguno** · **ninguno** |
| Datos reales | **ninguno**: sólo los fixtures ficticios ya versionados |
| Verificador opcional `students:verify-api` | no se ejecutó en este bloque |
| Pruebas locales | `node --test tests/beta-infrastructure.test.mjs` → **20/20** aprobadas · `git diff --check` → sin hallazgos |
| Lecturas remotas | todas informaron `rows_written: 0` y `changed_db: false` |

#### CPU y plan de Workers (medición real con PBKDF2 a 100.000)

Durante el recorrido se siguió el Worker con `wrangler tail --env beta --format json` (sólo lectura, en paralelo a la corrida). Los 10 eventos capturados salieron con `outcome: ok` y `exceptions: []`, **sin ningún error 1102** y sin `Pbkdf2 failed`; Cloudflare redacta por sí mismo el encabezado `cookie` del volcado:

| Endpoint | Status | wallTime | cpuTime |
|---|---|---|---|
| `POST /api/auth/activate` | 200 | 527 ms | **28 ms** |
| `POST /api/auth/login` (ruta PBKDF2, usuario inexistente) | 401 | 141 ms | **22 ms** |
| `GET /api/session` | 200 | 366 ms | 4 ms |
| `GET /api/me/courses` | 200 | 356 ms | 2 ms |
| `GET /api/me/activities/variables-java-01` | 404 | 481 ms | 2 ms |
| `POST /api/auth/logout` | 200 | 159 ms | 1 ms |
| `GET /api/session` (posterior al logout) | 401 | 139 ms | 0 ms |
| `POST /api/auth/login` (`Origin` ajeno) | 403 | 0 ms | 0 ms |
| `POST /api/auth/login` (sin `Origin`) | 403 | 0 ms | 0 ms |
| `GET /curso/programacion-i` | 200 | 9 ms | 1 ms |

**Conclusión registrada:** PBKDF2 a 100.000 iteraciones **funciona en producción sin ningún límite de CPU**: el costo medido de la derivación es de **28 ms** al crear la credencial y **22 ms** al verificarla, el recorrido completo terminó con `outcome: ok` y no apareció `1102` ni `Pbkdf2 failed`. **El plan vigente de la cuenta alcanza para este recorrido y no corresponde contratar un plan pago por estimación.** Salvedad explícita: la cifra histórica de referencia de 10 ms de CPU por request para el plan Free no coincide con el `cpuTime` medido —`cpuTime` no es `wallTime`—, el nivel del plan de la cuenta debe confirmarse en el panel de Cloudflare antes de dimensionar carga real, y esta medición es una muestra de un flujo ficticio de una sola corrida: no es una prueba de carga ni una autorización para tráfico real.


## Pendientes tras A1

**Estado: A1 — infraestructura remota ficticia COMPLETADA.** Los bloques B1, B2.1, B2.2, B2.3a, B2.3b, B2.4, R1, R2 y B2.5 quedaron cerrados y verificados sobre recursos remotos ficticios, sin ningún dato real en ningún momento. **A1 no autoriza datos personales reales**: la beta sigue conteniendo sólo fixtures ficticios y su URL sigue sin publicitarse. **Siguiente fase: A2 — seguridad operacional**, que no se inicia automáticamente.


1. **B2.5 — recorrido de humo: COMPLETADO (2026-09-23 · 23/23 · exit 0)**. Registro histórico del pendiente: el primer intento falló por el tope de PBKDF2 (ver «Verificación de B2.5»). `0011` ya está aplicada en la D1 beta (ver «Verificación de R1»), así que, con el Worker compatible ya desplegado y verificado (ver «Verificación de R2»), el único paso que falta es reintentar el recorrido. El recorrido cubre activación ficticia, login, cookies, sesión, cursos, rechazo de la actividad deshabilitada, logout, 401 posterior, 401 de un usuario inexistente y `Origin` ajeno, más el verificador opcional `students:verify-api` apuntado a la beta. Para hacerlo repetible se pasa `BETA_DEMO_PASSWORD` con la contraseña ficticia custodiada fuera del repositorio: la primera corrida consume el código de activación demo y las siguientes inician sesión con esa contraseña. `ana.docente` no se usa ni se consume en este recorrido.
2. Export y bookmark del estado verificado. El registro del resultado ya se hizo en `docs/estado-actual-interno.md` §14 (B2.5 completado y A1 cerrada).
3. Cierre: decidir si la beta se destruye al terminar A1.
4. Todo lo de A2 (rate limiting, restablecimiento de contraseña, revocación global de sesiones, limpieza de sesiones y activaciones, auditoría consultable, privacidad, pruebas negativas de authz y revisión de errores) sigue bloqueando el uso con datos reales.


