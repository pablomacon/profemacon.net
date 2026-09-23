#!/usr/bin/env node
// Build del entorno beta remoto ficticio, en dos pasos y de forma portable en Windows.
//
//   npm run beta:build
//
// Fija CLOUDFLARE_ENV=beta sólo para los procesos hijos (el plugin de Vite elige
// el entorno en build time), ejecuta `tsc -b` y `vite build`, y comprueba el
// config aplanado que queda en `dist/`. No despliega, no configura secretos y no
// ejecuta ningún comando de Wrangler.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BETA_ENVIRONMENT,
  BETA_WORKER_NAME,
  BetaTargetError,
  configDirectory,
  defaultConfigPath,
  findFlattenedConfig,
  readBetaTarget,
  validateBetaTarget,
  verifyFlattenedBetaConfig,
} from "./beta-target.mjs";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = defaultConfigPath(projectRoot);
const distDir = join(projectRoot, "dist");

const USAGE = `Uso:
  node scripts/build-beta.mjs            compila el entorno beta y verifica el config aplanado
  node scripts/build-beta.mjs --help     muestra esta ayuda

Códigos de salida: 0 correcto, 1 build o verificación fallidos, 2 uso incorrecto.
Este comando es local: no despliega ni ejecuta operaciones remotas.`;

if (process.argv.slice(2).some((flag) => flag === "--help" || flag === "-h")) {
  console.log(USAGE);
  process.exit(EXIT_OK);
}
if (process.argv.slice(2).length > 0) {
  console.error(`Argumento no reconocido: ${process.argv[2]}\n\n${USAGE}`);
  process.exit(EXIT_USAGE);
}

function runStep(label, entryPoint, args) {
  const entry = join(projectRoot, "node_modules", ...entryPoint);
  if (!existsSync(entry)) {
    console.error(`No se encontró ${entry}. Ejecutá npm install antes del build beta.`);
    return false;
  }
  console.log(`\n== ${label} ==`);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_ENV: BETA_ENVIRONMENT, WRANGLER_SEND_METRICS: "false" },
  });
  if (result.error) {
    console.error(`No fue posible ejecutar ${label}: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`\n${label} terminó con código ${result.status}.`);
    return false;
  }
  return true;
}

/**
 * El plugin de Vite copia el `.dev.vars` local dentro del directorio del artefacto.
 * Esa copia no debe viajar con el deploy remoto: se elimina de forma explícita
 * después del build. No se lee, imprime ni compara su contenido, y el `.dev.vars`
 * del proyecto no se toca.
 */
function purgeLocalSecretsCopy(artifactDirectory) {
  const artifactSecrets = join(artifactDirectory, ".dev.vars");
  if (!existsSync(artifactSecrets)) {
    console.log(`Sin copia local de secretos en el artefacto (${relative(projectRoot, artifactSecrets)}).`);
    return true;
  }
  try {
    rmSync(artifactSecrets, { force: true });
  } catch {
    console.error("FALLA No fue posible eliminar la copia local de secretos del artefacto.");
    return false;
  }
  if (existsSync(artifactSecrets)) {
    console.error("FALLA La copia local de secretos sigue presente en el artefacto.");
    return false;
  }
  console.log(`Copia local de secretos eliminada del artefacto (${relative(projectRoot, artifactSecrets)}).`);
  return true;
}

/** Verificación final: el artefacto no puede contener archivos de secretos locales. */
function artifactHasNoLocalSecrets(artifactDirectory) {
  const artifactSecrets = join(artifactDirectory, ".dev.vars");
  if (existsSync(artifactSecrets)) {
    console.error(`FALLA El artefacto contiene ${relative(projectRoot, artifactSecrets)}. No desplegar.`);
    return false;
  }
  console.log(`Verificado: ${relative(projectRoot, artifactSecrets)} no existe en el artefacto.`);
  return true;
}

console.log(`Build beta local con CLOUDFLARE_ENV=${BETA_ENVIRONMENT} y Worker objetivo ${BETA_WORKER_NAME}.`);

try {
  const target = readBetaTarget(configPath);
  const guard = validateBetaTarget(target, { allowPlaceholder: true });
  if (!guard.ok) {
    console.error("\nLa configuración beta es inconsistente. Ejecutá npm run beta:verify-target y corregila.\n");
    for (const entry of guard.checks.filter((check) => check.status !== "ok")) console.error(`  FALLA ${entry.id}: ${entry.detail}`);
    process.exit(EXIT_FAILED);
  }
  console.log("Guarda de destino: coherente (ver scripts/verify-beta-d1-target.mjs).");
} catch (error) {
  console.error(error instanceof BetaTargetError ? `Configuración ilegible: ${error.message}` : `Fallo al leer la configuración: ${String(error)}`);
  process.exit(EXIT_FAILED);
}

if (!runStep("tsc -b", ["typescript", "bin", "tsc"], ["-b"])) process.exit(EXIT_FAILED);
if (!runStep("vite build", ["vite", "bin", "vite.js"], ["build", "--configLoader", "runner"])) process.exit(EXIT_FAILED);

const flattened = findFlattenedConfig(distDir, configPath);
if (flattened === null) {
  console.error("\nEl build no dejó un config aplanado en dist/. Revisá la salida de vite build.");
  process.exit(EXIT_FAILED);
}

console.log("\n== Higiene del artefacto beta ==");
if (!purgeLocalSecretsCopy(configDirectory(flattened.path))) process.exit(EXIT_FAILED);

const verification = verifyFlattenedBetaConfig(flattened.config, { configDir: configDirectory(flattened.path) });
console.log("\n== Verificación del config aplanado beta ==");
console.log(`Archivo: ${flattened.path}`);
for (const detail of verification.details) console.log(`  ${detail}`);
for (const error of verification.errors) console.error(`  FALLA ${error}`);
if (!verification.ok) {
  console.error("\nEl config aplanado no corresponde al entorno beta. No desplegar.\n");
  process.exit(EXIT_FAILED);
}
if (verification.databaseId.kind === "placeholder") {
  console.log("\nAVISO El database_id sigue siendo el marcador de ceros: build local válido, no desplegar todavía.");
}
if (!artifactHasNoLocalSecrets(configDirectory(flattened.path))) process.exit(EXIT_FAILED);
console.log("\nBuild beta local verificado. Este comando no desplegó nada.");
process.exit(EXIT_OK);
