# Autenticación local e identidad de estudiantes

Estado: primera implementación local validada.

## Decisión

La plataforma no usa Google OAuth para el acceso habitual. Cada persona se relaciona con los datos académicos mediante el `id` interno de `usuarios`, que no cambia aunque cambien su documento, nombre de usuario o contraseña.

El nombre de usuario se genera de forma controlada y no contiene la cédula ni el pasaporte. La convención implementada es `primernombre.primerapellidosignificativo.sufijo`, donde el sufijo usa 12 caracteres de la huella HMAC y no revela dígitos del documento.

## Documentos

Los documentos son identificadores administrativos, no credenciales. `documentos_usuario` admite cédula uruguaya, pasaporte u otro documento, conserva identificadores históricos y permite marcar solamente uno como principal.

El número completo no se guarda. Antes de persistirlo, el Worker lo normaliza y calcula un HMAC-SHA-256 con un secreto dedicado almacenado fuera de D1. La base conserva la huella y una terminación corta para reconocimiento administrativo. La previsualización y aplicación del importador ya realizan este cálculo; falta configurar y custodiar el secreto en el entorno remoto.

Cuando un estudiante sustituye un pasaporte por una cédula:

1. se localiza y confirma manualmente la cuenta existente;
2. se agrega el nuevo documento a esa misma cuenta;
3. el documento anterior pasa a histórico;
4. no cambian el usuario, las inscripciones ni los resultados;
5. el cambio queda registrado en auditoría.

## Activación y contraseña

Las cuentas son creadas por personal autorizado. El estudiante recibe un nombre de usuario y un código aleatorio de un solo uso. Al activarse establece una contraseña de entre 12 y 128 caracteres.

El resultado de una importación ofrece fichas individuales para copiar o imprimir un acceso por vez. La ficha omite documentos administrativos, recuerda el vencimiento de 14 días y el cierre de sesión en equipos compartidos. Los códigos se retiran de la pantalla cuando el docente confirma la entrega de todas las fichas; esa confirmación todavía no se registra en D1.

La ruta docente `/docente/activaciones` permite seleccionar únicamente cuentas todavía sin contraseña dentro de grupos autorizados. La reemisión exige confirmar identidad y motivo, revoca todos los códigos anteriores, crea uno nuevo por 14 días y registra la acción en auditoría sin conservar el código en claro. Una cuenta ya activada queda fuera de este flujo y requiere restablecimiento de contraseña.

Las contraseñas se derivan con PBKDF2-HMAC-SHA-256, sal aleatoria de 16 bytes por cuenta y 32 bytes derivados. La política vive en `worker/auth-crypto.ts` (`PASSWORD_POLICY`) y está versionada por credencial: `credenciales_locales` conserva `algoritmo`, `formato` e `iteraciones`.

- `formato`: `v1` (PBKDF2-HMAC-SHA-256, sal de 16 bytes, derivación de 32 bytes, base64).
- Objetivo de creación: **100.000** iteraciones. Toda credencial nueva se crea con ese costo.
- Mínimo verificable: **50.000** iteraciones. Es el mínimo de seguridad que la aplicación acepta *verificar* —no un piso de creación— y una credencial por debajo falla cerrada.
- Máximo soportado: **100.000** iteraciones, el techo duro del runtime de Cloudflare. WebCrypto rechaza PBKDF2 por encima de ese valor y el tope no es configurable por wrangler, por flags de compatibilidad ni por plan.
- Rehash al iniciar sesión: **desactivado**. Una segunda derivación en el mismo request duplicaría el costo de CPU y todavía no se midió el `cpuTime` real en Workers; se reevalúa en A2.

La verificación usa siempre el costo persistido en la fila, nunca el objetivo vigente: no hay clamp ni degradación silenciosa. Después de cinco fallos la credencial se bloquea durante 15 minutos. Las respuestas de error no distinguen entre usuario, código o contraseña incorrectos. Una credencial fuera del rango soportado no se verifica, no cuenta como intento fallido, no bloquea la cuenta y no crea sesión: `POST /api/auth/*` responde `500` con `{ code: "INTERNAL_ERROR" }` y un registro de mensaje fijo, sin datos sensibles.

## Sesiones

- Token aleatorio de 256 bits; D1 conserva solamente SHA-256 del token.
- Cookie `HttpOnly`, `SameSite=Strict`, `Path=/` y `Secure` bajo HTTPS.
- Vencimiento absoluto a las 8 horas.
- Vencimiento por inactividad a los 30 minutos.
- Cierre explícito con revocación inmediata en D1.
- Validación del encabezado `Origin` en operaciones de autenticación que modifican estado.
- Versión de autenticación por cuenta: cada usuario tiene una `auth_version` vigente (`usuarios.auth_version`, entero que nace en `1`) y cada sesión conserva una **copia inmutable** de la versión que regía cuando se creó (`sesiones_usuario.auth_version`).
- Una sesión sólo es válida si su versión es **igual** a la vigente. La creación copia la versión en la misma sentencia `INSERT … SELECT` —sin leerla antes en TypeScript— y el disparador de `0012` rechaza cualquier sesión que nazca con una versión distinta.
- Revocación global (`worker/session-revocation.ts`): incrementa la versión de la cuenta y revoca explícitamente sus sesiones vigentes dentro de un único `db.batch()` atómico, y audita `sessions_revoked` con metadata mínima (motivo y actor; nunca token, cookie, contraseña, hash ni IP). El incremento **no** lleva condición de techo: si una cuenta llegara al máximo del `CHECK`, el batch completo se aborta y no queda ni una sesión revocada ni un evento a medias.
- El logout individual revoca sólo esa sesión y **no** cambia la versión; no se registra como `sessions_revoked`.
- La revocación global es todavía una **primitiva interna**: no existe endpoint público ni administrativo que la invoque. La usarán el cambio y el restablecimiento de contraseña.

## Pendiente antes de usar datos reales

- Definir custodia y rotación del secreto HMAC.
- Implementar restablecimiento de contraseña por docente o administrador (la primitiva de revocación global ya existe y es la que debe invocarse después de cambiar o restablecer una contraseña).
- Revisar los plazos de sesión con la dinámica real del aula.
- Añadir limitación de frecuencia por origen además del bloqueo por cuenta.
- Preparar aviso de privacidad, política de conservación y procedimiento de rectificación.
