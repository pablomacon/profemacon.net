# Importación administrativa de estudiantes

Estado: lector compartido, validación, interfaz administrativa, previsualización autorizada y aplicación transaccional a D1 implementados. La entrega privada de activaciones y la configuración del entorno real continúan pendientes.

## Formato de origen confirmado

El formato fue verificado con un portafolio real sin conservar ni mostrar sus datos individuales.

La validación del ejemplo encontró 19 estudiantes válidos, ninguna fila inválida, ningún documento duplicado y ninguna colisión en la base propuesta para el nombre de usuario.

Nombre de archivo observado:

```text
Portafolio_PROGRAMACION_Grupo_1__MG_2025_2025-11-24.xlsx
```

El lector interpreta:

- asignatura: `PROGRAMACION`;
- grupo de origen: `Grupo_1__MG`;
- etiqueta legible: `Grupo 1 · MG`;
- año académico: `2025`;
- fecha de exportación: `2025-11-24`.

La primera hoja contiene estos encabezados:

| Columna | Contenido | Tratamiento |
| --- | --- | --- |
| A | N.º de lista | Ignorado |
| B | Nombre en formato `APELLIDOS, NOMBRES` | Separado y conservado |
| C | Documento | Normalizado como texto; nunca como número |
| D | Fecha de nacimiento | Ignorada y no devuelta por el lector |
| E | Vigencia del carné de salud | Ignorada y no devuelta por el lector |

La fecha de nacimiento y la información de salud no son necesarias para la finalidad educativa de la plataforma. No deben almacenarse, registrarse ni copiarse a archivos intermedios.

## Lector implementado

El comando de previsualización es:

```bash
npm run students:preview -- "ruta/al/Portafolio_....xlsx"
```

La salida contiene solamente metadatos agregados:

- asignatura, grupo, año y fecha detectados;
- hoja y columnas utilizadas;
- cantidad de filas válidas e inválidas;
- formas probables de documento;
- duplicados de documento;
- colisiones en la base del nombre de usuario.

No imprime nombres, documentos ni fechas personales.

El lector impone límites de tamaño, sólo extrae las entradas XML necesarias del XLSX, rechaza fórmulas en nombre o documento y exige exactamente una coma para separar apellidos de nombres.

## Nombres de usuario

La base provisional se genera con el primer nombre y el primer componente significativo del apellido:

```text
Ana María de los Santos Pérez → ana.santos
```

El usuario final agrega a esa base un sufijo de 12 caracteres derivado de la huella HMAC del documento, nunca de sus últimos dígitos. El nombre de usuario no cambia si posteriormente se agrega otro documento a la cuenta.

## Documentos

Los puntos, guiones y espacios se eliminan únicamente para comparar documentos. El resultado permanece como texto para conservar ceros iniciales y permitir pasaportes alfanuméricos.

El archivo no informa el tipo de documento. Un valor numérico de siete u ocho dígitos puede marcarse como “cédula uruguaya probable”, pero no debe confirmarse automáticamente. Los valores alfanuméricos y los casos ambiguos deben revisarse durante la confirmación del lote.

Antes de guardar un documento, el Worker deberá calcular HMAC-SHA-256 con un secreto externo a D1. Solamente se almacenarán la huella, el tipo confirmado, país emisor y una terminación corta para reconocimiento administrativo.

## Flujo de aplicación implementado

1. El lector local extrae únicamente nombres, apellidos y documentos.
2. Antes de enviar el lote se debe confirmar el tipo y país emisor de cada documento.
3. `POST /api/student-imports/preview` verifica sesión, origen, autorización docente o administrativa y el mapeo explícito del grupo, sin persistir el lote.
4. La previsualización informa cuentas nuevas, coincidencias existentes, activaciones necesarias y conflictos.
5. `POST /api/student-imports/apply` repite todas las validaciones y aplica usuarios, roles, documentos, inscripciones, activaciones y auditoría mediante un único `DB.batch` transaccional.
6. Una cuenta existente se reutiliza. Sus nombres no se sobrescriben y sólo recibe un código nuevo si todavía no posee credenciales.
7. Los códigos se devuelven en claro una sola vez; D1 conserva únicamente su SHA-256 y revoca códigos anteriores pendientes.
8. El archivo original y los documentos en claro no se guardan en D1 ni dentro del repositorio.

La tabla `mapeos_grupo_origen`, creada por la migración `0006`, evita que el nombre de un archivo seleccione libremente un grupo interno. El docente debe tener además una asignación activa sobre el grupo; un administrador puede operar cualquier mapeo activo.

El Worker requiere el secreto `DOCUMENT_HMAC_KEY`, de al menos 32 caracteres, configurado fuera del repositorio. Sin él los endpoints responden con indisponibilidad y no procesan documentos.

La ruta `/docente/importar-estudiantes` implementa el asistente de cuatro etapas. El lector funciona tanto desde el navegador como desde el comando de consola mediante un único núcleo compartido. Después de una aplicación correcta, la interfaz descarta de memoria el portafolio y los documentos normalizados; conserva solamente el resultado y los códigos efímeros mientras la pantalla permanezca abierta.

Playwright comprueba el acceso sin sesión, la restricción para estudiantes, el estado inicial del asistente y la ausencia de desbordamiento horizontal en escritorio y móvil. La comprobación opcional con un portafolio autorizado valida la lectura completa en el navegador sin solicitar previsualización al Worker, aplicar el lote ni generar capturas con datos personales.

El entorno local usa `.dev.vars`, ignorado por Git. `.dev.vars.example` documenta únicamente el nombre de la variable y nunca debe contener una clave real.

## Trabajo pendiente

- definir un mecanismo privado para descargar o entregar individualmente los códigos mostrados una sola vez;
- configurar y custodiar `DOCUMENT_HMAC_KEY` en el entorno remoto;
- ampliar las pruebas de navegador al flujo de confirmación, previsualización y aplicación usando exclusivamente datos ficticios.
