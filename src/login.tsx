import { useState, type FormEvent } from "react";

type Mode = "login" | "activate";

export function Login({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "activate" && password !== confirmation) {
      setStatus("error");
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "activate" ? { username, activationCode, password } : { username, password }),
      });
      if (!response.ok) throw new Error("No pudimos validar los datos. Revisalos o solicitá ayuda al docente.");
      await onAuthenticated();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "No fue posible ingresar.");
    }
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setPassword("");
    setConfirmation("");
    setActivationCode("");
    setStatus("idle");
    setMessage("");
  }

  return <section className="login-view">
    <div className="login-heading">
      <p className="eyebrow">Acceso seguro</p>
      <h1>{mode === "login" ? "Ingresar" : "Activar mi cuenta"}</h1>
      <p>{mode === "login" ? "Usá el nombre de usuario asignado por el curso." : "El código de activación se usa una sola vez. Tu documento no será tu nombre de usuario."}</p>
    </div>
    <div className="login-card">
      <div className="login-tabs" role="tablist" aria-label="Tipo de acceso">
        <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => changeMode("login")}>Ya tengo contraseña</button>
        <button type="button" className={mode === "activate" ? "is-active" : ""} onClick={() => changeMode("activate")}>Primera vez</button>
      </div>
      <form onSubmit={submit}>
        <label>Nombre de usuario<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={64} /></label>
        {mode === "activate" && <label>Código de activación<input autoComplete="one-time-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value)} required minLength={16} maxLength={128} /></label>}
        <label>{mode === "activate" ? "Crear contraseña" : "Contraseña"}<input type="password" autoComplete={mode === "activate" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} /></label>
        {mode === "activate" && <label>Repetir contraseña<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={12} maxLength={128} /></label>}
        {mode === "activate" && <p className="password-guidance">Usá al menos 12 caracteres. Una frase larga es más fácil de recordar y más segura.</p>}
        {status === "error" && <p className="form-error" role="alert">{message}</p>}
        <button className="button-primary login-submit" disabled={status === "sending"}>{status === "sending" ? "Verificando…" : mode === "login" ? "Ingresar" : "Activar e ingresar"}</button>
      </form>
      <p className="shared-device-note"><strong>Equipo compartido:</strong> cerrá tu sesión al terminar. La plataforma también la cerrará después de 30 minutos sin actividad.</p>
    </div>
  </section>;
}
