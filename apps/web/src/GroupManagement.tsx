import { useEffect, useState } from "react";
import { Plus, Save, Trash2, Users, X } from "lucide-react";

type Person = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role?: string;
};

export function GroupManagement({
  apiUrl,
  group,
  currentUserId,
  onClose,
  onChanged,
}: {
  apiUrl: string;
  group: { id: string; name: string; role: string; members: Person[] };
  currentUserId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(group.name);
  const [friends, setFriends] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = group.role === "owner";

  useEffect(() => {
    fetch(`${apiUrl}/social`, { credentials: "include" })
      .then((response) => response.json())
      .then((payload: { friends?: { user: Person }[] }) =>
        setFriends((payload.friends ?? []).map((item) => item.user)),
      )
      .catch(() => setFriends([]));
  }, [apiUrl]);

  const run = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        credentials: "include",
        ...init,
        headers: init.body ? { "Content-Type": "application/json" } : undefined,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message ?? "Operação não concluída.");
      await onChanged();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operação não concluída.");
    } finally {
      setBusy(false);
    }
    return false;
  };

  const candidates = friends.filter(
    (friend) => !group.members.some((member) => member.id === friend.id),
  );

  return (
    <div className="dialog-backdrop">
      <section className="action-dialog group-management" role="dialog" aria-modal="true">
        <header>
          <div><span>GRUPO PRIVADO</span><h2>Gerenciar conversa</h2></div>
          <button onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        {owner && (
          <div className="management-inline">
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            <button
              disabled={busy || !name.trim()}
              onClick={() => void run(`/social/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ name }) })}
            >
              <Save size={15} /> Salvar nome
            </button>
          </div>
        )}
        <div className="group-member-list">
          <strong><Users size={15} /> PARTICIPANTES</strong>
          {group.members.map((member) => (
            <article key={member.id}>
              <span>{member.displayName.slice(0, 1).toUpperCase()}</span>
              <div><strong>{member.displayName}</strong><small>{member.role === "owner" ? "Proprietário" : "Participante"}</small></div>
              {member.role !== "owner" && (owner || member.id === currentUserId) && (
                <button
                  className="danger-icon"
                  disabled={busy}
                  onClick={() => void run(`/social/groups/${group.id}/members/${member.id}`, { method: "DELETE" })}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </article>
          ))}
        </div>
        {owner && candidates.length > 0 && (
          <div className="group-add-list">
            <strong>ADICIONAR AMIGOS</strong>
            {candidates.map((friend) => (
              <button
                key={friend.id}
                disabled={busy}
                onClick={() => void run(`/social/groups/${group.id}/members/${friend.id}`, { method: "POST" })}
              >
                <Plus size={15} /> {friend.displayName}
              </button>
            ))}
          </div>
        )}
        {owner && (
          <button
            className="danger-action group-delete"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  "Excluir permanentemente este grupo e todas as mensagens?",
                )
              )
                return;
              void run(`/social/groups/${group.id}`, { method: "DELETE" }).then(
                (deleted) => {
                  if (deleted) onClose();
                },
              );
            }}
          >
            <Trash2 size={15} /> Excluir grupo
          </button>
        )}
        {error && <div className="dialog-error">{error}</div>}
      </section>
    </div>
  );
}
