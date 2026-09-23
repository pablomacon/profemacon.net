// Utilidades locales para preparar y verificar el entorno beta remoto ficticio.
//
// Módulo puro y de sólo lectura: no ejecuta Wrangler, no consulta Cloudflare y
// no escribe archivos. Lo comparten la guarda `beta:verify-target`, el build
// `beta:build` y las pruebas de `tests/beta-infrastructure.test.mjs`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const BETA_ENVIRONMENT = "beta";
export const BETA_WORKER_NAME = "profemacon-net-2-beta";
export const BETA_DATABASE_NAME = "profemacon-beta-remote";
export const LOCAL_DATABASE_NAME = "profemacon-beta-local";
export const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const BETA_REMOTE_SUFFIX = "-remote";

// Invariantes del entorno top-level local. Si dejan de cumplirse, la beta
// tampoco debe avanzar: primero se arregla la configuración local.
export const TOP_LEVEL_EXPECTATIONS = {
  name: "profemacon-net-2",
  compatibilityDate: "2026-07-20",
  main: "worker/index.ts",
  databaseBinding: "DB",
  databaseName: LOCAL_DATABASE_NAME,
  databaseId: PLACEHOLDER_DATABASE_ID,
  migrationsDir: "migrations",
  assetsBinding: "ASSETS",
  assetsNotFoundHandling: "single-page-application",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BetaTargetError extends Error {
  constructor(message, filePath = null) {
    super(message);
    this.name = "BetaTargetError";
    this.filePath = filePath;
  }
}

/** Quita comentarios `//` y `/* *\/` respetando el contenido de las cadenas. */
export function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
        output += character;
      }
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += character;
      if (character === "\\") {
        output += next ?? "";
        index += 1;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    output += character;
  }
  return output;
}

export function parseJsonc(text) {
  const withoutComments = stripJsonComments(text);
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas);
}

export function readConfigDocument(configPath) {
  const absolute = resolve(configPath);
  if (!existsSync(absolute)) throw new BetaTargetError(`No existe el archivo de configuración: ${absolute}`, absolute);
  const text = readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
  try {
    return { configPath: absolute, document: parseJsonc(text) };
  } catch (error) {
    throw new BetaTargetError(`La configuración no es JSON válido: ${absolute} (${error instanceof Error ? error.message : "error desconocido"})`, absolute);
  }
}

export function describeDatabaseId(value) {
  if (typeof value !== "string" || value.trim() === "") return { kind: "empty", label: "AUSENTE", value: null };
  const normalized = value.trim().toLowerCase();
  if (normalized === PLACEHOLDER_DATABASE_ID) return { kind: "placeholder", label: "PLACEHOLDER", value: normalized };
  if (UUID_PATTERN.test(normalized)) return { kind: "real", label: "REAL", value: normalized };
  return { kind: "invalid", label: "INVÁLIDO", value: normalized };
}

function firstEntry(list) {
  return Array.isArray(list) ? list[0] ?? null : null;
}

export function readBetaTarget(configPath) {
  const { document } = readConfigDocument(configPath);
  const environments = document.env && typeof document.env === "object" && !Array.isArray(document.env) ? document.env : {};
  const beta = environments[BETA_ENVIRONMENT] ?? null;
  return {
    configPath: resolve(configPath),
    environmentNames: Object.keys(environments),
    topLevel: {
      name: document.name ?? null,
      compatibilityDate: document.compatibility_date ?? null,
      main: document.main ?? null,
      assets: document.assets ?? null,
      d1: firstEntry(document.d1_databases),
    },
    beta: beta === null ? null : {
      name: beta.name ?? null,
      workersDev: typeof beta.workers_dev === "boolean" ? beta.workers_dev : null,
      assets: beta.assets ?? null,
      d1: firstEntry(beta.d1_databases),
      declaresD1: Object.hasOwn(beta, "d1_databases"),
      declaresAssets: Object.hasOwn(beta, "assets"),
      keys: Object.keys(beta).sort(),
    },
  };
}

function pushCheck(checks, id, ok, okDetail, failDetail) {
  checks.push({ id, status: ok ? "ok" : "error", detail: ok ? okDetail : failDetail });
  return ok;
}

/**
 * Valida la coherencia del destino beta configurado.
 * `allowPlaceholder` es true sólo en la etapa local (B1); antes de cualquier
 * operación remota el marcador de ceros debe ser un error.
 */
