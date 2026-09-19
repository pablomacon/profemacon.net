import assert from "node:assert/strict";
import test from "node:test";
import { activationCredentialText, activationSlipHtml } from "../src/activation-delivery.ts";

const credential = {
  sourceRow: 2,
  displayName: "Ana Ejemplo",
  username: "ana.ejemplo.abcdef123456",
  activationCode: "PM-ACTIVACION-FICTICIA",
};

test("la ficha contiene sólo los datos necesarios para activar la cuenta", () => {
  const text = activationCredentialText(credential, "https://plataforma.example/ingresar");
  assert.match(text, /Ana Ejemplo/);
  assert.match(text, /ana\.ejemplo\.abcdef123456/);
  assert.match(text, /PM-ACTIVACION-FICTICIA/);
  assert.match(text, /vence 14 días/);
  assert.doesNotMatch(text, /documento|cédula|pasaporte/i);
});

test("la ficha imprimible escapa contenido no confiable", () => {
  const html = activationSlipHtml({ ...credential, displayName: "<img src=x onerror=alert(1)>" }, "https://plataforma.example/ingresar?a=1&b=2");
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /a=1&amp;b=2/);
});
