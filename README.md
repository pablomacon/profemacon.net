# Profe Macón 2.0 — beta

Base técnica local de la nueva plataforma educativa. Esta primera etapa usa **TypeScript**, **React**, **Cloudflare Workers** y una base **Cloudflare D1 local** administrada por Wrangler.

No contiene credenciales, estudiantes reales, archivos `.env` ni configuración de una base remota. Los sistemas de actividades existentes aún no se migran ni se modifican.

## Requisitos

- Node.js 20 o superior.
- npm (incluido con Node.js).

## Instalar dependencias

```bash
npm install
```

## Ejecutar la web localmente

```bash
npm run dev
```

Vite mostrará la dirección local, normalmente `http://localhost:5173`. El complemento de Cloudflare ejecuta la aplicación en el entorno de desarrollo de Workers y proporciona el binding D1 `DB`.

## Base D1 local

Aplicar la estructura versionada:

```bash
npm run db:migrate:local
```

Cargar datos ficticios mínimos, sólo después de aplicar la migración:

```bash
npm run db:seed:local
```

Las migraciones versionadas están en `migrations/`: núcleo académico (`0001`), actividades autocorregibles (`0002`), acceso y publicaciones (`0003`) y autenticación propia (`0004`). Los datos de prueba están deliberadamente separados en `seed/001-datos-ficticios.sql`. Wrangler guarda la base local en `.wrangler/`, que está ignorada por Git.

La migración `0003` prepara sesiones con tokens almacenados solamente como hash, asignaciones de docentes y practicantes, materiales versionados, publicaciones por grupo y auditoría. La tabla de identidades externas queda sin uso; la autenticación activa es la implementación local de `0004`.

El acceso no depende de Google: las cuentas son creadas de forma controlada, se activan una sola vez y luego utilizan un nombre de usuario independiente del documento. El Worker expone `POST /api/auth/activate`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/session` y `GET /api/me/courses`. Las contraseñas usan PBKDF2-HMAC-SHA-256 con sal única y 600.000 iteraciones; las sesiones vencen después de 30 minutos de inactividad o al alcanzar 8 horas.

Para probar la activación exclusivamente con datos ficticios locales, después de ejecutar las migraciones y la semilla puede utilizarse `estudiante.demo` con el código `PM-DEMO-ESTUDIANTE-2026`. La interfaz solicitará crear una contraseña de al menos 12 caracteres. Estos datos de demostración no deben copiarse a una base remota.

## Piloto de actividades autocorregibles

La migración `0002_actividades_autocorregibles.sql` agrega actividades, preguntas, habilitaciones, intentos, respuestas y calificaciones docentes. Para cargar solamente el contenido público del piloto local de Variables en Java:

```bash
npm run db:seed:variables-pilot:local
```

Las claves de corrección se importan por separado desde `private/`, carpeta ignorada por Git. Nunca deben incluirse en React, `assets/`, `content/` ni archivos públicos.

## Verificaciones

```bash
npm run build
```

## Estructura

- `src/courses/`: unidades organizadas por asignatura; los elementos reutilizables de lecciones están en `shared/` y cada unidad tiene su propia carpeta.
- `content/<asignatura>/<unidad>/material.md`: material editorial de cada unidad, separado de los componentes React.
- `src/`: aplicación React y navegación general.
- `worker/`: punto de entrada del Worker y tipo del binding D1.
- `migrations/`: esquema SQL versionado.
- `seed/`: datos ficticios opcionales para desarrollo local.
- `assets/`: logos existentes reutilizados por la portada.
- `wrangler.jsonc`: definición local de Worker y D1. El `database_id` de ceros es un marcador local; no representa ni crea una base remota.

## Próximas etapas

Completar la importación administrativa de cuentas, conectar `Mis cursos` con el catálogo autorizado, habilitar la entrega de actividades y construir los paneles docente y de practicante.