export function validateBetaTarget(target, { allowPlaceholder = false } = {}) {
  const checks = [];
  const warnings = [];
  const top = target.topLevel;
  const beta = target.beta;

  pushCheck(checks, "top-level.name", top.name === TOP_LEVEL_EXPECTATIONS.name,
    `El entorno local conserva name "${top.name}".`,
    `El entorno local cambió de name: se esperaba "${TOP_LEVEL_EXPECTATIONS.name}" y figura "${top.name}".`);
  pushCheck(checks, "top-level.database", top.d1 !== null
    && top.d1.binding === TOP_LEVEL_EXPECTATIONS.databaseBinding
    && top.d1.database_name === TOP_LEVEL_EXPECTATIONS.databaseName,
    `El entorno local conserva la D1 "${TOP_LEVEL_EXPECTATIONS.databaseName}" con binding ${TOP_LEVEL_EXPECTATIONS.databaseBinding}.`,
    "El entorno local cambió su binding o nombre de D1; la beta no debe avanzar hasta restaurarlo.");
  pushCheck(checks, "top-level.database-id", describeDatabaseId(top.d1?.database_id).kind === "placeholder",
    "El entorno local conserva el marcador de ceros como database_id.",
    "El entorno local ya no usa el marcador de ceros; revisar antes de continuar.");
  pushCheck(checks, "top-level.assets", top.assets?.binding === TOP_LEVEL_EXPECTATIONS.assetsBinding
    && top.assets?.not_found_handling === TOP_LEVEL_EXPECTATIONS.assetsNotFoundHandling,
    `El entorno local conserva los assets ${TOP_LEVEL_EXPECTATIONS.assetsBinding} con fallback de aplicación de página única.`,
    "El entorno local cambió su configuración de assets.");
  pushCheck(checks, "top-level.worker", top.main === TOP_LEVEL_EXPECTATIONS.main
    && top.compatibilityDate === TOP_LEVEL_EXPECTATIONS.compatibilityDate,
    `El entorno local conserva main "${top.main}" y compatibility_date ${top.compatibilityDate}.`,
    "El entorno local cambió main o compatibility_date.");
  pushCheck(checks, "top-level.migrations-dir", top.d1?.migrations_dir === TOP_LEVEL_EXPECTATIONS.migrationsDir,
    `El entorno local conserva migrations_dir "${top.d1?.migrations_dir}".`,
    `El entorno local cambió migrations_dir: figura "${top.d1?.migrations_dir ?? "ausente"}".`);

  if (beta === null) {
    pushCheck(checks, "environment.beta", false, "", `No existe "env.${BETA_ENVIRONMENT}" en ${target.configPath}.`);
    return { ok: false, checks, warnings, target };
  }
  pushCheck(checks, "environment.beta", true,
    `Existe el entorno "${BETA_ENVIRONMENT}" con claves: ${beta.keys.join(", ") || "ninguna"}.`, "");

  pushCheck(checks, "beta.name", beta.name === BETA_WORKER_NAME,
    `El Worker beta se llama "${BETA_WORKER_NAME}".`,
    `El Worker beta debe llamarse "${BETA_WORKER_NAME}" y figura "${beta.name ?? "ausente"}".`);
  pushCheck(checks, "beta.workers-dev", beta.workersDev === true,
    "workers_dev está activado en la beta.",
    `workers_dev debe ser true en la beta y figura "${beta.workersDev === null ? "ausente" : beta.workersDev}".`);

  if (beta.assets === null) {
    pushCheck(checks, "beta.assets", false, "", "La beta no declara assets; los bindings no se heredan y debe declararlos explícitamente.");
  } else {
    pushCheck(checks, "beta.assets", beta.assets.binding === TOP_LEVEL_EXPECTATIONS.assetsBinding
      && beta.assets.not_found_handling === TOP_LEVEL_EXPECTATIONS.assetsNotFoundHandling,
      `La beta declara los assets ${TOP_LEVEL_EXPECTATIONS.assetsBinding} con fallback de aplicación de página única.`,
      "La beta declara assets incompletos: se esperan binding ASSETS y not_found_handling single-page-application.");
  }

  if (beta.d1 === null) {
    pushCheck(checks, "beta.d1.binding", false, "", "La beta no declara la base D1 (clave \"d1_databases\").");
  } else {
    pushCheck(checks, "beta.d1.binding", beta.d1.binding === TOP_LEVEL_EXPECTATIONS.databaseBinding,
      `La beta usa el binding ${TOP_LEVEL_EXPECTATIONS.databaseBinding}, igual que el Worker local.`,
      `El binding D1 de la beta debe ser ${TOP_LEVEL_EXPECTATIONS.databaseBinding} y figura "${beta.d1.binding ?? "ausente"}".`);
    pushCheck(checks, "beta.d1.database-name", beta.d1.database_name === BETA_DATABASE_NAME,
      `La beta apunta a la D1 "${BETA_DATABASE_NAME}".`,
      `La D1 de la beta debe llamarse "${BETA_DATABASE_NAME}" y figura "${beta.d1.database_name ?? "ausente"}".`);
    pushCheck(checks, "beta.d1.database-name.remote-suffix",
      typeof beta.d1.database_name === "string" && beta.d1.database_name.endsWith(BETA_REMOTE_SUFFIX),
      `El nombre termina en "${BETA_REMOTE_SUFFIX}".`,
      `El nombre de la D1 de la beta debe terminar en "${BETA_REMOTE_SUFFIX}".`);
    pushCheck(checks, "beta.d1.database-name.distinct", beta.d1.database_name !== top.d1?.database_name,
      "El nombre de la D1 de la beta no coincide con el de la D1 local.",
      `La beta reutiliza el nombre local "${top.d1?.database_name}": eso apuntaría a la base de desarrollo.`);
    pushCheck(checks, "beta.d1.migrations-dir", beta.d1.migrations_dir === TOP_LEVEL_EXPECTATIONS.migrationsDir,
      `La beta conserva migrations_dir "${beta.d1.migrations_dir}".`,
      `La beta debe declarar migrations_dir "${TOP_LEVEL_EXPECTATIONS.migrationsDir}" y figura "${beta.d1.migrations_dir ?? "ausente"}".`);
    const betaId = describeDatabaseId(beta.d1.database_id);
    const topId = describeDatabaseId(top.d1?.database_id);
    if (betaId.kind === "empty") {
      pushCheck(checks, "beta.d1.database-id", false, "", "La beta no declara database_id.");
    } else if (betaId.kind === "invalid") {
      pushCheck(checks, "beta.d1.database-id", false, "", `El database_id de la beta no es un UUID ni el marcador esperado: "${betaId.value}".`);
    } else if (betaId.kind === "placeholder" && allowPlaceholder) {
      pushCheck(checks, "beta.d1.database-id", true,
        `database_id en estado ${betaId.label}: la provisión remota de B2 todavía no se ejecutó.`, "");
      warnings.push("El database_id de la beta sigue siendo el marcador de ceros: sirve únicamente para construir y validar en local.");
    } else if (betaId.kind === "placeholder") {
      pushCheck(checks, "beta.d1.database-id", false, "",
        "El database_id de la beta todavía es el marcador de ceros: ejecutar la provisión remota de B2 y reemplazarlo antes de cualquier operación remota.");
    } else {
      pushCheck(checks, "beta.d1.database-id", true, `database_id en estado ${betaId.label}.`, "");
    }
    if (betaId.kind === "real" && topId.kind === "real" && betaId.value === topId.value) {
      pushCheck(checks, "beta.d1.database-id.distinct", false, "",
        "El database_id de la beta es idéntico al del entorno local: la beta apuntaría a la misma base que desarrollo.");
    } else {
      pushCheck(checks, "beta.d1.database-id.distinct", true,
        "El database_id de la beta no coincide con el del entorno local.", "");
    }
  }

  return { ok: checks.every((entry) => entry.status === "ok"), checks, warnings, target };
}

