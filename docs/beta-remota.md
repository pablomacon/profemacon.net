# Beta remota ficticia (A1)

Estado: **B1 completado** (preparación local). El bloque **B2 — provisionamiento remoto** todavía no se ejecutó.
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

## Pendientes de A1

1. **B2 — provisionamiento remoto ficticio**: crear la D1, cargar el secreto, aplicar migraciones, sembrar, desplegar y recorrer el smoke test, todo con confirmaciones humanas.
2. Export y bookmark del estado verificado; registro del resultado en `docs/estado-actual-interno.md`.
3. Cierre: decidir si la beta se destruye al terminar A1.
4. Todo lo de A2 (rate limiting, restablecimiento de contraseña, revocación global de sesiones, limpieza de sesiones y activaciones, auditoría consultable, privacidad, pruebas negativas de authz y revisión de errores) sigue bloqueando el uso con datos reales.


