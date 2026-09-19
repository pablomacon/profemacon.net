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

Las contraseñas se derivan con PBKDF2-HMAC-SHA-256, sal aleatoria por cuenta y 600.000 iteraciones. Después de cinco fallos la credencial se bloquea durante 15 minutos. Las respuestas de error no distinguen entre usuario, código o contraseña incorrectos.

## Sesiones

- Token aleatorio de 256 bits; D1 conserva solamente SHA-256 del token.
- Cookie `HttpOnly`, `SameSite=Strict`, `Path=/` y `Secure` bajo HTTPS.
- Vencimiento absoluto a las 8 horas.
- Vencimiento por inactividad a los 30 minutos.
- Cierre explícito con revocación inmediata en D1.
- Validación del encabezado `Origin` en operaciones de autenticación que modifican estado.

## Pendiente antes de usar datos reales

- Definir custodia y rotación del secreto HMAC.
- Implementar revocación y reemisión administrativa de códigos perdidos.
- Implementar restablecimiento de contraseña por docente o administrador.
- Revisar los plazos de sesión con la dinámica real del aula.
- Añadir limitación de frecuencia por origen además del bloqueo por cuenta.
- Preparar aviso de privacidad, política de conservación y procedimiento de rectificación.
