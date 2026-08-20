import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  Clock,
  FileClock,
  Hash,
  Plus,
  Save,
  Shield,
  Link2,
  LogOut,
  Image,
  Trash2,
  Users,
  Volume2,
  Ban,
  X,
} from "lucide-react";

type Channel = {
  id: string;
  name: string;
  topic?: string;
  kind: "TEXT" | "VOICE";
  categoryId?: string | null;
};
type Category = { id: string; name: string; position: number };
type Space = {
  id: string;
  name: string;
  role: string;
  iconUrl?: string | null;
  description?: string;
  channels: Channel[];
  categories: Category[];
};
type CustomRole = {
  id: string;
  name: string;
  color: string;
  permissions: string[];
};
type Invite = {
  id: string;
  code: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdAt: string;
};
type Member = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  roleIds: string[];
};
type Management = {
  id: string;
  name: string;
  roles: CustomRole[];
  members: Member[];
  invites: Invite[];
  iconUrl: string | null;
  description: string;
};
type Moderation = {
  members: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    role: string;
    timedOutUntil: string | null;
  }[];
  bans: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    reason: string;
    createdAt: string;
  }[];
};
type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  details: Record<string, unknown>;
  createdAt: string;
  actor: { displayName: string };
};
type SpaceSticker = {
  id: string;
  name: string;
  url: string;
};

const permissionOptions = [
  ["MANAGE_CHANNELS", "Gerenciar canais"],
  ["MANAGE_MEMBERS", "Gerenciar membros e cargos"],
  ["MANAGE_MESSAGES", "Moderar e fixar mensagens"],
  ["MANAGE_INVITES", "Gerenciar convites"],
  ["SEND_MESSAGES", "Enviar mensagens"],
  ["ATTACH_FILES", "Anexar arquivos"],
  ["CONNECT_VOICE", "Entrar na voz"],
  ["SHARE_SCREEN", "Compartilhar tela"],
  ["MODERATE_MEMBERS", "Aplicar timeout e banimentos"],
  ["VIEW_AUDIT_LOG", "Ver registro de auditoria"],
  ["MENTION_EVERYONE", "Mencionar todos"],
  ["MANAGE_STICKERS", "Gerenciar figurinhas"],
] as const;