export function formatTargetReport(target, result, { mode = "local" } = {}) {
  const beta = target.beta;
  const betaId = describeDatabaseId(beta?.d1?.database_id);
  const topId = describeDatabaseId(target.topLevel.d1?.database_id);
  const lines = [
    "Profemacon 2.0 — verificación de destino beta (sólo local, sin contacto con Cloudflare)",
    "",
    `Environment:        ${BETA_ENVIRONMENT}`,
    `Worker objetivo:    ${beta?.name ?? "ausente"}`,
    `D1 binding:         ${beta?.d1?.binding ?? "ausente"}`,
    `D1 database_name:   ${beta?.d1?.database_name ?? "ausente"}`,
    `D1 database_id:     ${betaId.label}${betaId.value ? ` (${betaId.value})` : ""}`,
    `D1 local (control): ${target.topLevel.d1?.database_name ?? "ausente"} · ${topId.label}`,
    `workers_dev:        ${beta?.workersDev === null || beta?.workersDev === undefined ? "ausente" : String(beta.workersDev)}`,
    `Assets binding:     ${beta?.assets?.binding ?? "ausente"}${beta?.assets?.not_found_handling ? ` (${beta.assets.not_found_handling})` : ""}`,
    `migrations_dir:     ${beta?.d1?.migrations_dir ?? "ausente"}`,
    `Configuración:      ${target.configPath}`,
    "",
    "Controles:",
  ];
  for (const entry of result.checks) {
    lines.push(`  ${entry.status === "ok" ? "OK   " : "FALLA"} ${entry.id}: ${entry.detail}`);
  }
  for (const warning of result.warnings) lines.push(`  AVISO ${warning}`);
  lines.push("");
  lines.push(result.ok
    ? (mode === "strict"
      ? "Resultado: destino beta coherente y con database_id real."
      : "Resultado: configuración beta coherente para la etapa local (B1).")
    : "Resultado: configuración beta inconsistente. Corregir antes de continuar.");
  lines.push(mode === "strict"
    ? "Este control no ejecuta operaciones remotas."
    : "NO SE EJECUTÓ NINGUNA OPERACIÓN REMOTA");
  return lines;
}

