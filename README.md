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

La migración está en `migrations/0001_nucleo_academico.sql` y los datos de prueba, deliberadamente separados, en `seed/001-datos-ficticios.sql`. Wrangler guarda la base local en `.wrangler/`, que está ignorada por Git.

## Verificaciones

```bash
npm run build
```

## Estructura

- `src/`: pantalla React temporal.
- `worker/`: punto de entrada del Worker y tipo del binding D1.
- `migrations/`: esquema SQL versionado.
- `seed/`: datos ficticios opcionales para desarrollo local.
- `assets/`: logos existentes reutilizados por la portada.
- `wrangler.jsonc`: definición local de Worker y D1. El `database_id` de ceros es un marcador local; no representa ni crea una base remota.

## Próximas etapas

Autenticación, paneles, contenidos, actividades y las integraciones de los sistemas existentes se implementarán en etapas posteriores.
