/**
 * Error tipado de política de contraseñas: se lanza cuando el costo almacenado
 * de una credencial queda fuera del rango que la aplicación acepta verificar.
 * Es un fallo cerrado: nunca se sustituye el costo, nunca se deriva igual.
 */
export class PasswordPolicyError extends Error {
  constructor(message = "El costo almacenado de la credencial está fuera del rango soportado") {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

/**
 * Política versionada de hash de contraseñas.
 *
 * - `algoritmo` y `formato` identifican el conjunto de parámetros persistido en
 *   cada credencial (`credenciales_locales.algoritmo` y `.formato`).
 * - `minVerificable` es el mínimo de SEGURIDAD que la aplicación acepta verificar.
 *   No es el mínimo técnico del runtime (workerd sólo exige `iterations > 0`) ni el
 *   piso de creación: una credencial por debajo de este valor falla cerrada.
 * - `target` es el costo con el que SIEMPRE se crea una credencial nueva.
 * - `maxSoportado` es el techo duro del runtime de Cloudflare: WebCrypto rechaza
 *   PBKDF2 por encima de este valor y no es configurable por wrangler, por flags de
 *   compatibilidad ni por plan.
 * - `rehashOnLogin` está desactivado: un rehash implicaría una segunda derivación
 *   PBKDF2 en el mismo request (aproximadamente el doble de CPU) y todavía no se
 *   midió el `cpuTime` real de este costo en Workers. Se reevalúa en A2.
 */
export const PASSWORD_POLICY = {
  algoritmo: "pbkdf2-sha256",
  formato: "v1",
  minVerificable: 50_000,
  target: 100_000,
  maxSoportado: 100_000,
  rehashOnLogin: false,
} as const;

/** Credencial tal como se persiste y se lee en `credenciales_locales`. */
export type StoredPasswordCredential = {
  algorithm: string;
  format: string;
  iterations: number;
};

/** Costo de creación vigente (alias explícito de `PASSWORD_POLICY.target`). */
export const PASSWORD_ITERATIONS = PASSWORD_POLICY.target;

const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Valida que un número de iteraciones sea verificable por la aplicación.
 *
 * Acepta sólo enteros dentro de `[minVerificable, maxSoportado]`. Rechaza valores
 * por debajo del piso de seguridad, por encima del techo del runtime, no enteros,
 * `NaN`, `Infinity`, cadenas y cualquier valor no numérico. No ejecuta criptografía:
 * es una guarda pura que se aplica antes de derivar.
 */
export function assertIteracionesVerificables(iterations: number): void {
  if (typeof iterations !== "number" || !Number.isInteger(iterations)) {
    throw new PasswordPolicyError("El número de iteraciones de la credencial no es un entero válido");
  }
  if (iterations < PASSWORD_POLICY.minVerificable || iterations > PASSWORD_POLICY.maxSoportado) {
    throw new PasswordPolicyError("El número de iteraciones de la credencial está fuera del rango soportado");
  }
}

/**
 * Guarda completa previa a cualquier derivación: algoritmo, formato e iteraciones.
 * Una credencial que no pase esta guarda no se verifica (fallo cerrado).
 */
export function assertCredencialVerificable(credencial: StoredPasswordCredential): void {
  if (credencial.algorithm !== PASSWORD_POLICY.algoritmo) {
    throw new PasswordPolicyError("El algoritmo de la credencial no está soportado");
  }
  if (credencial.format !== PASSWORD_POLICY.formato) {
    throw new PasswordPolicyError("El formato de la credencial no está soportado");
  }
  assertIteracionesVerificables(credencial.iterations);
}

/**
 * Decisión pura de rehash. No ejecuta criptografía, no escribe y no se invoca
 * durante el login en este bloque (`PASSWORD_POLICY.rehashOnLogin` es `false`).
 *
 * Devuelve `true` sólo cuando la credencial quedó atrás respecto del objetivo
 * vigente. Un costo por encima del objetivo nunca sugiere una reducción: la
 * aplicación no baja el costo automáticamente.
 */
export function needsRehash(credencial: StoredPasswordCredential): boolean {
  return credencial.algorithm !== PASSWORD_POLICY.algoritmo
    || credencial.format !== PASSWORD_POLICY.formato
    || credencial.iterations < PASSWORD_POLICY.target;
}

export async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number = PASSWORD_ITERATIONS) {
  // Guarda de política antes de tocar WebCrypto: ninguna ruta puede derivar con un
  // costo fuera del rango, ni siquiera por un literal equivocado en el código.
  assertIteracionesVerificables(iterations);
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, DERIVED_KEY_BITS);
  return new Uint8Array(bits);
}

export async function createPasswordCredential(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePasswordHash(password, salt, PASSWORD_POLICY.target);
  return {
    algorithm: PASSWORD_POLICY.algoritmo,
    format: PASSWORD_POLICY.formato,
    iterations: PASSWORD_POLICY.target,
    saltBase64: bytesToBase64(salt),
    hashBase64: bytesToBase64(hash),
  };
}

export async function verifyPassword(password: string, saltBase64: string, hashBase64: string, iterations: number) {
  // Defensa en profundidad: la verificación también valida el rango antes de derivar.
  assertIteracionesVerificables(iterations);
  const expected = base64ToBytes(hashBase64);
  const actual = await derivePasswordHash(password, base64ToBytes(saltBase64), iterations);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  return difference === 0;
}

export function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

