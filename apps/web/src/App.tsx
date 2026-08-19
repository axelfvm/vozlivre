import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AudioLines, Bell, Check, ChevronDown, ChevronRight, Copy, FileImage, Gift, Hash, HeadphoneOff, Headphones, KeyRound, LayoutGrid, Link2, Lock, LogOut, Mail, Mic, MonitorUp, Palette, Pencil, PhoneOff, Pin, Plus, Radio, Reply, Save, Send, Settings, Shield, SlidersHorizontal, Smile, Sparkles, Sticker, Trash2, UserPlus, Users, Video, Volume2, X } from 'lucide-react'
import { LiveKitRoom, RoomAudioRenderer, TrackToggle, VideoConference, useRoomContext } from '@livekit/components-react'
import '@livekit/components-styles'
import { RoomEvent, ScreenSharePresets, Track } from 'livekit-client'
import type { RemoteParticipant, RoomOptions, ScreenShareCaptureOptions, TrackPublishOptions } from 'livekit-client'
import { io } from 'socket.io-client'
import './App.css'
import { SpaceManagement } from './SpaceManagement'

type Message = { id: string; channelId: string; authorId: string; author: string; body: string; createdAt: string; editedAt: string | null; replyTo: { id: string; author: string; body: string } | null; reactions: { emoji: string; count: number; userIds: string[] }[] }
type HistoryPage = { messages: Message[]; hasMore: boolean }
type Channel = { id: string; name: string; kind: 'TEXT' | 'VOICE'; position: number }
type Space = { id: string; name: string; role: string; channels: Channel[] }
type AuthUser = { id: string; email: string; displayName: string; avatarUrl: string | null }
type VoiceParticipant = { userId: string; displayName: string }
type VoicePresenceUpdate = { channelId: string; participants: VoiceParticipant[] }
type ChannelAccessMember = { id: string; displayName: string; email: string; role: string }
type ChannelAccessRole = { id: string; name: string }
type ChannelAccess = { restricted: boolean; memberIds: string[]; roles: string[]; members: ChannelAccessMember[]; availableRoles: ChannelAccessRole[] }
const API_URL = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin)).replace(/\/$/, '')
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL ?? (import.meta.env.DEV ? 'ws://localhost:7880' : '')
const socket = io(API_URL, { autoConnect: false, withCredentials: true })
const LOW_LATENCY_ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    videoCodec: 'vp8',
    backupCodec: false,
    degradationPreference: 'maintain-framerate',
    screenShareEncoding: {
      ...ScreenSharePresets.h1080fps30.encoding,
      priority: 'high',
    },
    // Screen sharing previously encoded 1080p and 540p at the same time.
    // Keep camera simulcast, but publish a single screen layer in small rooms.
    screenShareSimulcastLayers: [],
  },
}
const LOW_LATENCY_SCREEN_CAPTURE: ScreenShareCaptureOptions = {
  audio: true,
  contentHint: 'motion',
  resolution: ScreenSharePresets.h1080fps30.resolution,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'include',
}
const LOW_LATENCY_SCREEN_PUBLISH: TrackPublishOptions = {
  videoCodec: 'vp8',
  backupCodec: false,
  degradationPreference: 'maintain-framerate',
  screenShareEncoding: {
    ...ScreenSharePresets.h1080fps30.encoding,
    priority: 'high',
  },
  simulcast: false,
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionNotice, setSessionNotice] = useState('')
  const handleLogout = useCallback((message = '') => {
    setSessionNotice(message)
    setUser(null)
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/auth/me`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null
        return ((await response.json()) as { user: AuthUser }).user
      })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="auth-loading"><div className="auth-mark"><img src="/app-icon-192.png" alt="" /></div><span>Carregando seu espaço…</span></div>
  if (!user) return <AuthScreen initialError={sessionNotice} onAuthenticated={(authenticatedUser) => { setSessionNotice(''); setUser(authenticatedUser) }} />

  return <ChatApp user={user} onLogout={handleLogout} onUserUpdated={setUser} />
}

function ChatApp({ user, onLogout, onUserUpdated }: { user: AuthUser; onLogout: (message?: string) => void; onUserUpdated: (user: AuthUser) => void }) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState('')
  const [activeChannelId, setActiveChannelId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState('')
  const [editingBody, setEditingBody] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const olderScrollHeightRef = useRef<number | null>(null)
  const [draft, setDraft] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [callToken, setCallToken] = useState<string | null>(null)
  const [voiceChannelId, setVoiceChannelId] = useState('')
  const [voicePresence, setVoicePresence] = useState<Record<string, VoiceParticipant[]>>({})
  const [showVoiceStage, setShowVoiceStage] = useState(false)
  const [callError, setCallError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [spaceManagementOpen, setSpaceManagementOpen] = useState(false)
  const [workspaceMenu, setWorkspaceMenu] = useState(false)
  const [dialog, setDialog] = useState<'community' | 'channel' | 'invite' | 'join' | null>(null)
  const [communityName, setCommunityName] = useState('')
  const [channelName, setChannelName] = useState('')
  const [channelKind, setChannelKind] = useState<'TEXT' | 'VOICE'>('TEXT')
  const [inviteUrl, setInviteUrl] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [channelAccess, setChannelAccess] = useState<ChannelAccess | null>(null)
  const [accessMemberIds, setAccessMemberIds] = useState<string[]>([])
  const [accessRoles, setAccessRoles] = useState<string[]>([])
  const [accessRestricted, setAccessRestricted] = useState(false)

  const activeSpace = useMemo(() => spaces.find((space) => space.id === activeSpaceId) ?? spaces[0], [activeSpaceId, spaces])
  const channel = useMemo(() => activeSpace?.channels.find((item) => item.id === activeChannelId), [activeChannelId, activeSpace])
  const voiceChannel = useMemo(() => spaces.flatMap((space) => space.channels).find((item) => item.id === voiceChannelId), [spaces, voiceChannelId])

  const loadSpaces = useCallback(async (preferredSpaceId?: string) => {
    const response = await fetch(`${API_URL}/spaces`, { credentials: 'include' })
    if (!response.ok) throw new Error('Não foi possível carregar seus espaços.')
    const data = (await response.json()) as Space[]
    setSpaces(data)
    const nextSpace = data.find((space) => space.id === preferredSpaceId) ?? data[0]
    if (!nextSpace) {
      setActiveSpaceId('')
      setActiveChannelId('')
      return
    }
    setActiveSpaceId(nextSpace.id)
    setActiveChannelId((current) => nextSpace.channels.some((item) => item.id === current && item.kind === 'TEXT') ? current : (nextSpace.channels.find((item) => item.kind === 'TEXT')?.id ?? ''))
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/spaces`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível carregar seus espaços.')
        return response.json() as Promise<Space[]>
      })
      .then((data) => {
        setSpaces(data)
        const firstSpace = data[0]
        if (!firstSpace) return
        setActiveSpaceId(firstSpace.id)
        setActiveChannelId(firstSpace.channels.find((item) => item.kind === 'TEXT')?.id ?? '')
      })
      .catch((error) => setCallError(error instanceof Error ? error.message : 'Não foi possível carregar os espaços.'))
  }, [])

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('invite')
    if (!code) return
    fetch(`${API_URL}/invites/${encodeURIComponent(code)}/join`, { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Convite inválido.')
        return response.json() as Promise<{ id: string }>
      })
      .then(async (joined) => { window.history.replaceState({}, '', window.location.pathname); await loadSpaces(joined.id) })
      .catch((error) => setCallError(error instanceof Error ? error.message : 'Convite inválido.'))
  }, [loadSpaces])

  useEffect(() => {
    const handleHistory = (history: HistoryPage) => { setMessages(history.messages); setHasMoreMessages(history.hasMore) }
    const handleMoreHistory = (history: HistoryPage) => { const list = messagesRef.current; const previousHeight = olderScrollHeightRef.current; setMessages((current) => [...history.messages, ...current]); setHasMoreMessages(history.hasMore); requestAnimationFrame(() => { if (list && previousHeight !== null) list.scrollTop += list.scrollHeight - previousHeight; olderScrollHeightRef.current = null }) }
    const handleMessage = (message: Message) => setMessages((current) => [...current, message])
    const handleMessageUpdate = (message: Message) => setMessages((current) => current.map((item) => item.id === message.id ? message : item))
    const handleMessageDelete = ({ id }: { id: string }) => setMessages((current) => current.filter((item) => item.id !== id))
    const handleChatError = (payload: { message?: string }) => setCallError(payload.message ?? 'Não foi possível acessar o canal.')
    const handleVoiceError = (payload: { message?: string }) => setCallError(payload.message ?? 'Não foi possível atualizar a presença de voz.')
    const handleVoiceSnapshot = (snapshot: VoicePresenceUpdate[]) => setVoicePresence(Object.fromEntries(snapshot.map((entry) => [entry.channelId, entry.participants])))
    const handleVoicePresence = (update: VoicePresenceUpdate) => setVoicePresence((current) => ({ ...current, [update.channelId]: update.participants }))
    const handleConnect = () => socket.emit('spaces:sync')
    const handleSpacesChanged = () => { void loadSpaces(activeSpaceId) }
    const handleAuthError = (payload: { message?: string }) => {
      setCallToken(null)
      onLogout(payload.message ?? 'Sua sessão não é mais válida.')
    }
    socket.on('chat:history', handleHistory)
    socket.on('chat:message', handleMessage)
    socket.on('chat:history:more', handleMoreHistory)
    socket.on('chat:message:update', handleMessageUpdate)
    socket.on('chat:message:delete', handleMessageDelete)
    socket.on('auth:error', handleAuthError)
    socket.on('chat:error', handleChatError)
    socket.on('voice:error', handleVoiceError)
    socket.on('voice:presence:snapshot', handleVoiceSnapshot)
    socket.on('voice:presence', handleVoicePresence)
    socket.on('connect', handleConnect)
    socket.on('spaces:changed', handleSpacesChanged)
    socket.connect()
    return () => { socket.off('chat:history', handleHistory); socket.off('chat:history:more', handleMoreHistory); socket.off('chat:message', handleMessage); socket.off('chat:message:update', handleMessageUpdate); socket.off('chat:message:delete', handleMessageDelete); socket.off('auth:error', handleAuthError); socket.off('chat:error', handleChatError); socket.off('voice:error', handleVoiceError); socket.off('voice:presence:snapshot', handleVoiceSnapshot); socket.off('voice:presence', handleVoicePresence); socket.off('connect', handleConnect); socket.off('spaces:changed', handleSpacesChanged); socket.disconnect() }
  }, [activeSpaceId, loadSpaces, onLogout])

  useEffect(() => { if (socket.connected) socket.emit('spaces:sync') }, [spaces])

  useEffect(() => { if (channel?.kind === 'TEXT') socket.emit('chat:join', { channelId: channel.id }) }, [channel])
  useEffect(() => { const list = messagesRef.current; if (list && olderScrollHeightRef.current === null) list.scrollTop = list.scrollHeight }, [activeChannelId, messages])

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    if (!channel || channel.kind !== 'TEXT') return
    socket.emit('chat:send', { channelId: channel.id, body: draft, replyToId: replyingTo?.id })
    setDraft(''); setReplyingTo(null)
  }

  const saveMessageEdit = (event: FormEvent, messageId: string) => {
    event.preventDefault(); if (!editingBody.trim()) return
    socket.emit('chat:edit', { messageId, body: editingBody }); setEditingId(''); setEditingBody('')
  }

  const joinCall = async (channelId: string) => {
    setCallError('')
    try {
      if (!LIVEKIT_URL) throw new Error('O servidor de chamadas não foi configurado neste ambiente.')
      const response = await fetch(`${API_URL}/voice/token`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      })
      if (!response.ok) throw new Error('A API de chamadas não respondeu.')
      const data = (await response.json()) as { token: string }
      if (voiceChannelId && voiceChannelId !== channelId) socket.emit('voice:leave', { channelId: voiceChannelId })
      setCallToken(data.token)
      setVoiceChannelId(channelId)
      setShowVoiceStage(false)
    } catch (error) { setCallError(error instanceof Error ? error.message : 'Não foi possível entrar na sala.') }
  }

  const leaveCall = (channelId = voiceChannelId) => {
    if (channelId) socket.emit('voice:leave', { channelId })
    if (!channelId || channelId === voiceChannelId) {
      setCallToken(null); setVoiceChannelId(''); setShowVoiceStage(false)
    }
  }

  const openDialog = (next: 'community' | 'channel' | 'invite' | 'join') => {
    setWorkspaceMenu(false); setDialog(next); setFormError(''); setInviteUrl('')
  }

  const openChannelAccess = async () => {
    if (!activeSpace || !channel) return
    setAccessOpen(true); setFormError(''); setSubmitting(true); setChannelAccess(null)
    try {
      const response = await fetch(`${API_URL}/spaces/${activeSpace.id}/channels/${channel.id}/access`, { credentials: 'include' })
      const payload = (await response.json()) as ChannelAccess & { message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível carregar os acessos do canal.')
      setChannelAccess(payload); setAccessMemberIds(payload.memberIds); setAccessRoles(payload.roles); setAccessRestricted(payload.restricted)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível carregar os acessos do canal.') } finally { setSubmitting(false) }
  }

  const saveChannelAccess = async (event: FormEvent) => {
    event.preventDefault(); if (!activeSpace || !channel) return
    setSubmitting(true); setFormError('')
    try {
      const response = await fetch(`${API_URL}/spaces/${activeSpace.id}/channels/${channel.id}/access`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restricted: accessRestricted, memberIds: accessMemberIds, roles: accessRoles }) })
      const payload = (await response.json()) as { message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível salvar os acessos do canal.')
      await loadSpaces(activeSpace.id); socket.emit('spaces:sync'); setAccessOpen(false)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível salvar os acessos do canal.') } finally { setSubmitting(false) }
  }

  const createCommunity = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setFormError('')
    try {
      const response = await fetch(`${API_URL}/spaces`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: communityName }) })
      const payload = (await response.json()) as Space & { message?: string }
      if (!response.ok || !payload.id) throw new Error(payload.message ?? 'Não foi possível criar a comunidade.')
      await loadSpaces(payload.id); setDialog(null); setCommunityName('')
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível criar a comunidade.') } finally { setSubmitting(false) }
  }

  const createChannel = async (event: FormEvent) => {
    event.preventDefault(); if (!activeSpace) return
    setSubmitting(true); setFormError('')
    try {
      const response = await fetch(`${API_URL}/spaces/${activeSpace.id}/channels`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: channelName, kind: channelKind }) })
      const payload = (await response.json()) as Channel & { message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'Não foi possível criar o canal.')
      await loadSpaces(activeSpace.id); setDialog(null); setChannelName('')
      if (payload.kind === 'TEXT') { setMessages([]); setActiveChannelId(payload.id) }
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível criar o canal.') } finally { setSubmitting(false) }
  }

  const createInvite = async () => {
    if (!activeSpace) return
    setSubmitting(true); setFormError('')
    try {
      const response = await fetch(`${API_URL}/spaces/${activeSpace.id}/invites`, { method: 'POST', credentials: 'include' })
      const payload = (await response.json()) as { inviteUrl?: string; message?: string }
      if (!response.ok || !payload.inviteUrl) throw new Error(payload.message ?? 'Não foi possível criar o convite.')
      setInviteUrl(payload.inviteUrl)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Não foi possível criar o convite.') } finally { setSubmitting(false) }
  }

  const joinInvite = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setFormError('')
    try {
      const code = joinCode.trim().split('invite=').pop() ?? ''
      const response = await fetch(`${API_URL}/invites/${encodeURIComponent(code)}/join`, { method: 'POST', credentials: 'include' })
      const payload = (await response.json()) as { id?: string; message?: string }
      if (!response.ok || !payload.id) throw new Error(payload.message ?? 'Convite inválido.')
      await loadSpaces(payload.id); setDialog(null); setJoinCode('')
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Convite inválido.') } finally { setSubmitting(false) }
  }

  const selectSpace = (space: Space) => {
    setActiveSpaceId(space.id); setActiveChannelId(space.channels.find((item) => item.kind === 'TEXT')?.id ?? ''); setMessages([])
  }

  const shell = (
    <main className="app-shell">
      <nav className="space-rail" aria-label="Espaços">
        <button className="space space--brand" aria-label="Início"><img src="/app-icon-192.png" alt="" /></button><div className="rail-divider" />
        {spaces.map((space, index) => <button key={space.id} className={`space ${space.id === activeSpace?.id ? 'space--active' : ''}`} style={{ '--space-color': ['#ff735f', '#826cff', '#31b98d'][index % 3] } as React.CSSProperties} aria-label={space.name} title={space.name} onClick={() => selectSpace(space)}>{space.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</button>)}
        <button className="space space--action" aria-label="Criar comunidade" title="Criar comunidade" onClick={() => openDialog('community')}><Plus size={21} /></button>
        <button className="space space--action" aria-label="Entrar com convite" title="Entrar com convite" onClick={() => openDialog('join')}><Link2 size={19} /></button>
      </nav>

      <aside className={`channel-panel ${mobileNav ? 'channel-panel--open' : ''}`}>
        {activeSpace ? <>
          <button className="workspace-name" onClick={() => setWorkspaceMenu((value) => !value)}>{activeSpace.name} <ChevronDown size={17} /></button>
          {workspaceMenu && <div className="workspace-menu"><button onClick={() => openDialog('invite')}><UserPlus size={16} /> Convidar pessoas</button><button onClick={() => openDialog('channel')}><Plus size={16} /> Criar canal</button><button onClick={() => openDialog('join')}><Link2 size={16} /> Entrar com convite</button>{['owner', 'admin'].includes(activeSpace.role) && <button onClick={() => { setWorkspaceMenu(false); setSpaceManagementOpen(true) }}><Settings size={16} /> Configurações do espaço</button>}</div>}
          <ChannelGroup title="CANAIS DE TEXTO" channels={activeSpace.channels.filter((item) => item.kind === 'TEXT')} active={activeChannelId} onAdd={() => openDialog('channel')} onSelect={(id) => { setMessages([]); setActiveChannelId(id); setMobileNav(false); setShowVoiceStage(false) }} />
          <ChannelGroup title="CANAIS DE VOZ" channels={activeSpace.channels.filter((item) => item.kind === 'VOICE')} active={voiceChannelId} voicePresence={voicePresence} onAdd={() => openDialog('channel')} onSelect={(id) => void joinCall(id)} onInvite={() => openDialog('invite')} onOpenVoice={() => setShowVoiceStage(true)} onLeaveVoice={() => leaveCall()} />
        </> : <>
          <div className="workspace-name workspace-name--empty">Suas comunidades</div>
          <div className="channel-empty"><strong>Nenhuma comunidade</strong><span>Crie a sua ou use um convite para entrar.</span><button onClick={() => openDialog('community')}><Plus size={16} /> Criar comunidade</button><button onClick={() => openDialog('join')}><Link2 size={16} /> Entrar com convite</button></div>
        </>}
        {callToken && voiceChannel && activeSpace && <VoiceConnectionDock channel={voiceChannel} spaceName={activeSpace.name} onLeave={() => leaveCall()} onOpenStage={() => setShowVoiceStage(true)} onInvite={() => openDialog('invite')} />}
        <div className="profile-bar"><div className="avatar avatar--self">{user.displayName[0].toUpperCase()}</div><div className="profile-copy"><strong>{user.displayName}</strong><span>{callToken && voiceChannel ? `Em ${voiceChannel.name}` : 'VozLivre'}</span></div>{callToken ? <TrackToggle className="profile-voice-toggle" source={Track.Source.Microphone} aria-label="Microfone" /> : <button aria-label="Microfone"><Mic size={18} /></button>}{callToken ? <DeafenToggle /> : <button aria-label="Áudio"><Headphones size={18} /></button>}<button aria-label="Configurações" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button></div>
      </aside>

      <section className="conversation">
        {!activeSpace ? <div className="community-empty"><div className="community-empty__mark">VL</div><span>COMECE SUA COMUNIDADE</span><h1>Seu VozLivre está vazio</h1><p>Comunidades não vêm vinculadas à conta. Crie uma nova ou entre somente com um convite recebido.</p><div><button onClick={() => openDialog('community')}><Plus size={18} /> Criar comunidade</button><button onClick={() => openDialog('join')}><Link2 size={18} /> Entrar com convite</button></div></div> : <>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav((value) => !value)} aria-label="Abrir canais"><span /><span /><span /></button>{showVoiceStage ? <Volume2 size={20} className="muted-icon" /> : <span className="channel-header-icon"><Hash size={21} /><Lock size={9} /></span>}
          <div className="channel-title"><strong>{showVoiceStage ? voiceChannel?.name : channel?.name}</strong>{showVoiceStage && <span>Conectado à sala de voz.</span>}</div>
          <div className="topbar-actions"><button aria-label="Notificações"><Bell size={18} /></button><button aria-label="Mensagens fixadas"><Pin size={18} /></button><button aria-label="Membros"><Users size={19} /></button></div>
        </header>
        {showVoiceStage && callToken ? <div className="voice-stage"><VideoConference /><TrackToggle className="low-latency-share" source={Track.Source.ScreenShare} captureOptions={LOW_LATENCY_SCREEN_CAPTURE} publishOptions={LOW_LATENCY_SCREEN_PUBLISH}><MonitorUp size={16} /><span>Compartilhar tela</span></TrackToggle></div> : <><div className="messages" ref={messagesRef} aria-live="polite">
          <div className="channel-intro"><div className="channel-intro__icon"><Hash size={40} /><Lock size={13} /></div><h1>Bem-vindo(a) a #{channel?.name}!</h1><p>Este é o começo do canal particular <strong>#{channel?.name}</strong>.</p>{['owner', 'admin'].includes(activeSpace.role) && <div className="channel-intro__actions"><button onClick={() => void openChannelAccess()}><UserPlus size={15} /> Adicionar membros ou cargos</button><button onClick={() => openDialog('channel')}><Plus size={15} /> Criar canal</button></div>}<span className="channel-role-badge"><span /> {activeSpace.role === 'owner' ? 'Proprietário' : activeSpace.role === 'admin' ? 'Administrador' : 'Membro'}</span></div>
          {hasMoreMessages && messages[0] && <button className="load-older" onClick={() => { olderScrollHeightRef.current = messagesRef.current?.scrollHeight ?? 0; socket.emit('chat:history:more', { channelId: channel?.id, beforeId: messages[0].id }) }}>Carregar mensagens anteriores</button>}
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const showDate = !previous || messageDay(previous.createdAt) !== messageDay(message.createdAt)
            const compact = isCompactMessage(previous, message)
            const canDelete = message.authorId === user.id || ['owner', 'admin'].includes(activeSpace.role)
            return <Fragment key={message.id}>{showDate && <div className="message-date"><span>{formatMessageDate(message.createdAt)}</span></div>}<article className={`message ${compact ? 'message--compact' : ''}`}>{compact ? <time className="message__hover-time">{formatMessageTime(message.createdAt)}</time> : <Avatar name={message.author} index={index} />}<div className="message__content">{message.replyTo && <button className="message-reply-reference" onClick={() => document.getElementById(`message-${message.replyTo?.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Reply size={11} /><strong>{message.replyTo.author}</strong><span>{message.replyTo.body}</span></button>}{!compact && <div className="message__meta"><strong>{message.author}</strong><time>{formatMessageTime(message.createdAt)}</time>{message.editedAt && <small>(editada)</small>}</div>}{editingId === message.id ? <form className="message-edit" onSubmit={(event) => saveMessageEdit(event, message.id)}><input autoFocus value={editingBody} maxLength={4000} onChange={(event) => setEditingBody(event.target.value)} /><button aria-label="Salvar edição"><Save size={14} /></button><button type="button" aria-label="Cancelar edição" onClick={() => setEditingId('')}><X size={14} /></button></form> : <p id={`message-${message.id}`}>{message.body}</p>}<div className="message-reactions">{message.reactions.map((reaction) => <button key={reaction.emoji} className={reaction.userIds.includes(user.id) ? 'selected' : ''} onClick={() => socket.emit('chat:reaction', { messageId: message.id, emoji: reaction.emoji })}>{reaction.emoji} <span>{reaction.count}</span></button>)}</div></div><div className="message-actions"><button aria-label="Responder" onClick={() => setReplyingTo(message)}><Reply size={14} /></button>{['👍', '❤️', '😂'].map((emoji) => <button key={emoji} aria-label={`Reagir ${emoji}`} onClick={() => socket.emit('chat:reaction', { messageId: message.id, emoji })}>{emoji}</button>)}{message.authorId === user.id && <button aria-label="Editar mensagem" onClick={() => { setEditingId(message.id); setEditingBody(message.body) }}><Pencil size={14} /></button>}{canDelete && <button aria-label="Excluir mensagem" onClick={() => socket.emit('chat:delete', { messageId: message.id })}><Trash2 size={14} /></button>}</div></article></Fragment>
          })}
        </div>
        <div className="composer-wrap">{replyingTo && <div className="replying-banner"><span>Respondendo a <strong>{replyingTo.author}</strong></span><button onClick={() => setReplyingTo(null)} aria-label="Cancelar resposta"><X size={15} /></button></div>}<form className="composer" onSubmit={sendMessage}><button type="button" aria-label="Adicionar"><Plus size={22} /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={replyingTo ? `Responder a ${replyingTo.author}` : `Conversar em #${channel?.name ?? ''}`} aria-label="Mensagem" disabled={!channel} /><button type="button" aria-label="Presente"><Gift size={19} /></button><button type="button" aria-label="GIF"><FileImage size={19} /></button><button type="button" aria-label="Figurinha"><Sticker size={19} /></button><button type="button" aria-label="Emoji"><Smile size={19} /></button><button type="button" aria-label="Atividades"><Sparkles size={19} /></button><button className="composer__send" type="submit" aria-label="Enviar mensagem"><Send size={18} /></button></form></div></>}
        </>}
      </section>

      {callError && <div className="toast" role="alert">{callError}<button onClick={() => setCallError('')}><X size={16} /></button></div>}
      {settingsOpen && <SettingsPanel user={user} onUserUpdated={onUserUpdated} onClose={() => setSettingsOpen(false)} onLogout={async () => { try { await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }) } finally { socket.disconnect(); onLogout() } }} />}
      {spaceManagementOpen && activeSpace && <SpaceManagement apiUrl={API_URL} space={activeSpace} currentUserId={user.id} onClose={() => setSpaceManagementOpen(false)} onChanged={async () => { await loadSpaces(activeSpace.id); socket.emit('spaces:sync') }} />}
      {accessOpen && <ActionDialog title="Membros e cargos" onClose={() => setAccessOpen(false)}><form className="channel-access-form" onSubmit={saveChannelAccess}><p>Escolha quais membros ou cargos podem acessar <strong>#{channel?.name}</strong>. Proprietários e administradores sempre mantêm acesso.</p>{submitting && !channelAccess ? <div className="access-loading">Carregando acessos…</div> : channelAccess && <><button type="button" className={`access-restriction ${accessRestricted ? 'selected' : ''}`} aria-pressed={accessRestricted} onClick={() => setAccessRestricted((value) => !value)}><Lock size={17} /><span><strong>Canal restrito</strong><small>{accessRestricted ? 'Somente as seleções abaixo podem entrar.' : 'Todos os membros da comunidade podem entrar.'}</small></span><Check size={17} /></button><div className="access-section"><strong>CARGOS</strong>{channelAccess.availableRoles.map((role) => <button type="button" key={role.id} className={accessRoles.includes(role.id) ? 'selected' : ''} aria-pressed={accessRoles.includes(role.id)} onClick={() => setAccessRoles((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id])}><span className={`role-dot role-dot--${role.id}`} />{role.name}<Check size={15} /></button>)}</div><div className="access-section"><strong>MEMBROS</strong>{channelAccess.members.map((member) => <button type="button" key={member.id} className={accessMemberIds.includes(member.id) ? 'selected' : ''} aria-pressed={accessMemberIds.includes(member.id)} onClick={() => setAccessMemberIds((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}><span className="access-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span><span>{member.displayName}<small>{member.email}</small></span><Check size={15} /></button>)}</div></>}{formError && <div className="dialog-error">{formError}</div>}<button className="dialog-primary" disabled={submitting || !channelAccess}>{submitting ? 'Salvando…' : 'Salvar acessos'}</button></form></ActionDialog>}
      {dialog && <ActionDialog title={dialog === 'community' ? 'Criar comunidade' : dialog === 'channel' ? 'Criar canal' : dialog === 'invite' ? 'Convidar pessoas' : 'Entrar com convite'} onClose={() => setDialog(null)}>{dialog === 'community' ? <form onSubmit={createCommunity}><p>Você será o proprietário e poderá convidar outras pessoas depois.</p><label>Nome da comunidade<input autoFocus value={communityName} maxLength={80} onChange={(event) => setCommunityName(event.target.value)} placeholder="ex: Comunidade Voz Livre" required /></label>{formError && <div className="dialog-error">{formError}</div>}<button className="dialog-primary" disabled={submitting}>{submitting ? 'Criando…' : 'Criar comunidade'}</button></form> : dialog === 'channel' ? <form onSubmit={createChannel}><label>Nome do canal<input autoFocus value={channelName} maxLength={50} onChange={(event) => setChannelName(event.target.value)} placeholder="ex: projetos" required /></label><fieldset><legend>Tipo</legend><button type="button" className={channelKind === 'TEXT' ? 'selected' : ''} onClick={() => setChannelKind('TEXT')}><Hash size={18} />Texto</button><button type="button" className={channelKind === 'VOICE' ? 'selected' : ''} onClick={() => setChannelKind('VOICE')}><Volume2 size={18} />Voz</button></fieldset>{formError && <div className="dialog-error">{formError}</div>}<button className="dialog-primary" disabled={submitting}>{submitting ? 'Criando…' : 'Criar canal'}</button></form> : dialog === 'invite' ? <div className="invite-dialog"><p>Este espaço é privado. O link expira em 7 dias.</p>{inviteUrl ? <><label>Link de convite<input readOnly value={inviteUrl} /></label><button className="dialog-primary" onClick={() => void navigator.clipboard.writeText(inviteUrl)}><Copy size={16} /> Copiar convite</button></> : <button className="dialog-primary" disabled={submitting} onClick={() => void createInvite()}>{submitting ? 'Gerando…' : 'Gerar convite'}</button>}{formError && <div className="dialog-error">{formError}</div>}</div> : <form onSubmit={joinInvite}><p>Cole o link ou código enviado pelo administrador.</p><label>Convite<input autoFocus value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Código ou link de convite" required /></label>{formError && <div className="dialog-error">{formError}</div>}<button className="dialog-primary" disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar na comunidade'}</button></form>}</ActionDialog>}
    </main>
  )

  if (!callToken) return shell
  return <LiveKitRoom className="voice-room-root" token={callToken} serverUrl={LIVEKIT_URL} options={LOW_LATENCY_ROOM_OPTIONS} connect audio video={false} onConnected={() => { if (voiceChannelId) socket.emit('voice:join', { channelId: voiceChannelId }) }} onDisconnected={() => leaveCall(voiceChannelId)} data-lk-theme="default">{shell}<RoomAudioRenderer /></LiveKitRoom>
}

function ChannelGroup({ title, channels: items, active, voicePresence = {}, onSelect, onAdd, onInvite, onOpenVoice, onLeaveVoice }: { title: string; channels: Channel[]; active: string; voicePresence?: Record<string, VoiceParticipant[]>; onSelect: (id: string) => void; onAdd: () => void; onInvite?: () => void; onOpenVoice?: () => void; onLeaveVoice?: () => void }) {
  return <section className="channel-group"><div className="channel-group__title"><span>{title}</span><button onClick={onAdd} aria-label={`Adicionar em ${title}`}><Plus size={15} /></button></div>{items.map((item) => {
    const participants = voicePresence[item.id] ?? []
    const connected = item.kind === 'VOICE' && active === item.id
    const expanded = item.kind === 'VOICE' && (connected || participants.length > 0)
    return <div className={`channel-entry ${expanded ? 'channel-entry--expanded' : ''}`} key={item.id}><div className="channel-row"><button className={`channel ${connected || (item.kind === 'TEXT' && active === item.id) ? 'channel--active' : ''}`} onClick={() => onSelect(item.id)}>{item.kind === 'VOICE' ? <Volume2 size={18} /> : <Hash size={18} />}<span>{item.name}</span></button>{item.kind === 'VOICE' && expanded && <div className="channel-actions">{connected && <button onClick={onOpenVoice} aria-label={`Abrir sala ${item.name}`}><Video size={15} /></button>}<button onClick={onInvite} aria-label={`Convidar para ${item.name}`}><UserPlus size={15} /></button>{connected && <button className="channel-action--leave" onClick={onLeaveVoice} aria-label={`Desconectar de ${item.name}`}><PhoneOff size={15} /></button>}</div>}</div>{connected && <div className="voice-channel-status">Conectado ao canal de voz</div>}{expanded && participants.map((participant) => <div className="channel-voice-user" key={participant.userId}><div>{participant.displayName.slice(0, 1).toUpperCase()}</div><span>{participant.displayName}</span><Mic size={12} /></div>)}{expanded && <button className="voice-invite-row" onClick={onInvite}><div><UserPlus size={13} /></div><span>Convidar para voz</span><ChevronRight size={14} /></button>}</div>
  })}</section>
}

function VoiceConnectionDock({ channel, spaceName, onLeave, onOpenStage, onInvite }: { channel: Channel; spaceName: string; onLeave: () => void; onOpenStage: () => void; onInvite: () => void }) {
  return <section className="voice-dock"><header><div className="voice-dock__signal"><Radio size={18} /></div><div className="voice-dock__copy"><strong>Voz conectada</strong><span>{channel.name} / {spaceName}</span></div><AudioLines size={18} className="voice-dock__quality" aria-label="Conexão de voz ativa" /><button className="voice-dock__disconnect" onClick={onLeave} aria-label="Desconectar da voz"><PhoneOff size={17} /></button></header><div className="voice-dock__actions"><TrackToggle source={Track.Source.Camera} aria-label="Ativar câmera" onChange={(enabled) => { if (enabled) onOpenStage() }} /><TrackToggle source={Track.Source.ScreenShare} captureOptions={LOW_LATENCY_SCREEN_CAPTURE} publishOptions={LOW_LATENCY_SCREEN_PUBLISH} aria-label="Compartilhar tela" onChange={(enabled) => { if (enabled) onOpenStage() }} /><button onClick={onOpenStage} aria-label="Abrir sala"><LayoutGrid size={17} /></button><button onClick={onInvite} aria-label="Convidar para voz"><UserPlus size={17} /></button></div></section>
}

function DeafenToggle() {
  const room = useRoomContext()
  const [deafened, setDeafened] = useState(false)

  useEffect(() => {
    const applyVolume = (participant: RemoteParticipant) => {
      const volume = deafened ? 0 : 1
      participant.setVolume(volume, Track.Source.Microphone)
      participant.setVolume(volume, Track.Source.ScreenShareAudio)
    }

    room.remoteParticipants.forEach(applyVolume)
    room.on(RoomEvent.ParticipantConnected, applyVolume)
    return () => {
      room.off(RoomEvent.ParticipantConnected, applyVolume)
      if (deafened) {
        room.remoteParticipants.forEach((participant) => {
          participant.setVolume(1, Track.Source.Microphone)
          participant.setVolume(1, Track.Source.ScreenShareAudio)
        })
      }
    }
  }, [deafened, room])

  return <button className={`profile-deafen-toggle ${deafened ? 'profile-deafen-toggle--active' : ''}`} aria-label={deafened ? 'Ativar áudio' : 'Desativar áudio'} aria-pressed={deafened} onClick={() => setDeafened((current) => !current)}>{deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</button>
}

function ActionDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="action-dialog" role="dialog" aria-modal="true" aria-label={title}><header><div><span>VOZLIVRE</span><h2>{title}</h2></div><button onClick={onClose} aria-label="Fechar"><X size={20} /></button></header>{children}</section></div>
}

function AuthScreen({ initialError = '', onAuthenticated }: { initialError?: string; onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (mode === 'register' && password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    setSubmitting(true)
    try {
      const response = await fetch(`${API_URL}/auth/${mode}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { displayName, email, password } : { email, password }),
      })
      const payload = (await response.json()) as { user?: AuthUser; message?: string | string[] }
      if (!response.ok || !payload.user) {
        const message = Array.isArray(payload.message) ? payload.message[0] : payload.message
        throw new Error(message ?? 'Não foi possível continuar.')
      }
      onAuthenticated(payload.user)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível continuar.')
    } finally { setSubmitting(false) }
  }

  const switchMode = () => {
    setMode((current) => current === 'login' ? 'register' : 'login')
    setError('')
    setPassword('')
    setConfirmPassword('')
  }

  return <main className="auth-page">
    <section className="auth-story"><div className="auth-brand"><div className="auth-mark"><img src="/app-icon-192.png" alt="" /></div><strong>VozLivre</strong></div><div className="auth-story__copy"><span>CONVERSE SEM DISTÂNCIA</span><h1>Seu grupo inteiro,<br />na mesma frequência.</h1><p>Canais, mensagens e chamadas em um espaço criado para permanecer próximo.</p></div><div className="signal-orbit"><i /><i /><i /><div><Mic size={28} /></div></div></section>
    <section className="auth-panel"><form className="auth-card" onSubmit={submit}>
      <div className="auth-brand auth-brand--mobile"><div className="auth-mark"><img src="/app-icon-192.png" alt="" /></div><strong>VozLivre</strong></div>
      <header><span>{mode === 'login' ? 'BEM-VINDO DE VOLTA' : 'CRIE SEU ESPAÇO'}</span><h2>{mode === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}</h2><p>{mode === 'login' ? 'Suas conversas estão esperando por você.' : 'Leva menos de um minuto para começar.'}</p></header>
      {mode === 'register' && <label className="auth-field"><span>Nome de exibição</span><div><Users size={17} /><input autoComplete="name" required maxLength={50} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Como as pessoas verão você" /></div></label>}
      <label className="auth-field"><span>E-mail</span><div><Mail size={17} /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" /></div></label>
      <label className="auth-field"><span>Senha</span><div><Lock size={17} /><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" /></div></label>
      {mode === 'register' && <label className="auth-field"><span>Confirmar senha</span><div><KeyRound size={17} /><input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Digite a senha novamente" /></div></label>}
      {mode === 'login' && <button type="button" className="forgot-button">Esqueceu sua senha?</button>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="auth-submit" disabled={submitting}>{submitting ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}<span>→</span></button>
      <div className="auth-switch">{mode === 'login' ? 'Ainda não tem uma conta?' : 'Já possui uma conta?'} <button type="button" onClick={switchMode}>{mode === 'login' ? 'Cadastre-se' : 'Entrar'}</button></div>
      <footer><Shield size={14} /> Sua senha é armazenada com hash e a sessão usa cookie protegido.</footer>
    </form></section>
  </main>
}

const settingSections = [
  { id: 'account', label: 'Minha conta', icon: Users },
  { id: 'profile', label: 'Perfis', icon: SlidersHorizontal },
  { id: 'privacy', label: 'Privacidade e segurança', icon: Shield },
  { id: 'voice', label: 'Voz e vídeo', icon: Mic },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'appearance', label: 'Aparência', icon: Palette },
]

function SettingsPanel({ user, onClose, onLogout, onUserUpdated }: { user: AuthUser; onClose: () => void; onLogout: () => void; onUserUpdated: (user: AuthUser) => void }) {
  const [section, setSection] = useState('account')
  const [editingProfile, setEditingProfile] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accountError, setAccountError] = useState('')
  const [accountSuccess, setAccountSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setAccountError(''); setAccountSuccess('')
    try { const response = await fetch(`${API_URL}/auth/profile`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) }); const payload = await response.json() as { user?: AuthUser; message?: string }; if (!response.ok || !payload.user) throw new Error(payload.message ?? 'Não foi possível atualizar o perfil.'); onUserUpdated(payload.user); setEditingProfile(false); setAccountSuccess('Perfil atualizado.') } catch (error) { setAccountError(error instanceof Error ? error.message : 'Não foi possível atualizar o perfil.') } finally { setSaving(false) }
  }
  const savePassword = async (event: FormEvent) => {
    event.preventDefault(); setAccountError(''); setAccountSuccess(''); if (newPassword !== confirmPassword) { setAccountError('A confirmação da nova senha não confere.'); return } setSaving(true)
    try { const response = await fetch(`${API_URL}/auth/password`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) }); const payload = await response.json() as { message?: string }; if (!response.ok) throw new Error(payload.message ?? 'Não foi possível alterar a senha.'); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setChangingPassword(false); setAccountSuccess('Senha alterada com segurança.') } catch (error) { setAccountError(error instanceof Error ? error.message : 'Não foi possível alterar a senha.') } finally { setSaving(false) }
  }
  return <div className="settings-layer">
    <aside className="settings-nav"><strong>CONFIGURAÇÕES DO USUÁRIO</strong>{settingSections.map((item) => { const Icon = item.icon; return <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><Icon size={17} />{item.label}</button> })}<div /><button className="logout-option" onClick={onLogout}><LogOut size={17} />Sair</button></aside>
    <section className="settings-content"><button className="settings-close" onClick={onClose}><X size={21} /><span>ESC</span></button>
      {section === 'account' ? <><h2>Minha conta</h2><div className="account-banner"><div className="avatar account-avatar">{user.displayName[0].toUpperCase()}</div><strong>{user.displayName}</strong><button onClick={() => setEditingProfile(true)}>Editar perfil</button></div><div className="account-details"><div><span>NOME DE EXIBIÇÃO</span><strong>{user.displayName}</strong><button onClick={() => setEditingProfile(true)}>Editar</button></div><div><span>E-MAIL</span><strong>{user.email}</strong><small>O e-mail identifica sua conta e ainda não pode ser alterado.</small></div></div>{editingProfile && <form className="account-form" onSubmit={saveProfile}><label>Nome de exibição<input autoFocus value={displayName} maxLength={50} onChange={(event) => setDisplayName(event.target.value)} /></label><div><button type="button" onClick={() => setEditingProfile(false)}>Cancelar</button><button disabled={saving}><Save size={14} /> Salvar perfil</button></div></form>}<h3>Senha e autenticação</h3>{!changingPassword ? <button className="primary-option" onClick={() => setChangingPassword(true)}><KeyRound size={16} /> Alterar senha</button> : <form className="account-form" onSubmit={savePassword}><label>Senha atual<input type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>Nova senha<input type="password" required minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>Confirmar nova senha<input type="password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><div><button type="button" onClick={() => setChangingPassword(false)}>Cancelar</button><button disabled={saving}><KeyRound size={14} /> Alterar senha</button></div></form>}{accountError && <div className="dialog-error">{accountError}</div>}{accountSuccess && <div className="account-success">{accountSuccess}</div>}<div className="security-note"><Shield size={19} /><div><strong>Sessão protegida</strong><p>O login usa um cookie HttpOnly que não pode ser lido por scripts no navegador.</p></div><Check size={18} /></div></> : <><h2>{settingSections.find((item) => item.id === section)?.label}</h2><div className="settings-placeholder"><SlidersHorizontal size={28} /><h3>Controles de {settingSections.find((item) => item.id === section)?.label.toLowerCase()}</h3><p>Esta área ainda será ligada às configurações persistentes.</p></div></>}
    </section>
  </div>
}

function Avatar({ name, index }: { name: string; index: number }) { const palette = ['#4967ff', '#ff735f', '#31b98d', '#927dff']; return <div className="avatar message__avatar" style={{ background: palette[index % palette.length] }}>{name.slice(0, 1).toUpperCase()}</div> }

function messageDay(value: string) { const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` }
function formatMessageDate(value: string) { return new Date(value).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) }
function formatMessageTime(value: string) { return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }
function isCompactMessage(previous: Message | undefined, current: Message) { return Boolean(previous && !current.replyTo && previous.author === current.author && messageDay(previous.createdAt) === messageDay(current.createdAt) && new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000) }
export default App
