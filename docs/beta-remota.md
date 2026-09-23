# Beta remota ficticia (A1)

Estado: **B1 completado**, **B2.1 completado** (D1 remota ficticia creada y registrada en `env.beta`) y **B2.2 bloqueado**: Cloudflare no lista ni acepta secrets antes del primer deploy del Worker `profemacon-net-2-beta`, así que el secreto se cargará después de ese deploy. Sin migraciones aplicadas, sin seed, sin Worker desplegado y sin datos reales.
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

El seed remoto se ejecuta, en B2, con el endpoint de importación de D1 (el archivo no debe contener `BEGIN TRANSACTION` ni `COMMIT`):

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

- `version: production`, 1 tabla: **`d1_migrations`, vacía** (ver corrección más abajo), `jurisdiction: null`, 24.6 kB;
- 1 consulta de lectura y 1 de escritura en 24 h (3 filas leídas, 5 escritas);
- las 10 migraciones (`0001`–`0010`) siguen **pendientes**: ninguna se aplicó;
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

## Pendientes de A1

1. **B2.3 — esquema y datos ficticios**: inventario de esquema read-only (`SELECT` de `sqlite_master`, no `migrations list`), bookmark previo, `migrations apply` de `0001`–`0010` y seed exclusivamente con `seed/001-datos-ficticios.sql`. No requiere el secreto.
2. **B2.4 — primer deploy del Worker beta**, tras `npm run beta:build`. Crea el contenedor del Worker y habilita los secrets.
3. **B2.2 — `DOCUMENT_HMAC_KEY` de beta**: generarla y custodiarla fuera del agente y cargarla con `wrangler secret put DOCUMENT_HMAC_KEY --env beta` **después** de ese deploy y antes del recorrido de humo.
4. **B2.5 — recorrido de humo**: `npm run beta:smoke -- https://<host-beta>`.
5. Export y bookmark del estado verificado; registro del resultado en `docs/estado-actual-interno.md`.
6. Cierre: decidir si la beta se destruye al terminar A1.
7. Todo lo de A2 (rate limiting, restablecimiento de contraseña, revocación global de sesiones, limpieza de sesiones y activaciones, auditoría consultable, privacidad, pruebas negativas de authz y revisión de errores) sigue bloqueando el uso con datos reales.


