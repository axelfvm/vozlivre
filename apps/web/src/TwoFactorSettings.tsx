import { useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";

export function TwoFactorSettings({
  apiUrl,
  enabled,
  onChanged,
}: {
  apiUrl: string;
  enabled: boolean;
  onChanged: (enabled: boolean) => void;
}) {
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const request = async (path: string, body?: object) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      secret?: string;
      recoveryCodes?: string[];
    };
    if (!response.ok) throw new Error(payload.message ?? "Não foi possível concluir.");
    return payload;
  };

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operação não concluída.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="two-factor-settings">
      <div className="settings-section-heading">
        <span className="settings-section-icon"><ShieldCheck size={20} /></span>
        <div>
          <h3>Verificação em duas etapas</h3>
          <p>Códigos TOTP funcionam localmente com qualquer aplicativo autenticador.</p>
        </div>
      </div>
      {!enabled ? (
        <>
          {!secret ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const payload = await request("/auth/2fa/setup");
                  setSecret(payload.secret ?? "");
                })
              }
            >
              <KeyRound size={16} /> Configurar autenticador
            </button>
          ) : (
            <div className="two-factor-setup">
              <p>Adicione manualmente esta chave no autenticador e informe o código gerado:</p>
              <div className="two-factor-secret">
                <code>{secret}</code>
                <button onClick={() => void navigator.clipboard.writeText(secret)} title="Copiar">
                  <Copy size={15} />
                </button>
              </div>
              <input value={code} inputMode="numeric" maxLength={6} placeholder="Código de 6 dígitos" onChange={(event) => setCode(event.target.value)} />
              <button
                disabled={busy || code.length !== 6}
                onClick={() =>
                  void run(async () => {
                    const payload = await request("/auth/2fa/enable", { code });
                    setRecoveryCodes(payload.recoveryCodes ?? []);
                    onChanged(true);
                  })
                }
              >
                Ativar proteção
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="two-factor-disable">
          <strong>Proteção ativa</strong>
          <p>Para desativar, confirme a senha e um código atual do autenticador.</p>
          <input type="password" value={password} placeholder="Senha atual" onChange={(event) => setPassword(event.target.value)} />
          <input value={code} inputMode="numeric" maxLength={6} placeholder="Código de 6 dígitos" onChange={(event) => setCode(event.target.value)} />
          <button
            className="danger-action"
            disabled={busy || !password || code.length !== 6}
            onClick={() =>
              void run(async () => {
                await request("/auth/2fa/disable", { password, code });
                setPassword("");
                setCode("");
                setSecret("");
                onChanged(false);
              })
            }
          >
            Desativar verificação
          </button>
        </div>
      )}
      {recoveryCodes.length > 0 && (
        <div className="recovery-codes">
          <strong>Guarde estes códigos de recuperação</strong>
          <p>Cada código funciona apenas uma vez e não será exibido novamente.</p>
          <div>{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
          <button onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}>
            <Copy size={15} /> Copiar códigos
          </button>
        </div>
      )}
      {error && <div className="dialog-error">{error}</div>}
    </section>
  );
}
