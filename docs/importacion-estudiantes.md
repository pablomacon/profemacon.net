# Importación administrativa de estudiantes

Estado: lector y validación segura implementados; aplicación a D1 pendiente.

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

La base no es todavía el usuario final. Al aplicar una importación se deberá agregar un sufijo corto derivado criptográficamente de la huella del documento, no de sus últimos dígitos. Esto permitirá resolver colisiones sin revelar el documento.

## Documentos

Los puntos, guiones y espacios se eliminan únicamente para comparar documentos. El resultado permanece como texto para conservar ceros iniciales y permitir pasaportes alfanuméricos.

El archivo no informa el tipo de documento. Un valor numérico de siete u ocho dígitos puede marcarse como “cédula uruguaya probable”, pero no debe confirmarse automáticamente. Los valores alfanuméricos y los casos ambiguos deben revisarse durante la confirmación del lote.

Antes de guardar un documento, el Worker deberá calcular HMAC-SHA-256 con un secreto externo a D1. Solamente se almacenarán la huella, el tipo confirmado, país emisor y una terminación corta para reconocimiento administrativo.

## Flujo pendiente de aplicación

1. Subir o seleccionar el portafolio.
2. Ejecutar la previsualización sin persistir datos.
3. Confirmar la asignatura, edición y grupo de destino.
4. Resolver documentos ambiguos y posibles coincidencias con cuentas existentes.
5. Generar nombres de usuario finales y códigos de activación.
6. Aplicar usuarios, roles, documentos e inscripciones en una transacción.
7. Registrar solamente la huella y metadatos del lote en `importaciones_estudiantes`.
8. Producir un archivo privado para la entrega individual de accesos.
9. No conservar el portafolio original dentro del repositorio.