/** Verifica el config aplanado que el plugin de Vite deja en `dist/`. */
export function verifyFlattenedBetaConfig(flattened, { configDir = null } = {}) {
  const errors = [];
  const details = [];
  const database = firstEntry(flattened?.d1_databases);
  const databaseId = describeDatabaseId(database?.database_id);

  if (flattened?.name !== BETA_WORKER_NAME) {
    errors.push(`El config aplanado se llama "${flattened?.name ?? "ausente"}"; se esperaba "${BETA_WORKER_NAME}" (¿se olvidó CLOUDFLARE_ENV=beta?).`);
  } else {
    details.push(`Worker aplanado: ${flattened.name}`);
  }
  if (database === null
    || database.binding !== TOP_LEVEL_EXPECTATIONS.databaseBinding
    || database.database_name !== BETA_DATABASE_NAME) {
    errors.push(`El config aplanado debe enlazar el binding ${TOP_LEVEL_EXPECTATIONS.databaseBinding} con la D1 "${BETA_DATABASE_NAME}".`);
  } else {
    details.push(`D1: ${database.binding} → ${database.database_name} (${databaseId.label})`);
  }
  if (databaseId.kind === "empty" || databaseId.kind === "invalid") {
    errors.push("El config aplanado no declara un database_id utilizable (ni real ni marcador de ceros).");
  }
  if (flattened?.assets?.binding !== TOP_LEVEL_EXPECTATIONS.assetsBinding
    || flattened?.assets?.not_found_handling !== TOP_LEVEL_EXPECTATIONS.assetsNotFoundHandling) {
    errors.push(`El config aplanado debe conservar los assets ${TOP_LEVEL_EXPECTATIONS.assetsBinding} con fallback de aplicación de página única.`);
  } else {
    details.push(`Assets: ${flattened.assets.binding} con fallback ${flattened.assets.not_found_handling}`);
  }
  const assetsDirectory = flattened?.assets?.directory ?? null;
  if (assetsDirectory === null) {
    errors.push("El config aplanado no declara el directorio de assets.");
  } else if (configDir === null) {
    details.push(`Directorio de assets declarado: ${assetsDirectory} (no verificado en disco)`);
  } else {
    const absoluteAssets = resolve(configDir, assetsDirectory);
    const hasIndex = existsSync(join(absoluteAssets, "index.html"));
    if (!existsSync(absoluteAssets) || !statSync(absoluteAssets).isDirectory() || !hasIndex) {
      errors.push(`El directorio de assets no existe o no contiene index.html: ${absoluteAssets}`);
    } else {
      details.push(`Directorio de assets verificado: ${absoluteAssets}`);
    }
  }
  return { ok: errors.length === 0, errors, details, databaseId };
}

/** Ubica el config aplanado del plugin de Vite dentro de `dist/`. */
export function findFlattenedConfig(distDir, userConfigPath) {
  const root = resolve(distDir);
  if (!existsSync(root)) return null;
  const expectedOwner = resolve(userConfigPath);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name, "wrangler.json");
    if (!existsSync(candidate)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      continue;
    }
    const owner = typeof parsed.userConfigPath === "string" ? resolve(parsed.userConfigPath) : null;
    if (owner === null || owner === expectedOwner) return { path: candidate, config: parsed };
  }
  return null;
}

export function defaultConfigPath(projectRoot) {
  return join(projectRoot, "wrangler.jsonc");
}

export function configDirectory(configPath) {
  return dirname(resolve(configPath));
}
