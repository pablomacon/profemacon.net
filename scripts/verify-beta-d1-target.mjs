#!/usr/bin/env node
// Guarda local y de sólo lectura para el destino beta remoto ficticio.
//
//   node scripts/verify-beta-d1-target.mjs --dry             etapa local (marcador de ceros aceptado)
//   node scripts/verify-beta-d1-target.mjs --require-real    previo a operaciones remotas (exige UUID real)
//   node scripts/verify-beta-d1-target.mjs --config <ruta>   usa otra configuración (pruebas)
//
// No ejecuta Wrangler, no consulta Cloudflare, no escribe archivos y nunca
// muestra secretos: sólo lee `wrangler.jsonc` y comprueba que el entorno beta
// apunte adonde debe apuntar.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BetaTargetError,
  defaultConfigPath,
  formatTargetReport,
  readBetaTarget,
  validateBetaTarget,
} from "./beta-target.mjs";

const EXIT_OK = 0;
const EXIT_INCONSISTENT = 1;
const EXIT_USAGE = 2;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Uso:
  node scripts/verify-beta-d1-target.mjs --dry             verifica la etapa local (marcador de ceros aceptado)
  node scripts/verify-beta-d1-target.mjs --require-real    exige un database_id real antes de operar en remoto
  node scripts/verify-beta-d1-target.mjs --config <ruta>   verifica otra configuración (uso en pruebas)

Códigos de salida: 0 correcto, 1 configuración inconsistente, 2 uso incorrecto.
Esta guarda no ejecuta Wrangler, no consulta Cloudflare y no imprime secretos.`;

function parseArguments(argv) {
  const options = { mode: "strict", configPath: defaultConfigPath(projectRoot), help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry") {
      options.mode = "local";
    } else if (flag === "--require-real") {
      options.mode = "strict";
    } else if (flag === "--config") {
      const value = argv[index + 1];
      if (!value) {
        options.error = "Falta la ruta que sigue a --config.";
        return options;
      }
      options.configPath = resolve(value);
      index += 1;
    } else if (flag === "--help" || flag === "-h") {
      options.help = true;
    } else {
      options.error = `Argumento no reconocido: ${flag}`;
      return options;
    }
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (options.error !== null) {
  console.error(`${options.error}\n\n${USAGE}`);
  process.exit(EXIT_USAGE);
}
if (options.help) {
  console.log(USAGE);
  process.exit(EXIT_OK);
}
if (!existsSync(options.configPath)) {
  console.error(`No existe la configuración indicada: ${options.configPath}`);
  process.exit(EXIT_INCONSISTENT);
}

try {
  const target = readBetaTarget(options.configPath);
  const allowPlaceholder = options.mode === "local";
  const result = validateBetaTarget(target, { allowPlaceholder });
  for (const line of formatTargetReport(target, result, { mode: options.mode })) console.log(line);
  process.exit(result.ok ? EXIT_OK : EXIT_INCONSISTENT);
} catch (error) {
  if (error instanceof BetaTargetError) {
    console.error(`Configuración ilegible: ${error.message}`);
    process.exit(EXIT_INCONSISTENT);
  }
  console.error(`Fallo inesperado de la guarda: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_INCONSISTENT);
}
