import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  Check,
  MessageCircle,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";

type Person = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
};
type Friendship = {
  id: string;
  status: "PENDING" | "ACCEPTED";
  direction: "incoming" | "outgoing";
  user: Person;
};
export type DirectSpace = {
  id: string;
  name: string;
  kind: "DIRECT" | "GROUP";
  iconUrl: string | null;
  channels: { id: string; name: string; kind: "TEXT" | "VOICE" }[];
};
export type SocialOverview = {
  friends: Friendship[];
  incoming: Friendship[];
  outgoing: Friendship[];
  blocked: Person[];
  directs: DirectSpace[];
};
type SearchPerson = Person & {
  friendshipId: string | null;
  friendshipStatus: "PENDING" | "ACCEPTED" | null;
  direction: "incoming" | "outgoing" | null;
};

export function SocialHome({
  apiUrl,
  onOpenDirect,
  onChanged,
}: {
  apiUrl: string;
  onOpenDirect: (space: DirectSpace) => void;
  onChanged: () => Promise<void>;
}) {
  const [overview, setOverview] = useState<SocialOverview | null>(null);
  const [tab, setTab] = useState<"friends" | "pending" | "blocked">("friends");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchPerson[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(`${apiUrl}${path}`, {
        credentials: "include",
        ...init,
        headers: init?.body
          ? { "Content-Type": "application/json", ...init.headers }
          : init?.headers,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok)
        throw new Error(
          typeof payload.message === "string"
            ? payload.message
            : "Não foi possível concluir a operação.",
        );
      return payload;
    },
    [apiUrl],
  );

  const load = useCallback(async () => {
    setOverview((await request("/social")) as unknown as SocialOverview);
  }, [request]);

  useEffect(() => {
    // Social data comes from the authenticated API and is loaded after mount.
    // oxlint-disable-next-line react/set-state-in-effect
    void load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Falha ao carregar."),
    );
  }, [load]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${apiUrl}/social/users?q=${encodeURIComponent(normalized)}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then((response) => response.json())
        .then((payload) => setResults(payload as SearchPerson[]))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setError("Não foi possível buscar pessoas.");
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, query]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operação não concluída.");
    } finally {
      setBusy(false);
    }
  };

  const openDirect = (person: Person) =>
    run(async () => {
      const direct = (await request(`/social/directs/${person.id}`, {
        method: "POST",
      })) as unknown as DirectSpace;
      onOpenDirect(direct);
    });

  const visible =
    tab === "friends"
      ? overview?.friends ?? []
      : tab === "pending"
        ? [...(overview?.incoming ?? []), ...(overview?.outgoing ?? [])]
        : [];

  return (
    <div className="social-home">
      <header>
        <div>
          <span>VOZLIVRE</span>
          <h1>Amigos e mensagens diretas</h1>
        </div>
        <div className="social-search">
          <Search size={17} />
          <input
            value={query}
            placeholder="Buscar por nome ou e-mail exato"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </header>

      {query.trim().length >= 2 && (
        <section className="social-results">
          <h2>Encontrar pessoas</h2>
          {results.length === 0 && <p>Nenhuma pessoa encontrada.</p>}
          {results.map((person) => (
            <PersonRow key={person.id} person={person} apiUrl={apiUrl}>
              {person.friendshipStatus === "ACCEPTED" ? (
                <button onClick={() => void openDirect(person)} title="Conversar">
                  <MessageCircle size={17} />
                </button>
              ) : person.friendshipStatus === "PENDING" ? (
                person.direction === "incoming" ? (
                  <button
                    title="Aceitar"
                    onClick={() =>
                      void run(async () => {
                        await request(`/social/friends/${person.friendshipId}/accept`, {
                          method: "POST",
                        });
                      })
                    }
                  >
                    <Check size={17} />
                  </button>
                ) : (
                  <span className="social-pending-label">Solicitação enviada</span>
                )
              ) : (
                <button
                  disabled={busy}
                  title="Adicionar amigo"
                  onClick={() =>
                    void run(async () => {
                      await request(`/social/friends/${person.id}`, { method: "POST" });
                    })
                  }
                >
                  <UserPlus size={17} />
                </button>
              )}
            </PersonRow>
          ))}
        </section>
      )}

      <nav className="social-tabs">
        <button className={tab === "friends" ? "selected" : ""} onClick={() => setTab("friends")}>
          Amigos {overview?.friends.length ?? 0}
        </button>
        <button className={tab === "pending" ? "selected" : ""} onClick={() => setTab("pending")}>
          Pendentes {(overview?.incoming.length ?? 0) + (overview?.outgoing.length ?? 0)}
        </button>
        <button className={tab === "blocked" ? "selected" : ""} onClick={() => setTab("blocked")}>
          Bloqueados {overview?.blocked.length ?? 0}
        </button>
      </nav>

      <div className="social-columns">
        <section>
          <h2>{tab === "friends" ? "Seus amigos" : tab === "pending" ? "Solicitações" : "Bloqueados"}</h2>
          {tab !== "blocked" && visible.length === 0 && <p>Nada por aqui ainda.</p>}
          {visible.map((friendship) => (
            <PersonRow key={friendship.id} person={friendship.user} apiUrl={apiUrl}>
              {friendship.status === "ACCEPTED" && (
                <button onClick={() => void openDirect(friendship.user)} title="Conversar">
                  <MessageCircle size={17} />
                </button>
              )}
              {friendship.direction === "incoming" && friendship.status === "PENDING" && (
                <button
                  title="Aceitar"
                  onClick={() =>
                    void run(async () => {
                      await request(`/social/friends/${friendship.id}/accept`, { method: "POST" });
                    })
                  }
                >
                  <Check size={17} />
                </button>
              )}
              <button
                title="Remover"
                onClick={() =>
                  void run(async () => {
                    await request(`/social/friends/${friendship.id}`, { method: "DELETE" });
                  })
                }
              >
                <UserMinus size={17} />
              </button>
              <button
                title="Bloquear"
                onClick={() =>
                  void run(async () => {
                    await request(`/social/blocks/${friendship.user.id}`, { method: "POST" });
                  })
                }
              >
                <Ban size={17} />
              </button>
            </PersonRow>
          ))}
          {tab === "blocked" &&
            (overview?.blocked ?? []).map((person) => (
              <PersonRow key={person.id} person={person} apiUrl={apiUrl}>
                <button
                  title="Desbloquear"
                  onClick={() =>
                    void run(async () => {
                      await request(`/social/blocks/${person.id}`, { method: "DELETE" });
                    })
                  }
                >
                  <X size={17} />
                </button>
              </PersonRow>
            ))}
        </section>

        <aside className="social-directs">
          <h2>Mensagens diretas</h2>
          {(overview?.directs ?? []).map((direct) => (
            <button key={direct.id} onClick={() => onOpenDirect(direct)}>
              <PersonAvatar apiUrl={apiUrl} person={{ id: direct.id, displayName: direct.name, avatarUrl: direct.iconUrl, status: "" }} />
              <span>{direct.name}</span>
              {direct.kind === "GROUP" ? <Users size={14} /> : <MessageCircle size={14} />}
            </button>
          ))}
          <div className="social-group-create">
            <strong>Novo grupo privado</strong>
            <input value={groupName} placeholder="Nome do grupo" onChange={(event) => setGroupName(event.target.value)} />
            <div>
              {(overview?.friends ?? []).map((friend) => (
                <button
                  key={friend.user.id}
                  className={groupMembers.includes(friend.user.id) ? "selected" : ""}
                  onClick={() =>
                    setGroupMembers((current) =>
                      current.includes(friend.user.id)
                        ? current.filter((id) => id !== friend.user.id)
                        : [...current, friend.user.id],
                    )
                  }
                >
                  {friend.user.displayName}
                </button>
              ))}
            </div>
            <button
              disabled={!groupName.trim() || !groupMembers.length || busy}
              onClick={() =>
                void run(async () => {
                  const group = (await request("/social/groups", {
                    method: "POST",
                    body: JSON.stringify({ name: groupName, memberIds: groupMembers }),
                  })) as unknown as DirectSpace;
                  setGroupName("");
                  setGroupMembers([]);
                  onOpenDirect(group);
                })
              }
            >
              <Users size={15} /> Criar grupo
            </button>
          </div>
        </aside>
      </div>
      {error && <div className="dialog-error">{error}</div>}
    </div>
  );
}

function PersonRow({ person, children, apiUrl }: { person: Person; children: React.ReactNode; apiUrl: string }) {
  return (
    <article className="social-person">
      <PersonAvatar person={person} apiUrl={apiUrl} />
      <div>
        <strong>{person.displayName}</strong>
        <span>{person.status || "Disponível no VozLivre"}</span>
      </div>
      <aside>{children}</aside>
    </article>
  );
}

function PersonAvatar({ person, apiUrl }: { person: Person; apiUrl: string }) {
  return person.avatarUrl ? (
    <img className="social-avatar" src={person.avatarUrl.startsWith("http") ? person.avatarUrl : `${apiUrl}${person.avatarUrl}`} alt="" />
  ) : (
    <span className="social-avatar social-avatar--fallback">
      {person.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}
