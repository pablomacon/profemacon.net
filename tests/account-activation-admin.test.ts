import assert from "node:assert/strict";
import test from "node:test";
import { ActivationAdminError, parseReissuePayload } from "../worker/account-activation-admin.ts";

test("acepta únicamente una reemisión con cuenta, grupo y motivo válidos", () => {
  assert.deepEqual(parseReissuePayload({ userId: 7, groupId: 3, reason: "perdido" }), { userId: 7, groupId: 3, reason: "perdido" });
});

test("rechaza identificadores y motivos no admitidos", () => {
  for (const payload of [
    { userId: 0, groupId: 3, reason: "perdido" },
    { userId: 7, groupId: -1, reason: "vencido" },
    { userId: 7, groupId: 3, reason: "restablecer_contraseña" },
  ]) {
    assert.throws(() => parseReissuePayload(payload), ActivationAdminError);
  }
});
