export type ActivationCredential = {
  displayName: string;
  username: string;
  activationCode: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export function activationCredentialText(credential: ActivationCredential, activationUrl: string) {
  return [
    "Profe Macón — activación de cuenta",
    `Estudiante: ${credential.displayName}`,
    `Usuario: ${credential.username}`,
    `Código de activación: ${credential.activationCode}`,
    `Activar en: ${activationUrl}`,
    "",
    "El código vence 14 días después de su emisión y se usa una sola vez.",
    "Al terminar, cierre la sesión si está usando un equipo compartido.",
  ].join("\n");
}

export function activationSlipHtml(credential: ActivationCredential, activationUrl: string) {
  const name = escapeHtml(credential.displayName);
  const username = escapeHtml(credential.username);
  const code = escapeHtml(credential.activationCode);
  const url = escapeHtml(activationUrl);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Activación de ${name}</title><style>
    @page { size: A5; margin: 18mm; }
    * { box-sizing: border-box; }
    body { color: #17171d; font: 16px/1.5 system-ui, sans-serif; margin: 0; }
    main { border: 2px solid #514b76; border-radius: 12px; padding: 28px; }
    h1 { font-size: 25px; margin: 0 0 8px; }
    .student { color: #4b475a; margin: 0 0 25px; }
    dl { display: grid; gap: 15px; margin: 0; }
    div { border-top: 1px solid #d8d5df; padding-top: 12px; }
    dt { color: #65616f; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    dd { font-size: 18px; font-weight: 700; margin: 4px 0 0; overflow-wrap: anywhere; }
    code { font: 700 17px/1.5 ui-monospace, monospace; }
    .note { background: #f1eff7; border-radius: 8px; font-size: 13px; margin: 24px 0 0; padding: 13px; }
  </style></head><body><main><h1>Profe Macón</h1><p class="student">Activación de cuenta para <strong>${name}</strong></p><dl><div><dt>Usuario</dt><dd>${username}</dd></div><div><dt>Código de activación</dt><dd><code>${code}</code></dd></div><div><dt>Dirección</dt><dd>${url}</dd></div></dl><p class="note">El código vence 14 días después de su emisión y se usa una sola vez. Al terminar, cierre la sesión si está usando un equipo compartido.</p></main></body></html>`;
}

export function printActivationCredential(credential: ActivationCredential, activationUrl: string) {
  const popup = window.open("", "_blank", "popup,width=640,height=760");
  if (!popup) return false;
  popup.opener = null;
  popup.document.open();
  popup.document.write(activationSlipHtml(credential, activationUrl));
  popup.document.close();
  popup.addEventListener("afterprint", () => popup.close(), { once: true });
  popup.focus();
  popup.setTimeout(() => popup.print(), 100);
  return true;
}
