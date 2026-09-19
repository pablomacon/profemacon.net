import { useEffect, useState } from "react";
import { activationCredentialText, printActivationCredential, type ActivationCredential } from "./activation-delivery";

export function ActivationDeliveryPanel({ credentials, onFinished }: { credentials: ActivationCredential[]; onFinished: () => void }) {
  const [deliveredUsers, setDeliveredUsers] = useState<Set<string>>(() => new Set());
  const [copiedUser, setCopiedUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingDeliveries = credentials.filter((credential) => !deliveredUsers.has(credential.username)).length;
  const activationUrl = `${window.location.origin}/ingresar`;

  useEffect(() => {
    if (!credentials.length) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [credentials]);

  async function copyCredential(credential: ActivationCredential) {
    setError(null);
    try {
      await navigator.clipboard.writeText(activationCredentialText(credential, activationUrl));
      setCopiedUser(credential.username);
    } catch {
      setError("El navegador no permitió copiar. Use la ficha imprimible o copie los campos manualmente.");
    }
  }

  function printCredential(credential: ActivationCredential) {
    setError(null);
    if (!printActivationCredential(credential, activationUrl)) setError("El navegador bloqueó la ficha imprimible. Habilite las ventanas emergentes para este sitio e intente nuevamente.");
  }

  function toggleDelivered(username: string, delivered: boolean) {
    setDeliveredUsers((current) => {
      const next = new Set(current);
      if (delivered) next.add(username);
      else next.delete(username);
      return next;
    });
  }

  return <>
    <div className="import-alert is-warning"><strong>Estos códigos se muestran una sola vez.</strong><p>Entregue cada acceso únicamente a su titular. No se guardan en texto claro y desaparecerán al finalizar, cerrar o recargar esta pantalla.</p></div>
    <div className="delivery-heading"><div><h3>Entrega individual</h3><p>{pendingDeliveries} pendiente(s) de {credentials.length}</p></div></div>
    <div className="credential-cards">{credentials.map((credential) => {
      const delivered = deliveredUsers.has(credential.username);
      return <article className={`credential-card${delivered ? " is-delivered" : ""}`} key={credential.username}>
        <div className="credential-card-heading"><div><span>Estudiante</span><h3>{credential.displayName}</h3></div><span className={`status-pill${delivered ? " is-safe" : ""}`}>{delivered ? "Entregado" : "Pendiente"}</span></div>
        <dl><div><dt>Usuario</dt><dd>{credential.username}</dd></div><div><dt>Código de activación</dt><dd><code>{credential.activationCode}</code></dd></div></dl>
        <div className="credential-actions"><button className="button-secondary" type="button" onClick={() => void copyCredential(credential)}>{copiedUser === credential.username ? "Copiado" : "Copiar acceso"}</button><button className="button-secondary" type="button" onClick={() => printCredential(credential)}>Imprimir ficha</button></div>
        <label className="delivery-check"><input type="checkbox" checked={delivered} onChange={(event) => toggleDelivered(credential.username, event.target.checked)} /> Confirmo que entregué este acceso solamente al estudiante.</label>
      </article>;
    })}</div>
    {error && <div className="import-alert is-error" role="alert"><strong>No fue posible preparar la entrega.</strong><p>{error}</p></div>}
    <div className="finish-delivery"><p>Al finalizar se borrarán los códigos de esta pantalla y no podrán recuperarse.</p><button className="button-primary" type="button" disabled={pendingDeliveries !== 0} onClick={onFinished}>Finalizar y borrar códigos</button></div>
  </>;
}
