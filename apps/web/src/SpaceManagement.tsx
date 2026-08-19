import { useCallback, useEffect, useState } from 'react'
import { Check, Hash, Plus, Save, Shield, Trash2, Users, Volume2, X } from 'lucide-react'

type Channel = { id: string; name: string; kind: 'TEXT' | 'VOICE' }
type Space = { id: string; name: string; role: string; channels: Channel[] }
type CustomRole = { id: string; name: string; color: string }
type Member = { id: string; displayName: string; email: string; role: string; roleIds: string[] }
type Management = { id: string; name: string; roles: CustomRole[]; members: Member[] }

export function SpaceManagement({ apiUrl, space, currentUserId, onClose, onChanged }: { apiUrl: string; space: Space; currentUserId: string; onClose: () => void; onChanged: (deleted?: boolean) => Promise<void> }) {
  const [data, setData] = useState<Management | null>(null)
  const [name, setName] = useState(space.name)
  const [roleName, setRoleName] = useState('')
  const [roleColor, setRoleColor] = useState('#87909f')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`${apiUrl}${path}`, { credentials: 'include', ...init, headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
    const payload = await response.json().catch(() => ({})) as { message?: string }
    if (!response.ok) throw new Error(payload.message ?? 'Não foi possível concluir a operação.')
    return payload
  }, [apiUrl])

  const load = useCallback(async () => {
    try { setData(await request(`/spaces/${space.id}/manage`) as Management) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a comunidade.') }
  }, [request, space.id])

  // Loading remote state is the synchronization purpose of this effect.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a operação.') } finally { setBusy(false) }
  }

  const updateMember = (member: Member, changes: Partial<Member>) => setData((current) => current ? ({ ...current, members: current.members.map((item) => item.id === member.id ? { ...item, ...changes } : item) }) : current)

  return <div className="dialog-backdrop"><section className="management-dialog" role="dialog" aria-modal="true" aria-label="Configurações da comunidade">
    <header><div><span>CONFIGURAÇÕES DA COMUNIDADE</span><h2>{space.name}</h2></div><button onClick={onClose} aria-label="Fechar"><X size={20} /></button></header>
    {!data ? <div className="access-loading">Carregando…</div> : <div className="management-grid">
      <section><h3>Comunidade</h3><div className="management-inline"><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /><button disabled={busy || !name.trim()} onClick={() => void run(async () => { await request(`/spaces/${space.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await onChanged() })}><Save size={15} /> Salvar</button></div>
        {space.role === 'owner' && <button className={`danger-action ${confirmDelete ? 'danger-action--confirm' : ''}`} disabled={busy} onClick={() => confirmDelete ? void run(async () => { await request(`/spaces/${space.id}`, { method: 'DELETE' }); await onChanged(true); onClose() }) : setConfirmDelete(true)}><Trash2 size={15} />{confirmDelete ? 'Confirmar exclusão definitiva' : 'Excluir comunidade'}</button>}
      </section>
      <section><h3>Cargos personalizados</h3><div className="management-inline"><input value={roleName} maxLength={40} placeholder="Nome do cargo" onChange={(event) => setRoleName(event.target.value)} /><input className="role-color" type="color" value={roleColor} onChange={(event) => setRoleColor(event.target.value)} /><button disabled={busy || !roleName.trim()} onClick={() => void run(async () => { await request(`/spaces/${space.id}/roles`, { method: 'POST', body: JSON.stringify({ name: roleName, color: roleColor }) }); setRoleName(''); await load() })}><Plus size={15} /> Criar</button></div>
        <div className="role-list">{data.roles.length === 0 && <p>Nenhum cargo personalizado.</p>}{data.roles.map((role) => <div key={role.id}><i style={{ background: role.color }} /><strong>{role.name}</strong><button aria-label={`Excluir ${role.name}`} onClick={() => void run(async () => { await request(`/spaces/${space.id}/roles/${role.id}`, { method: 'DELETE' }); await load(); await onChanged() })}><Trash2 size={14} /></button></div>)}</div>
      </section>
      <section className="management-wide"><h3><Users size={16} /> Membros</h3><div className="member-admin-list">{data.members.map((member) => <article key={member.id}><div className="access-avatar">{member.displayName[0].toUpperCase()}</div><div className="member-admin-copy"><strong>{member.displayName}{member.id === currentUserId && ' (você)'}</strong><small>{member.email}</small></div><select disabled={member.role === 'owner' || busy} value={member.role} onChange={(event) => updateMember(member, { role: event.target.value })}><option value="member">Membro</option><option value="admin">Administrador</option>{member.role === 'owner' && <option value="owner">Proprietário</option>}</select><div className="member-role-pills">{data.roles.map((role) => <button key={role.id} disabled={member.role === 'owner' || busy} className={member.roleIds.includes(role.id) ? 'selected' : ''} onClick={() => updateMember(member, { roleIds: member.roleIds.includes(role.id) ? member.roleIds.filter((id) => id !== role.id) : [...member.roleIds, role.id] })}><i style={{ background: role.color }} />{role.name}{member.roleIds.includes(role.id) && <Check size={11} />}</button>)}</div>{member.role !== 'owner' && <div className="member-admin-actions"><button title="Salvar membro" onClick={() => void run(async () => { await request(`/spaces/${space.id}/members/${member.id}`, { method: 'PUT', body: JSON.stringify({ role: member.role, roleIds: member.roleIds }) }); await load(); await onChanged() })}><Shield size={15} /></button><button title="Remover membro" className="danger-icon" onClick={() => void run(async () => { await request(`/spaces/${space.id}/members/${member.id}`, { method: 'DELETE' }); await load(); await onChanged() })}><Trash2 size={15} /></button></div>}</article>)}</div></section>
      <section className="management-wide"><h3>Canais</h3><div className="channel-admin-list">{space.channels.map((channel) => <ChannelAdmin key={channel.id} channel={channel} busy={busy} onSave={(nextName) => run(async () => { await request(`/spaces/${space.id}/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ name: nextName }) }); await onChanged() })} onDelete={() => run(async () => { await request(`/spaces/${space.id}/channels/${channel.id}`, { method: 'DELETE' }); await onChanged() })} />)}</div></section>
    </div>}
    {error && <div className="dialog-error">{error}</div>}
  </section></div>
}

function ChannelAdmin({ channel, busy, onSave, onDelete }: { channel: Channel; busy: boolean; onSave: (name: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [name, setName] = useState(channel.name)
  const [confirming, setConfirming] = useState(false)
  const Icon = channel.kind === 'VOICE' ? Volume2 : Hash
  return <div><Icon size={16} /><input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} /><button disabled={busy || !name.trim()} onClick={() => void onSave(name)}><Save size={14} /></button><button className={confirming ? 'danger-icon confirming' : 'danger-icon'} disabled={busy} title={confirming ? 'Clique novamente para excluir' : 'Excluir canal'} onClick={() => confirming ? void onDelete() : setConfirming(true)}><Trash2 size={14} /></button></div>
}