export function SpaceManagement({
  apiUrl,
  space,
  currentUserId,
  onClose,
  onChanged,
}: {
  apiUrl: string;
  space: Space;
  currentUserId: string;
  onClose: () => void;
  onChanged: (deleted?: boolean) => Promise<void>;
}) {
  const [data, setData] = useState<Management | null>(null);
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description ?? "");
  const [roleName, setRoleName] = useState("");
  const [roleColor, setRoleColor] = useState("#87909f");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [moderation, setModeration] = useState<Moderation | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [stickers, setStickers] = useState<SpaceSticker[]>([]);
  const [stickerName, setStickerName] = useState("");
  const [inviteDays, setInviteDays] = useState(7);
  const [inviteMaxUses, setInviteMaxUses] = useState(0);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(`${apiUrl}${path}`, {
        credentials: "include",
        ...init,
        headers: init?.body
          ? { "Content-Type": "application/json", ...init.headers }
          : init?.headers,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.message ?? "Não foi possível concluir a operação.",
        );
      return payload;
    },
    [apiUrl],
  );

  const load = useCallback(async () => {
    try {
      const [management, moderationData, auditData, stickerData] =
        await Promise.all([
          request(`/spaces/${space.id}/manage`),
          request(`/spaces/${space.id}/moderation`).catch(() => null),
          request(`/spaces/${space.id}/audit`).catch(() => []),
          request(`/spaces/${space.id}/stickers`).catch(() => []),
        ]);
      setData(management as Management);
      setModeration(moderationData as Moderation | null);
      setAuditEntries(auditData as AuditEntry[]);
      setStickers(stickerData as SpaceSticker[]);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar a comunidade.",
      );
    }
  }, [request, space.id]);

  // Loading remote state is the synchronization purpose of this effect.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível concluir a operação.",
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (
    path: string,
    file: File | undefined,
    extra?: { name: string },
  ) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (extra) form.append("name", extra.name);
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "Não foi possível enviar a imagem.");
  };

  const saveOrder = async (
    categories: Category[],
    channels: Channel[],
  ) => {
    await request(`/spaces/${space.id}/order`, {
      method: "PUT",
      body: JSON.stringify({
        categoryIds: categories.map((category) => category.id),
        channels: channels.map((channel) => ({
          id: channel.id,
          categoryId: channel.categoryId ?? null,
        })),
      }),
    });
    await onChanged();
  };

  const move = <T,>(items: T[], index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };

  const updateMember = (member: Member, changes: Partial<Member>) =>
    setData((current) =>
      current
        ? {
            ...current,
            members: current.members.map((item) =>
              item.id === member.id ? { ...item, ...changes } : item,
            ),
          }
        : current,
    );

  return (
    <div className="dialog-backdrop">
      <section
        className="management-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Configurações da comunidade"
      >
        <header>
          <div>
            <span>CONFIGURAÇÕES DA COMUNIDADE</span>
            <h2>{space.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>
        {!data ? (
          <div className="access-loading">Carregando…</div>
        ) : (
          <div className="management-grid">
            <section>
              <h3>Comunidade</h3>
              <div className="community-icon-editor">
                <span>
                  {space.iconUrl ? (
                    <img src={`${apiUrl}${space.iconUrl}`} alt="" />
                  ) : (
                    space.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                <input
                  hidden
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) =>
                    void run(async () => {
                      await uploadImage(
                        `/spaces/${space.id}/icon`,
                        event.target.files?.[0],
                      );
                      await onChanged();
                    })
                  }
                />
                <button onClick={() => iconInputRef.current?.click()}>
                  <Image size={15} /> Alterar ícone
                </button>
                {space.iconUrl && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        await request(`/spaces/${space.id}/icon`, {
                          method: "DELETE",
                        });
                        await onChanged();
                      })
                    }
                  >
                    Remover
                  </button>
                )}
              </div>
              <div className="management-inline">
                <input
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                />
                <button
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void run(async () => {
                      await request(`/spaces/${space.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ name, description }),
                      });
                      await onChanged();
                    })
                  }
                >
                  <Save size={15} /> Salvar
                </button>
              </div>
              <textarea
                className="community-description"
                value={description}
                maxLength={300}
                placeholder="Descrição da comunidade"
                onChange={(event) => setDescription(event.target.value)}
              />
              {space.role === "owner" && (
                <button
                  className={`danger-action ${confirmDelete ? "danger-action--confirm" : ""}`}
                  disabled={busy}
                  onClick={() =>
                    confirmDelete
                      ? void run(async () => {
                          await request(`/spaces/${space.id}`, {
                            method: "DELETE",
                          });
                          await onChanged(true);
                          onClose();
                        })
                      : setConfirmDelete(true)
                  }
                >
                  <Trash2 size={15} />
                  {confirmDelete
                    ? "Confirmar exclusão definitiva"
                    : "Excluir comunidade"}
                </button>
              )}
              {space.role !== "owner" && (
                <button
                  className="danger-action"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(`/spaces/${space.id}/leave`, {
                        method: "POST",
                      });
                      await onChanged(true);
                      onClose();
                    })
                  }
                >
                  <LogOut size={15} /> Sair da comunidade
                </button>
              )}
            </section>
            <section>
              <h3>Cargos personalizados</h3>
              <div className="management-inline">
                <input
                  value={roleName}
                  maxLength={40}
                  placeholder="Nome do cargo"
                  onChange={(event) => setRoleName(event.target.value)}
                />
                <input
                  className="role-color"
                  type="color"
                  value={roleColor}
                  onChange={(event) => setRoleColor(event.target.value)}
                />
                <button
                  disabled={busy || !roleName.trim()}
                  onClick={() =>
                    void run(async () => {
                      await request(`/spaces/${space.id}/roles`, {
                        method: "POST",
                        body: JSON.stringify({
                          name: roleName,
                          color: roleColor,
                        }),
                      });
                      setRoleName("");
                      await load();
                    })
                  }
                >
                  <Plus size={15} /> Criar
                </button>
              </div>
              <div className="role-list">
                {data.roles.length === 0 && <p>Nenhum cargo personalizado.</p>}
                {data.roles.map((role) => (
                  <RoleEditor
                    key={role.id}
                    role={role}
                    busy={busy}
                    onSave={(updated) =>
                      run(async () => {
                        await request(`/spaces/${space.id}/roles/${role.id}`, {
                          method: "PATCH",
                          body: JSON.stringify(updated),
                        });
                        await load();
                        await onChanged();
                      })
                    }
                    onDelete={() =>
                      run(async () => {
                        await request(`/spaces/${space.id}/roles/${role.id}`, {
                          method: "DELETE",
                        });
                        await load();
                        await onChanged();
                      })
                    }
                  />
                ))}
              </div>
            </section>
            <section className="management-wide">
              <h3>
                <Users size={16} /> Membros
              </h3>
              <div className="member-admin-list">
                {data.members.map((member) => (
                  <article key={member.id}>
                    <div className="access-avatar">
                      {member.displayName[0].toUpperCase()}
                    </div>
                    <div className="member-admin-copy">
                      <strong>
                        {member.displayName}
                        {member.id === currentUserId && " (você)"}
                      </strong>
                      <small>{member.email}</small>
                    </div>
                    <select
                      disabled={member.role === "owner" || busy}
                      value={member.role}
                      onChange={(event) =>
                        updateMember(member, { role: event.target.value })
                      }
                    >
                      <option value="member">Membro</option>
                      <option value="admin">Administrador</option>
                      {member.role === "owner" && (
                        <option value="owner">Proprietário</option>
                      )}
                    </select>
                    <div className="member-role-pills">
                      {data.roles.map((role) => (
                        <button
                          key={role.id}
                          disabled={member.role === "owner" || busy}
                          className={
                            member.roleIds.includes(role.id) ? "selected" : ""
                          }
                          onClick={() =>
                            updateMember(member, {
                              roleIds: member.roleIds.includes(role.id)
                                ? member.roleIds.filter((id) => id !== role.id)
                                : [...member.roleIds, role.id],
                            })
                          }
                        >
                          <i style={{ background: role.color }} />
                          {role.name}
                          {member.roleIds.includes(role.id) && (
                            <Check size={11} />
                          )}
                        </button>
                      ))}
                    </div>
                    {member.role !== "owner" && (
                      <div className="member-admin-actions">
                        {space.role === "owner" && (
                          <button
                            title="Transferir propriedade"
                            onClick={() =>
                              void run(async () => {
                                await request(
                                  `/spaces/${space.id}/transfer/${member.id}`,
                                  { method: "POST" },
                                );
                                await load();
                                await onChanged();
                              })
                            }
                          >
                            <Crown size={15} />
                          </button>
                        )}
                        <button
                          title="Salvar membro"
                          onClick={() =>
                            void run(async () => {
                              await request(
                                `/spaces/${space.id}/members/${member.id}`,
                                {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    role: member.role,
                                    roleIds: member.roleIds,
                                  }),
                                },
                              );
                              await load();
                              await onChanged();
                            })
                          }
                        >
                          <Shield size={15} />
                        </button>
                        <button
                          title="Remover membro"
                          className="danger-icon"
                          onClick={() =>
                            void run(async () => {
                              await request(
                                `/spaces/${space.id}/members/${member.id}`,
                                { method: "DELETE" },
                              );
                              await load();
                              await onChanged();
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
            <section className="management-wide">
              <h3>Categorias</h3>
              <div className="management-inline">
                <input
                  value={categoryName}
                  maxLength={50}
                  placeholder="Nova categoria"
                  onChange={(event) => setCategoryName(event.target.value)}
                />
                <button
                  disabled={busy || !categoryName.trim()}
                  onClick={() =>
                    void run(async () => {
                      await request(`/spaces/${space.id}/categories`, {
                        method: "POST",
                        body: JSON.stringify({ name: categoryName }),
                      });
                      setCategoryName("");
                      await onChanged();
                    })
                  }
                >
                  <Plus size={15} /> Criar categoria
                </button>
              </div>
              <div className="category-admin-list">
                {space.categories.map((category, index) => (
                  <CategoryAdmin
                    key={category.id}
                    category={category}
                    busy={busy}
                    onMove={(offset) =>
                      run(() =>
                        saveOrder(
                          move(space.categories, index, offset),
                          space.channels,
                        ),
                      )
                    }
                    onSave={(nextName) =>
                      run(async () => {
                        await request(
                          `/spaces/${space.id}/categories/${category.id}`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({ name: nextName }),
                          },
                        );
                        await onChanged();
                      })
                    }
                    onDelete={() =>
                      run(async () => {
                        await request(
                          `/spaces/${space.id}/categories/${category.id}`,
                          { method: "DELETE" },
                        );
                        await onChanged();
                      })
                    }
                  />
                ))}
              </div>
            </section>
            <section className="management-wide">
              <h3>Canais</h3>
              <div className="channel-admin-list">
                {space.channels.map((channel, index) => (
                  <ChannelAdmin
                    key={channel.id}
                    channel={channel}
                    busy={busy}
                    categories={space.categories}
                    onMove={(offset) =>
                      run(() =>
                        saveOrder(
                          space.categories,
                          move(space.channels, index, offset),
                        ),
                      )
                    }
                    onSave={(nextName, topic, categoryId) =>
                      run(async () => {
                        await request(
                          `/spaces/${space.id}/channels/${channel.id}`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({
                              name: nextName,
                              topic,
                              categoryId,
                            }),
                          },
                        );
                        await onChanged();
                      })
                    }
                    onDelete={() =>
                      run(async () => {
                        await request(
                          `/spaces/${space.id}/channels/${channel.id}`,
                          { method: "DELETE" },
                        );
                        await onChanged();
                      })
                    }
                  />
                ))}
              </div>
            </section>
            <section className="management-wide">
              <h3>
                <Link2 size={16} /> Convites ativos
              </h3>
              <div className="invite-create-options">
                <label>
                  Expira em
                  <select
                    value={inviteDays}
                    onChange={(event) => setInviteDays(Number(event.target.value))}
                  >
                    <option value={1}>1 dia</option>
                    <option value={7}>7 dias</option>
                    <option value={30}>30 dias</option>
                  </select>
                </label>
                <label>
                  Máximo de usos
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={inviteMaxUses}
                    onChange={(event) => setInviteMaxUses(Number(event.target.value))}
                  />
                </label>
                <button
                  onClick={() =>
                    void run(async () => {
                      await request(`/spaces/${space.id}/invites`, {
                        method: "POST",
                        body: JSON.stringify({
                          expiresInDays: inviteDays,
                          ...(inviteMaxUses > 0
                            ? { maxUses: inviteMaxUses }
                            : {}),
                        }),
                      });
                      await load();
                    })
                  }
                >
                  <Plus size={15} /> Criar convite
                </button>
              </div>
              <div className="invite-admin-list">
                {data.invites.length === 0 && <p>Nenhum convite ativo.</p>}
                {data.invites.map((invite) => (
                  <article key={invite.id}>
                    <code>{invite.code}</code>
                    <span>
                      {invite.uses}
                      {invite.maxUses ? `/${invite.maxUses}` : ""} usos
                    </span>
                    <span>
                      expira{" "}
                      {invite.expiresAt
                        ? new Date(invite.expiresAt).toLocaleDateString("pt-BR")
                        : "nunca"}
                    </span>
                    <button
                      title="Copiar link"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          `${window.location.origin}/?invite=${invite.code}`,
                        )
                      }
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      title="Revogar convite"
                      className="danger-icon"
                      onClick={() =>
                        void run(async () => {
                          await request(
                            `/spaces/${space.id}/invites/${invite.id}`,
                            { method: "DELETE" },
                          );
                          await load();
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
            {moderation && (
              <section className="management-wide">
                <h3>
                  <Ban size={16} /> Moderação
                </h3>
                <div className="moderation-list">
                  {moderation.members
                    .filter((member) => member.role !== "owner")
                    .map((member) => (
                      <article key={member.id}>
                        <div className="access-avatar">
                          {member.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <strong>{member.displayName}</strong>
                          <small>
                            {member.timedOutUntil
                              ? `Timeout até ${new Date(member.timedOutUntil).toLocaleString("pt-BR")}`
                              : "Sem restrições"}
                          </small>
                        </div>
                        <button
                          title="Timeout de 1 hora"
                          onClick={() =>
                            void run(async () => {
                              await request(
                                `/spaces/${space.id}/members/${member.id}/timeout`,
                                {
                                  method: "PUT",
                                  body: JSON.stringify({ minutes: 60 }),
                                },
                              );
                              await load();
                            })
                          }
                        >
                          <Clock size={14} /> 1h
                        </button>
                        {member.timedOutUntil && (
                          <button
                            onClick={() =>
                              void run(async () => {
                                await request(
                                  `/spaces/${space.id}/members/${member.id}/timeout`,
                                  {
                                    method: "PUT",
                                    body: JSON.stringify({ minutes: 0 }),
                                  },
                                );
                                await load();
                              })
                            }
                          >
                            Remover timeout
                          </button>
                        )}
                        <button
                          className="danger-icon"
                          title="Banir da comunidade"
                          onClick={() =>
                            void run(async () => {
                              await request(
                                `/spaces/${space.id}/bans/${member.id}`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({
                                    reason: "Banido pela moderação da comunidade",
                                  }),
                                },
                              );
                              await load();
                              await onChanged();
                            })
                          }
                        >
                          <Ban size={14} />
                        </button>
                      </article>
                    ))}
                </div>
                {moderation.bans.length > 0 && (
                  <div className="ban-list">
                    <strong>USUÁRIOS BANIDOS</strong>
                    {moderation.bans.map((ban) => (
                      <article key={ban.id}>
                        <span>{ban.displayName}</span>
                        <small>{ban.reason || "Sem motivo informado"}</small>
                        <button
                          onClick={() =>
                            void run(async () => {
                              await request(`/spaces/${space.id}/bans/${ban.id}`, {
                                method: "DELETE",
                              });
                              await load();
                            })
                          }
                        >
                          Remover banimento
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            <section className="management-wide">
              <h3>
                <Image size={16} /> Figurinhas da comunidade
              </h3>
              <div className="sticker-admin-create">
                <input
                  value={stickerName}
                  maxLength={40}
                  placeholder="Nome da figurinha"
                  onChange={(event) => setStickerName(event.target.value)}
                />
                <input
                  hidden
                  ref={stickerInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) =>
                    void run(async () => {
                      await uploadImage(
                        `/spaces/${space.id}/stickers`,
                        event.target.files?.[0],
                        { name: stickerName },
                      );
                      setStickerName("");
                      await load();
                    })
                  }
                />
                <button
                  disabled={!stickerName.trim() || busy}
                  onClick={() => stickerInputRef.current?.click()}
                >
                  <Plus size={15} /> Enviar figurinha
                </button>
              </div>
              <div className="sticker-admin-list">
                {stickers.map((sticker) => (
                  <article key={sticker.id}>
                    <img src={`${apiUrl}${sticker.url}`} alt={sticker.name} />
                    <span>{sticker.name}</span>
                    <button
                      className="danger-icon"
                      onClick={() =>
                        void run(async () => {
                          await request(
                            `/spaces/${space.id}/stickers/${sticker.id}`,
                            { method: "DELETE" },
                          );
                          await load();
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
            {auditEntries.length > 0 && (
              <section className="management-wide">
                <h3>
                  <FileClock size={16} /> Registro de auditoria
                </h3>
                <div className="audit-list">
                  {auditEntries.map((entry) => (
                    <article key={entry.id}>
                      <strong>{entry.actor.displayName}</strong>
                      <span>{auditActionLabel(entry.action)}</span>
                      <small>{new Date(entry.createdAt).toLocaleString("pt-BR")}</small>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {error && <div className="dialog-error">{error}</div>}
      </section>
    </div>
  );
}

function RoleEditor({
  role,
  busy,
  onSave,
  onDelete,
}: {
  role: CustomRole;
  busy: boolean;
  onSave: (
    role: Pick<CustomRole, "name" | "color" | "permissions">,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [permissions, setPermissions] = useState(role.permissions);
  return (
    <div className="role-editor">
      <div className="role-editor__head">
        <input
          className="role-color"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
        <input
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          disabled={busy || !name.trim()}
          title="Salvar cargo"
          onClick={() => void onSave({ name, color, permissions })}
        >
          <Save size={14} />
        </button>
        <button
          disabled={busy}
          className="danger-icon"
          title="Excluir cargo"
          onClick={() => void onDelete()}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="role-permissions">
        {permissionOptions.map(([id, label]) => (
          <button
            key={id}
            className={permissions.includes(id) ? "selected" : ""}
            aria-pressed={permissions.includes(id)}
            onClick={() =>
              setPermissions((current) =>
                current.includes(id)
                  ? current.filter((item) => item !== id)
                  : [...current, id],
              )
            }
          >
            <Check size={11} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CategoryAdmin({
  category,
  busy,
  onSave,
  onDelete,
  onMove,
}: {
  category: Category;
  busy: boolean;
  onSave: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (offset: number) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  return (
    <div>
      <input
        value={name}
        maxLength={50}
        onChange={(event) => setName(event.target.value)}
      />
      <button disabled={busy} title="Mover para cima" onClick={() => void onMove(-1)}>
        ↑
      </button>
      <button disabled={busy} title="Mover para baixo" onClick={() => void onMove(1)}>
        ↓
      </button>
      <button disabled={busy || !name.trim()} onClick={() => void onSave(name)}>
        <Save size={14} />
      </button>
      <button className="danger-icon" disabled={busy} onClick={() => void onDelete()}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function ChannelAdmin({
  channel,
  busy,
  categories,
  onSave,
  onDelete,
  onMove,
}: {
  channel: Channel;
  busy: boolean;
  categories: Category[];
  onSave: (
    name: string,
    topic: string,
    categoryId: string | null,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (offset: number) => Promise<void>;
}) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [categoryId, setCategoryId] = useState(channel.categoryId ?? "");
  const [confirming, setConfirming] = useState(false);
  const Icon = channel.kind === "VOICE" ? Volume2 : Hash;
  return (
    <div>
      <Icon size={16} />
      <input
        value={name}
        maxLength={50}
        onChange={(event) => setName(event.target.value)}
      />
      {channel.kind === "TEXT" && (
        <input
          className="channel-topic-input"
          value={topic}
          maxLength={1024}
          placeholder="Tópico do canal"
          onChange={(event) => setTopic(event.target.value)}
        />
      )}
      <select
        value={categoryId}
        onChange={(event) => setCategoryId(event.target.value)}
      >
        <option value="">Sem categoria</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <button disabled={busy} title="Mover para cima" onClick={() => void onMove(-1)}>
        ↑
      </button>
      <button disabled={busy} title="Mover para baixo" onClick={() => void onMove(1)}>
        ↓
      </button>
      <button
        disabled={busy || !name.trim()}
        onClick={() => void onSave(name, topic, categoryId || null)}
      >
        <Save size={14} />
      </button>
      <button
        className={confirming ? "danger-icon confirming" : "danger-icon"}
        disabled={busy}
        title={confirming ? "Clique novamente para excluir" : "Excluir canal"}
        onClick={() => (confirming ? void onDelete() : setConfirming(true))}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    SPACE_CREATE: "criou a comunidade",
    SPACE_UPDATE: "atualizou a comunidade",
    ROLE_CREATE: "criou um cargo",
    ROLE_UPDATE: "atualizou um cargo",
    ROLE_DELETE: "excluiu um cargo",
    MEMBER_UPDATE: "atualizou um membro",
    MEMBER_REMOVE: "removeu um membro",
    MEMBER_TIMEOUT: "aplicou um timeout",
    MEMBER_TIMEOUT_CLEAR: "removeu um timeout",
    MEMBER_BAN: "baniu um membro",
    MEMBER_UNBAN: "removeu um banimento",
    CHANNEL_CREATE: "criou um canal",
    CHANNEL_UPDATE: "atualizou um canal",
    CHANNEL_DELETE: "excluiu um canal",
    CHANNELS_REORDER: "reordenou canais e categorias",
    CATEGORY_CREATE: "criou uma categoria",
    CATEGORY_UPDATE: "atualizou uma categoria",
    CATEGORY_DELETE: "excluiu uma categoria",
    INVITE_CREATE: "criou um convite",
    INVITE_REVOKE: "revogou um convite",
    STICKER_CREATE: "criou uma figurinha",
    STICKER_DELETE: "excluiu uma figurinha",
    THREAD_CREATE: "criou uma thread",
    THREAD_ARCHIVE: "arquivou uma thread",
    THREAD_REOPEN: "reabriu uma thread",
  };
  return labels[action] ?? action.toLowerCase().replaceAll("_", " ");
}
