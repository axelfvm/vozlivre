import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import {
  AudioLines,
  AtSign,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File,
  Hash,
  HeadphoneOff,
  Headphones,
  KeyRound,
  LayoutGrid,
  Link2,
  Lock,
  LogOut,
  Mail,
  Mic,
  MonitorUp,
  Palette,
  Paperclip,
  Pencil,
  PhoneOff,
  Pin,
  Plus,
  Radio,
  Reply,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  SlidersHorizontal,
  Smile,
  Sticker,
  Trash2,
  UserPlus,
  Users,
  Video,
  Volume2,
  X,
} from "lucide-react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  TrackToggle,
  VideoConference,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import {
  LocalAudioTrack,
  RoomEvent,
  ScreenSharePresets,
  Track,
} from "livekit-client";
import type {
  RemoteParticipant,
  RoomOptions,
  ScreenShareCaptureOptions,
  TrackPublishOptions,
} from "livekit-client";
import { io } from "socket.io-client";
import "./App.css";
import "./Collaboration.css";
import { SpaceManagement } from "./SpaceManagement";
import { RichMessage } from "./RichMessage";
import {
  SocialHome,
  type DirectSpace,
  type SocialOverview,
} from "./SocialHome";
import { TwoFactorSettings } from "./TwoFactorSettings";
import { GroupManagement } from "./GroupManagement";

type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
};
type Message = {
  id: string;
  channelId: string;
  authorId: string;
  author: string;
  authorAvatarUrl: string | null;
  body: string;
  pinnedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  replyTo: { id: string; author: string; body: string } | null;
  reactions: { emoji: string; count: number; userIds: string[] }[];
  attachments: Attachment[];
  mentions: { kind: "USER" | "ROLE" | "EVERYONE"; targetId: string }[];
  sticker: { id: string; name: string; url: string } | null;
  thread: {
    id: string;
    title: string;
    archivedAt: string | null;
    messageCount: number;
  } | null;
};
type HistoryPage = { messages: Message[]; hasMore: boolean };
type Channel = {
  id: string;
  name: string;
  topic: string;
  kind: "TEXT" | "VOICE";
  position: number;
  unreadCount: number;
  categoryId?: string | null;
  parentChannelId?: string | null;
  starterMessageId?: string | null;
  archivedAt?: string | null;
};
type SpaceCategory = { id: string; name: string; position: number };
type Space = {
  id: string;
  name: string;
  role: string;
  permissions: string[];
  channels: Channel[];
  kind: "COMMUNITY" | "DIRECT" | "GROUP";
  iconUrl: string | null;
  description: string;
  categories: SpaceCategory[];
  members: CommunityMember[];
};
type UserSettings = {
  theme: "dark" | "midnight" | "light";
  compactMode: boolean;
  reducedMotion: boolean;
  desktopNotifications: boolean;
  notificationSound: boolean;
  mentionNotifications: boolean;
  inputDeviceId: string;
  outputDeviceId: string;
  cameraDeviceId: string;
  inputVolume: number;
  outputVolume: number;
  screenQuality: "720p" | "1080p";
};
type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  status: string;
  settings: UserSettings;
  twoFactorEnabled: boolean;
};
type VoiceParticipant = { userId: string; displayName: string };
type VoicePresenceUpdate = {
  channelId: string;
  participants: VoiceParticipant[];
};
type ChannelAccessMember = {
  id: string;
  displayName: string;
  email: string;
  role: string;
};
type ChannelAccessRole = { id: string; name: string };
type ChannelAccess = {
  restricted: boolean;
  memberIds: string[];
  roles: string[];
  members: ChannelAccessMember[];
  availableRoles: ChannelAccessRole[];
};
type CommunityMember = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  role: string;
  roles: { id: string; name: string; color: string }[];
};
const API_URL = (
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://localhost:3000" : window.location.origin)
).replace(/\/$/, "");
const LIVEKIT_URL =
  import.meta.env.VITE_LIVEKIT_URL ??
  (import.meta.env.DEV ? "ws://localhost:7880" : "");
const socket = io(API_URL, {
  autoConnect: false,
  transports: ["websocket"],
  withCredentials: true,
});
const LOW_LATENCY_ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    videoCodec: "vp8",
    backupCodec: false,
    degradationPreference: "maintain-framerate",
    screenShareEncoding: {
      ...ScreenSharePresets.h1080fps30.encoding,
      priority: "high",
    },
    // Screen sharing previously encoded 1080p and 540p at the same time.
    // Keep camera simulcast, but publish a single screen layer in small rooms.
    screenShareSimulcastLayers: [],
  },
};
const LOW_LATENCY_SCREEN_CAPTURE: ScreenShareCaptureOptions = {
  audio: true,
  contentHint: "motion",
  resolution: ScreenSharePresets.h1080fps30.resolution,
  selfBrowserSurface: "exclude",
  surfaceSwitching: "include",
  systemAudio: "include",
};
const LOW_LATENCY_SCREEN_PUBLISH: TrackPublishOptions = {
  videoCodec: "vp8",
  backupCodec: false,
  degradationPreference: "maintain-framerate",
  screenShareEncoding: {
    ...ScreenSharePresets.h1080fps30.encoding,
    priority: "high",
  },
  simulcast: false,
};

let notificationAudioContext: AudioContext | null = null;

function playNotificationSound() {
  try {
    notificationAudioContext ??= new AudioContext();
    const context = notificationAudioContext;
    void context.resume().then(() => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(520, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        760,
        context.currentTime + 0.11,
      );
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.17);
    });
  } catch {
    // Browsers may block audio until the first user gesture.
  }
}

function mediaUrl(value: string) {
  return value.startsWith("http") ? value : `${API_URL}${value}`;
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionNotice, setSessionNotice] = useState("");
  const handleLogout = useCallback((message = "") => {
    setSessionNotice(message);
    setUser(null);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return null;
        return ((await response.json()) as { user: AuthUser }).user;
      })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    document.documentElement.dataset.theme = user.settings.theme;
    document.documentElement.classList.toggle(
      "compact-mode",
      user.settings.compactMode,
    );
    document.documentElement.classList.toggle(
      "reduced-motion",
      user.settings.reducedMotion,
    );
  }, [user]);

  if (loading)
    return (
      <div className="auth-loading">
        <div className="auth-mark">
          <img src="/app-icon-192.png" alt="" />
        </div>
        <span>Carregando seu espaço…</span>
      </div>
    );
  if (!user)
    return (
      <AuthScreen
        initialError={sessionNotice}
        onAuthenticated={(authenticatedUser) => {
          setSessionNotice("");
          setUser(authenticatedUser);
        }}
      />
    );

  return (
    <ChatApp user={user} onLogout={handleLogout} onUserUpdated={setUser} />
  );
}

function ChatApp({
  user,
  onLogout,
  onUserUpdated,
}: {
  user: AuthUser;
  onLogout: (message?: string) => void;
  onUserUpdated: (user: AuthUser) => void;
}) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [homeOpen, setHomeOpen] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [activeChannelId, setActiveChannelId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const olderScrollHeightRef = useRef<number | null>(null);
  const [draft, setDraft] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [callToken, setCallToken] = useState<string | null>(null);
  const [callCanShareScreen, setCallCanShareScreen] = useState(false);
  const [voiceChannelId, setVoiceChannelId] = useState("");
  const [voicePresence, setVoicePresence] = useState<
    Record<string, VoiceParticipant[]>
  >({});
  const [showVoiceStage, setShowVoiceStage] = useState(false);
  const [callError, setCallError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [spaceManagementOpen, setSpaceManagementOpen] = useState(false);
  const [groupManagementOpen, setGroupManagementOpen] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [dialog, setDialog] = useState<
    "community" | "channel" | "invite" | "join" | null
  >(null);
  const [communityName, setCommunityName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelKind, setChannelKind] = useState<"TEXT" | "VOICE">("TEXT");
  const [channelCategoryId, setChannelCategoryId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteDays, setInviteDays] = useState(7);
  const [inviteMaxUses, setInviteMaxUses] = useState(0);
  const [joinCode, setJoinCode] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [channelAccess, setChannelAccess] = useState<ChannelAccess | null>(
    null,
  );
  const [accessMemberIds, setAccessMemberIds] = useState<string[]>([]);
  const [accessRoles, setAccessRoles] = useState<string[]>([]);
  const [accessRestricted, setAccessRestricted] = useState(false);
  const [inspector, setInspector] = useState<
    "search" | "pins" | "members" | null
  >(null);
  const [inspectorItems, setInspectorItems] = useState<
    Message[] | CommunityMember[]
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(
    [],
  );
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [stickers, setStickers] = useState<
    { id: string; name: string; url: string }[]
  >([]);
  const [mentionLabels, setMentionLabels] = useState<Record<string, string>>(
    {},
  );
  const [mentionItems, setMentionItems] = useState<
    { id: string; name: string; kind: "user" | "role" | "everyone" }[]
  >([]);
  const [threadChannel, setThreadChannel] = useState<Channel | null>(null);
  const [threadList, setThreadList] = useState<
    {
      id: string;
      topic: string;
      archivedAt: string | null;
      _count: { messages: number };
    }[]
  >([]);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [threadSource, setThreadSource] = useState<Message | null>(null);
  const [threadTitle, setThreadTitle] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeChannelRef = useRef(activeChannelId);

  const activeSpace = useMemo(
    () => spaces.find((space) => space.id === activeSpaceId) ?? spaces[0],
    [activeSpaceId, spaces],
  );
  const channel = useMemo(
    () =>
      threadChannel?.id === activeChannelId
        ? threadChannel
        : activeSpace?.channels.find((item) => item.id === activeChannelId),
    [activeChannelId, activeSpace, threadChannel],
  );
  const voiceChannel = useMemo(
    () =>
      spaces
        .flatMap((space) => space.channels)
        .find((item) => item.id === voiceChannelId),
    [spaces, voiceChannelId],
  );
  const roomOptions = useMemo<RoomOptions>(
    () => ({
      ...LOW_LATENCY_ROOM_OPTIONS,
      audioCaptureDefaults: user.settings.inputDeviceId
        ? { deviceId: user.settings.inputDeviceId }
        : undefined,
      videoCaptureDefaults: user.settings.cameraDeviceId
        ? { deviceId: user.settings.cameraDeviceId }
        : undefined,
    }),
    [user.settings.inputDeviceId, user.settings.cameraDeviceId],
  );
  const screenPreset =
    user.settings.screenQuality === "720p"
      ? ScreenSharePresets.h720fps30
      : ScreenSharePresets.h1080fps30;
  const screenCaptureOptions = useMemo<ScreenShareCaptureOptions>(
    () => ({
      ...LOW_LATENCY_SCREEN_CAPTURE,
      resolution: screenPreset.resolution,
    }),
    [screenPreset],
  );
  const screenPublishOptions = useMemo<TrackPublishOptions>(
    () => ({
      ...LOW_LATENCY_SCREEN_PUBLISH,
      screenShareEncoding: { ...screenPreset.encoding, priority: "high" },
    }),
    [screenPreset],
  );

  useEffect(() => {
    activeChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  const loadSpaces = useCallback(async (preferredSpaceId?: string) => {
    const [spacesResponse, socialResponse] = await Promise.all([
      fetch(`${API_URL}/spaces`, { credentials: "include" }),
      fetch(`${API_URL}/social`, { credentials: "include" }),
    ]);
    if (!spacesResponse.ok || !socialResponse.ok)
      throw new Error("Não foi possível carregar seus espaços.");
    const communities = (await spacesResponse.json()) as Space[];
    const social = (await socialResponse.json()) as SocialOverview;
    const data = [...communities, ...(social.directs as unknown as Space[])];
    setSpaces(data);
    const nextSpace =
      data.find((space) => space.id === preferredSpaceId) ?? data[0];
    if (!nextSpace) {
      setActiveSpaceId("");
      setActiveChannelId("");
      return;
    }
    setActiveSpaceId(nextSpace.id);
    setActiveChannelId((current) =>
      nextSpace.channels.some(
        (item) => item.id === current && item.kind === "TEXT",
      )
        ? current
        : (nextSpace.channels.find((item) => item.kind === "TEXT")?.id ?? ""),
    );
  }, []);

  useEffect(() => {
    // The initial spaces are remote state and must be loaded after mount.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadSpaces().catch((error) =>
        setCallError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os espaços.",
        ),
      );
  }, [loadSpaces]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (!code) return;
    fetch(`${API_URL}/invites/${encodeURIComponent(code)}/join`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            ((await response.json()) as { message?: string }).message ??
              "Convite inválido.",
          );
        return response.json() as Promise<{ id: string }>;
      })
      .then(async (joined) => {
        window.history.replaceState({}, "", window.location.pathname);
        await loadSpaces(joined.id);
      })
      .catch((error) =>
        setCallError(
          error instanceof Error ? error.message : "Convite inválido.",
        ),
      );
  }, [loadSpaces]);

  useEffect(() => {
    const handleHistory = (history: HistoryPage) => {
      setMessages(history.messages);
      setHasMoreMessages(history.hasMore);
    };
    const handleMoreHistory = (history: HistoryPage) => {
      const list = messagesRef.current;
      const previousHeight = olderScrollHeightRef.current;
      setMessages((current) => [...history.messages, ...current]);
      setHasMoreMessages(history.hasMore);
      requestAnimationFrame(() => {
        if (list && previousHeight !== null)
          list.scrollTop += list.scrollHeight - previousHeight;
        olderScrollHeightRef.current = null;
      });
    };
    const handleMessage = (message: Message) => {
      const mentioned = message.mentions.some(
        (mention) =>
          mention.kind === "EVERYONE" ||
          (mention.kind === "USER" && mention.targetId === user.id),
      );
      if (
        message.authorId !== user.id &&
        user.settings.notificationSound &&
        (!user.settings.mentionNotifications || mentioned)
      )
        playNotificationSound();
      if (message.channelId === activeChannelRef.current) {
        setMessages((current) =>
          current.some((item) => item.id === message.id)
            ? current
            : [...current, message],
        );
        void fetch(`${API_URL}/channels/${message.channelId}/read`, {
          method: "POST",
          credentials: "include",
        });
      } else {
        setSpaces((current) =>
          current.map((space) => ({
            ...space,
            channels: space.channels.map((item) =>
              item.id === message.channelId
                ? { ...item, unreadCount: (item.unreadCount ?? 0) + 1 }
                : item,
            ),
          })),
        );
        if (
          user.settings.desktopNotifications &&
          (!user.settings.mentionNotifications || mentioned) &&
          document.hidden &&
          "Notification" in window &&
          Notification.permission === "granted"
        )
          new Notification(`${message.author} no VozLivre`, {
            body: message.body || "Enviou um anexo.",
            icon: "/app-icon-192.png",
          });
      }
    };
    const handleMessageUpdate = (message: Message) =>
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? message : item)),
      );
    const handleMessageDelete = ({ id }: { id: string }) =>
      setMessages((current) => current.filter((item) => item.id !== id));
    const handleChatError = (payload: { message?: string }) =>
      setCallError(payload.message ?? "Não foi possível acessar o canal.");
    const handleVoiceError = (payload: { message?: string }) =>
      setCallError(
        payload.message ?? "Não foi possível atualizar a presença de voz.",
      );
    const handleVoiceSnapshot = (snapshot: VoicePresenceUpdate[]) =>
      setVoicePresence(
        Object.fromEntries(
          snapshot.map((entry) => [entry.channelId, entry.participants]),
        ),
      );
    const handleVoicePresence = (update: VoicePresenceUpdate) =>
      setVoicePresence((current) => ({
        ...current,
        [update.channelId]: update.participants,
      }));
    const handleConnect = () => socket.emit("spaces:sync");
    const handleConnectError = (error: Error) => {
      if (/sessão inválida/i.test(error.message)) {
        onLogout("Sua sessão não é mais válida.");
        return;
      }
      setCallError("Não foi possível conectar ao serviço em tempo real.");
    };
    const handleSpacesChanged = () => {
      void loadSpaces(activeSpaceId).finally(() => socket.emit("spaces:sync"));
    };
    const handleTyping = (payload: {
      channelId: string;
      userId: string;
      displayName: string;
      typing: boolean;
    }) => {
      if (payload.channelId !== activeChannelRef.current) return;
      setTypingUsers((current) => {
        const next = { ...current };
        if (payload.typing) next[payload.userId] = payload.displayName;
        else delete next[payload.userId];
        return next;
      });
    };
    const handleAuthError = (payload: { message?: string }) => {
      setCallToken(null);
      onLogout(payload.message ?? "Sua sessão não é mais válida.");
    };
    socket.on("chat:history", handleHistory);
    socket.on("chat:message", handleMessage);
    socket.on("chat:history:more", handleMoreHistory);
    socket.on("chat:message:update", handleMessageUpdate);
    socket.on("chat:message:delete", handleMessageDelete);
    socket.on("auth:error", handleAuthError);
    socket.on("chat:error", handleChatError);
    socket.on("voice:error", handleVoiceError);
    socket.on("voice:presence:snapshot", handleVoiceSnapshot);
    socket.on("voice:presence", handleVoicePresence);
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.on("spaces:changed", handleSpacesChanged);
    socket.on("chat:typing", handleTyping);
    socket.connect();
    return () => {
      socket.off("chat:history", handleHistory);
      socket.off("chat:history:more", handleMoreHistory);
      socket.off("chat:message", handleMessage);
      socket.off("chat:message:update", handleMessageUpdate);
      socket.off("chat:message:delete", handleMessageDelete);
      socket.off("auth:error", handleAuthError);
      socket.off("chat:error", handleChatError);
      socket.off("voice:error", handleVoiceError);
      socket.off("voice:presence:snapshot", handleVoiceSnapshot);
      socket.off("voice:presence", handleVoicePresence);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.off("spaces:changed", handleSpacesChanged);
      socket.off("chat:typing", handleTyping);
      socket.disconnect();
    };
  }, [
    activeSpaceId,
    loadSpaces,
    onLogout,
    user.id,
    user.settings.desktopNotifications,
    user.settings.mentionNotifications,
    user.settings.notificationSound,
  ]);

  useEffect(() => {
    if (socket.connected) socket.emit("spaces:sync");
  }, [spaces]);

  useEffect(() => {
    if (channel?.kind === "TEXT") {
      socket.emit("chat:join", { channelId: channel.id });
      // Synchronizes the local unread badge with the read state written by chat:join.
      // oxlint-disable-next-line react/set-state-in-effect
      setSpaces((current) =>
        current.map((space) => ({
          ...space,
          channels: space.channels.map((item) =>
            item.id === channel.id && item.unreadCount
              ? { ...item, unreadCount: 0 }
              : item,
          ),
        })),
      );
      setTypingUsers({});
    }
  }, [channel?.id, channel?.kind]);

  useEffect(() => {
    if (!channel || channel.kind !== "TEXT" || !activeSpace) {
      // Clear channel-specific choices whenever no text channel is selected.
      // oxlint-disable-next-line react/set-state-in-effect
      setStickers([]);
      setMentionItems([]);
      setMentionLabels({});
      return;
    }
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_URL}/spaces/${activeSpace.id}/stickers`, {
        credentials: "include",
        signal: controller.signal,
      }),
      fetch(`${API_URL}/channels/${channel.id}/mentions`, {
        credentials: "include",
        signal: controller.signal,
      }),
    ])
      .then(async ([stickersResponse, mentionsResponse]) => {
        const stickerPayload = stickersResponse.ok
          ? ((await stickersResponse.json()) as {
              id: string;
              name: string;
              url: string;
            }[])
          : [];
        const mentionPayload = mentionsResponse.ok
          ? ((await mentionsResponse.json()) as {
              members: CommunityMember[];
              roles: { id: string; name: string }[];
              canMentionEveryone: boolean;
            })
          : { members: [], roles: [], canMentionEveryone: false };
        setStickers(stickerPayload);
        setMentionItems([
          ...mentionPayload.members.map((member) => ({
            id: member.id,
            name: member.displayName,
            kind: "user" as const,
          })),
          ...mentionPayload.roles.map((role) => ({
            id: role.id,
            name: role.name,
            kind: "role" as const,
          })),
          ...(mentionPayload.canMentionEveryone
            ? [{ id: "everyone", name: "everyone", kind: "everyone" as const }]
            : []),
        ]);
        setMentionLabels(
          Object.fromEntries([
            ...mentionPayload.members.map((member) => [
              `user:${member.id}`,
              member.displayName,
            ]),
            ...mentionPayload.roles.map((role) => [
              `role:${role.id}`,
              role.name,
            ]),
          ]),
        );
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setStickers([]);
          setMentionItems([]);
        }
      });
    return () => controller.abort();
  }, [activeSpace, channel]);
  useEffect(() => {
    const list = messagesRef.current;
    if (list && olderScrollHeightRef.current === null)
      list.scrollTop = list.scrollHeight;
  }, [activeChannelId, messages]);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() && !pendingAttachments.length) return;
    if (!channel || channel.kind !== "TEXT") return;
    socket.emit("chat:send", {
      channelId: channel.id,
      body: draft,
      replyToId: replyingTo?.id,
      attachmentIds: pendingAttachments.map((item) => item.id),
    });
    socket.emit("chat:typing", { channelId: channel.id, typing: false });
    setDraft("");
    setReplyingTo(null);
    setPendingAttachments([]);
    setEmojiOpen(false);
    setMentionOpen(false);
    setStickerOpen(false);
  };

  const sendSticker = (stickerId: string) => {
    if (!channel || channel.kind !== "TEXT") return;
    socket.emit("chat:send", { channelId: channel.id, body: "", stickerId });
    setStickerOpen(false);
  };

  const addMention = (item: {
    id: string;
    name: string;
    kind: "user" | "role" | "everyone";
  }) => {
    const token =
      item.kind === "everyone"
        ? "@everyone"
        : item.kind === "role"
          ? `<@&${item.id}>`
          : `<@${item.id}>`;
    changeDraft(`${draft}${draft && !draft.endsWith(" ") ? " " : ""}${token} `);
    setMentionOpen(false);
  };

  const cancelPendingAttachment = async (attachmentId: string) => {
    setPendingAttachments((current) =>
      current.filter((entry) => entry.id !== attachmentId),
    );
    await fetch(`${API_URL}/attachments/${attachmentId}`, {
      method: "DELETE",
      credentials: "include",
    });
  };

  const loadThreads = useCallback(async (channelId: string) => {
    const response = await fetch(`${API_URL}/channels/${channelId}/threads`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Não foi possível carregar as threads.");
    setThreadList(await response.json());
  }, []);

  const openThread = async (thread: {
    id: string;
    topic: string;
    archivedAt: string | null;
  }) => {
    if (!activeSpace) return;
    setThreadChannel({
      id: thread.id,
      name: thread.topic,
      topic: `Thread em ${activeSpace.name}`,
      kind: "TEXT",
      position: 0,
      unreadCount: 0,
      parentChannelId: channel?.parentChannelId ?? channel?.id ?? null,
      archivedAt: thread.archivedAt,
    });
    setActiveChannelId(thread.id);
    setMessages([]);
    setThreadsOpen(false);
  };

  const createThread = async (event: FormEvent) => {
    event.preventDefault();
    if (!threadSource || !threadTitle.trim()) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch(`${API_URL}/messages/${threadSource.id}/thread`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: threadTitle }),
      });
      const payload = (await response.json()) as {
        id?: string;
        topic?: string;
        archivedAt?: string | null;
        message?: string;
      };
      if (!response.ok || !payload.id)
        throw new Error(payload.message ?? "Não foi possível criar a thread.");
      setThreadSource(null);
      setThreadTitle("");
      await openThread({
        id: payload.id,
        topic: payload.topic ?? "Thread",
        archivedAt: payload.archivedAt ?? null,
      });
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : "Não foi possível criar a thread.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleThreadArchived = async () => {
    if (!threadChannel) return;
    const response = await fetch(`${API_URL}/threads/${threadChannel.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !threadChannel.archivedAt }),
    });
    const payload = (await response.json()) as {
      archivedAt?: string | null;
      message?: string;
    };
    if (!response.ok)
      throw new Error(payload.message ?? "Não foi possível atualizar a thread.");
    setThreadChannel((current) =>
      current ? { ...current, archivedAt: payload.archivedAt ?? null } : current,
    );
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    if (channel?.kind === "TEXT")
      socket.emit("chat:typing", {
        channelId: channel.id,
        typing: Boolean(value.trim()),
      });
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!channel || !files?.length) return;
    setUploading(true);
    setCallError("");
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files).slice(
        0,
        10 - pendingAttachments.length,
      )) {
        const data = new FormData();
        data.append("file", file);
        const response = await fetch(
          `${API_URL}/channels/${channel.id}/attachments`,
          { method: "POST", credentials: "include", body: data },
        );
        const payload = (await response.json()) as Attachment & {
          message?: string;
        };
        if (!response.ok)
          throw new Error(
            payload.message ?? `Não foi possível enviar ${file.name}.`,
          );
        uploaded.push(payload);
      }
      setPendingAttachments((current) => [...current, ...uploaded]);
    } catch (error) {
      setCallError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o arquivo.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openInspector = async (
    kind: "search" | "pins" | "members",
    query = "",
  ) => {
    if (!activeSpace || !channel) return;
    setInspector(kind);
    setInspectorLoading(true);
    setInspectorItems([]);
    try {
      const path =
        kind === "members"
          ? `/spaces/${activeSpace.id}/members`
          : kind === "pins"
            ? `/channels/${channel.id}/pins`
            : `/channels/${channel.id}/messages/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(`${API_URL}${path}`, {
        credentials: "include",
      });
      const payload = (await response.json()) as
        Message[] | CommunityMember[] | { message?: string };
      if (!response.ok)
        throw new Error(
          "message" in payload ? payload.message : "Não foi possível carregar.",
        );
      setInspectorItems(payload as Message[] | CommunityMember[]);
    } catch (error) {
      setCallError(
        error instanceof Error ? error.message : "Não foi possível carregar.",
      );
    } finally {
      setInspectorLoading(false);
    }
  };

  const togglePin = async (message: Message) => {
    const response = await fetch(`${API_URL}/messages/${message.id}/pin`, {
      method: message.pinnedAt ? "DELETE" : "POST",
      credentials: "include",
    });
    const payload = (await response.json()) as Message & { message?: string };
    if (!response.ok) {
      setCallError(
        payload.message ?? "Não foi possível alterar a mensagem fixada.",
      );
      return;
    }
    setMessages((current) =>
      current.map((item) => (item.id === payload.id ? payload : item)),
    );
    if (inspector === "pins" && message.pinnedAt)
      setInspectorItems((current) =>
        (current as Message[]).filter((item) => item.id !== message.id),
      );
  };

  const saveMessageEdit = (event: FormEvent, messageId: string) => {
    event.preventDefault();
    if (!editingBody.trim()) return;
    socket.emit("chat:edit", { messageId, body: editingBody });
    setEditingId("");
    setEditingBody("");
  };

  const joinCall = async (channelId: string) => {
    setCallError("");
    try {
      if (!LIVEKIT_URL)
        throw new Error(
          "O servidor de chamadas não foi configurado neste ambiente.",
        );
      const response = await fetch(`${API_URL}/voice/token`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      if (!response.ok) throw new Error("A API de chamadas não respondeu.");
      const data = (await response.json()) as {
        token: string;
        canShareScreen: boolean;
      };
      if (voiceChannelId && voiceChannelId !== channelId)
        socket.emit("voice:leave", { channelId: voiceChannelId });
      setCallToken(data.token);
      setCallCanShareScreen(data.canShareScreen);
      setVoiceChannelId(channelId);
      setShowVoiceStage(false);
    } catch (error) {
      setCallError(
        error instanceof Error
          ? error.message
          : "Não foi possível entrar na sala.",
      );
    }
  };

  const leaveCall = (channelId = voiceChannelId) => {
    if (channelId) socket.emit("voice:leave", { channelId });
    if (!channelId || channelId === voiceChannelId) {
      setCallToken(null);
      setCallCanShareScreen(false);
      setVoiceChannelId("");
      setShowVoiceStage(false);
    }
  };

  const openDialog = (next: "community" | "channel" | "invite" | "join") => {
    setWorkspaceMenu(false);
    setDialog(next);
    setFormError("");
    setInviteUrl("");
  };

  const openChannelAccess = async () => {
    if (!activeSpace || !channel) return;
    setAccessOpen(true);
    setFormError("");
    setSubmitting(true);
    setChannelAccess(null);
    try {
      const response = await fetch(
        `${API_URL}/spaces/${activeSpace.id}/channels/${channel.id}/access`,
        { credentials: "include" },
      );
      const payload = (await response.json()) as ChannelAccess & {
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.message ?? "Não foi possível carregar os acessos do canal.",
        );
      setChannelAccess(payload);
      setAccessMemberIds(payload.memberIds);
      setAccessRoles(payload.roles);
      setAccessRestricted(payload.restricted);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os acessos do canal.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const saveChannelAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeSpace || !channel) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch(
        `${API_URL}/spaces/${activeSpace.id}/channels/${channel.id}/access`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            restricted: accessRestricted,
            memberIds: accessMemberIds,
            roles: accessRoles,
          }),
        },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(
          payload.message ?? "Não foi possível salvar os acessos do canal.",
        );
      await loadSpaces(activeSpace.id);
      socket.emit("spaces:sync");
      setAccessOpen(false);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar os acessos do canal.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const createCommunity = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch(`${API_URL}/spaces`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: communityName }),
      });
      const payload = (await response.json()) as Space & { message?: string };
      if (!response.ok || !payload.id)
        throw new Error(
          payload.message ?? "Não foi possível criar a comunidade.",
        );
      await loadSpaces(payload.id);
      setDialog(null);
      setCommunityName("");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível criar a comunidade.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const createChannel = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeSpace) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch(
        `${API_URL}/spaces/${activeSpace.id}/channels`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: channelName,
            kind: channelKind,
            ...(channelCategoryId ? { categoryId: channelCategoryId } : {}),
          }),
        },
      );
      const payload = (await response.json()) as Channel & { message?: string };
      if (!response.ok)
        throw new Error(payload.message ?? "Não foi possível criar o canal.");
      await loadSpaces(activeSpace.id);
      setDialog(null);
      setChannelName("");
      setChannelCategoryId("");
      if (payload.kind === "TEXT") {
        setMessages([]);
        setActiveChannelId(payload.id);
      }
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o canal.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const createInvite = async () => {
    if (!activeSpace) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch(
        `${API_URL}/spaces/${activeSpace.id}/invites`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expiresInDays: inviteDays,
            ...(inviteMaxUses > 0 ? { maxUses: inviteMaxUses } : {}),
          }),
        },
      );
      const payload = (await response.json()) as {
        inviteUrl?: string;
        message?: string;
      };
      if (!response.ok || !payload.inviteUrl)
        throw new Error(payload.message ?? "Não foi possível criar o convite.");
      setInviteUrl(payload.inviteUrl);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o convite.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const joinInvite = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const code = joinCode.trim().split("invite=").pop() ?? "";
      const response = await fetch(
        `${API_URL}/invites/${encodeURIComponent(code)}/join`,
        { method: "POST", credentials: "include" },
      );
      const payload = (await response.json()) as {
        id?: string;
        message?: string;
      };
      if (!response.ok || !payload.id)
        throw new Error(payload.message ?? "Convite inválido.");
      await loadSpaces(payload.id);
      setDialog(null);
      setJoinCode("");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Convite inválido.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectSpace = (space: Space) => {
    setHomeOpen(false);
    setThreadChannel(null);
    setActiveSpaceId(space.id);
    setActiveChannelId(
      space.channels.find((item) => item.kind === "TEXT")?.id ?? "",
    );
    setMessages([]);
  };

  const openDirect = (space: DirectSpace) => {
    const normalized = space as unknown as Space;
    setSpaces((current) =>
      current.some((item) => item.id === normalized.id)
        ? current
        : [...current, normalized],
    );
    selectSpace(normalized);
  };

  const shell = (
    <main className="app-shell">
      <nav className="space-rail" aria-label="Espaços">
        <button
          className={`space space--brand ${homeOpen ? "space--active" : ""}`}
          aria-label="Início e mensagens diretas"
          onClick={() => {
            setHomeOpen(true);
            setActiveSpaceId("");
            setActiveChannelId("");
            setMessages([]);
          }}
        >
          <img src="/app-icon-192.png" alt="" />
        </button>
        <div className="rail-divider" />
        {spaces
          .filter((space) => space.kind === "COMMUNITY")
          .map((space, index) => (
          <button
            key={space.id}
            className={`space ${space.id === activeSpace?.id ? "space--active" : ""}`}
            style={
              {
                "--space-color": ["#ff735f", "#826cff", "#31b98d"][index % 3],
              } as React.CSSProperties
            }
            aria-label={space.name}
            title={space.name}
            onClick={() => selectSpace(space)}
          >
            {space.iconUrl ? (
              <img src={mediaUrl(space.iconUrl)} alt="" />
            ) : (
              space.name
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()
            )}
          </button>
          ))}
        <button
          className="space space--action"
          aria-label="Criar comunidade"
          title="Criar comunidade"
          onClick={() => openDialog("community")}
        >
          <Plus size={21} />
        </button>
        <button
          className="space space--action"
          aria-label="Entrar com convite"
          title="Entrar com convite"
          onClick={() => openDialog("join")}
        >
          <Link2 size={19} />
        </button>
      </nav>

      <aside
        className={`channel-panel ${mobileNav ? "channel-panel--open" : ""}`}
      >
        {homeOpen ? (
          <>
            <div className="workspace-name workspace-name--empty">
              Mensagens diretas
            </div>
            <button className="friends-nav active">
              <Users size={17} /> Amigos
            </button>
            <div className="direct-nav-heading">CONVERSAS</div>
            <div className="direct-nav-list">
              {spaces
                .filter((space) => space.kind !== "COMMUNITY")
                .map((space) => (
                  <button key={space.id} onClick={() => selectSpace(space)}>
                    <span className="direct-nav-avatar">
                      {space.iconUrl ? (
                        <img src={mediaUrl(space.iconUrl)} alt="" />
                      ) : (
                        space.name.slice(0, 1).toUpperCase()
                      )}
                    </span>
                    {space.name}
                  </button>
                ))}
            </div>
          </>
        ) : activeSpace ? (
          <>
            <button
              className="workspace-name"
              onClick={() =>
                activeSpace.kind === "COMMUNITY" &&
                setWorkspaceMenu((value) => !value)
              }
            >
              {activeSpace.name}{" "}
              {activeSpace.kind === "COMMUNITY" && <ChevronDown size={17} />}
            </button>
            {activeSpace.kind === "GROUP" && (
              <button
                className="group-settings-button"
                onClick={() => setGroupManagementOpen(true)}
              >
                <Users size={15} /> Gerenciar participantes
              </button>
            )}
            {workspaceMenu && activeSpace.kind === "COMMUNITY" && (
              <div className="workspace-menu">
                <button onClick={() => openDialog("invite")}>
                  <UserPlus size={16} /> Convidar pessoas
                </button>
                <button onClick={() => openDialog("channel")}>
                  <Plus size={16} /> Criar canal
                </button>
                <button onClick={() => openDialog("join")}>
                  <Link2 size={16} /> Entrar com convite
                </button>
                {activeSpace.permissions.includes("MANAGE_MEMBERS") && (
                  <button
                    onClick={() => {
                      setWorkspaceMenu(false);
                      setSpaceManagementOpen(true);
                    }}
                  >
                    <Settings size={16} /> Configurações do espaço
                  </button>
                )}
              </div>
            )}
            {activeSpace.kind === "COMMUNITY" && activeSpace.categories.length ? (
              <CategorizedChannels
                space={activeSpace}
                activeText={activeChannelId}
                activeVoice={voiceChannelId}
                voicePresence={voicePresence}
                onSelectText={(id) => {
                  setThreadChannel(null);
                  setMessages([]);
                  setActiveChannelId(id);
                  setMobileNav(false);
                  setShowVoiceStage(false);
                }}
                onSelectVoice={(id) => void joinCall(id)}
                onAdd={
                  activeSpace.permissions.includes("MANAGE_CHANNELS")
                    ? () => openDialog("channel")
                    : undefined
                }
                onInvite={() => openDialog("invite")}
                onOpenVoice={() => setShowVoiceStage(true)}
                onLeaveVoice={() => leaveCall()}
              />
            ) : (
              <>
                <ChannelGroup
                  title={
                    activeSpace.kind === "COMMUNITY"
                      ? "CANAIS DE TEXTO"
                      : "MENSAGENS"
                  }
                  channels={activeSpace.channels.filter(
                    (item) => item.kind === "TEXT",
                  )}
                  active={activeChannelId}
                  onAdd={
                    activeSpace.permissions.includes("MANAGE_CHANNELS")
                      ? () => openDialog("channel")
                      : undefined
                  }
                  onSelect={(id) => {
                    setThreadChannel(null);
                    setMessages([]);
                    setActiveChannelId(id);
                    setMobileNav(false);
                    setShowVoiceStage(false);
                  }}
                />
                {activeSpace.kind === "COMMUNITY" && (
              <ChannelGroup
                title="CANAIS DE VOZ"
                channels={activeSpace.channels.filter(
                  (item) => item.kind === "VOICE",
                )}
                active={activeChannelId}
                voiceActive={voiceChannelId}
                voicePresence={voicePresence}
                onAdd={
                  activeSpace.permissions.includes("MANAGE_CHANNELS")
                    ? () => openDialog("channel")
                    : undefined
                }
                onSelect={(id) => void joinCall(id)}
                onInvite={() => openDialog("invite")}
                onOpenVoice={() => setShowVoiceStage(true)}
                onLeaveVoice={() => leaveCall()}
              />
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="workspace-name workspace-name--empty">
              Suas comunidades
            </div>
            <div className="channel-empty">
              <strong>Nenhuma comunidade</strong>
              <span>Crie a sua ou use um convite para entrar.</span>
              <button onClick={() => openDialog("community")}>
                <Plus size={16} /> Criar comunidade
              </button>
              <button onClick={() => openDialog("join")}>
                <Link2 size={16} /> Entrar com convite
              </button>
            </div>
          </>
        )}
        {callToken && voiceChannel && activeSpace && (
          <VoiceConnectionDock
            channel={voiceChannel}
            spaceName={activeSpace.name}
            onLeave={() => leaveCall()}
            onOpenStage={() => setShowVoiceStage(true)}
            onInvite={() => openDialog("invite")}
            cameraDeviceId={user.settings.cameraDeviceId}
            screenCaptureOptions={screenCaptureOptions}
            screenPublishOptions={screenPublishOptions}
            canShareScreen={callCanShareScreen}
          />
        )}
        <div className="profile-bar">
          <div className="avatar avatar--self">
            {user.avatarUrl ? (
              <img src={mediaUrl(user.avatarUrl)} alt="" />
            ) : (
              user.displayName[0].toUpperCase()
            )}
          </div>
          <div className="profile-copy">
            <strong>{user.displayName}</strong>
            <span>
              {callToken && voiceChannel
                ? `Em ${voiceChannel.name}`
                : "VozLivre"}
            </span>
          </div>
          {callToken ? (
            <TrackToggle
              className="profile-voice-toggle"
              source={Track.Source.Microphone}
              captureOptions={
                user.settings.inputDeviceId
                  ? { deviceId: user.settings.inputDeviceId }
                  : undefined
              }
              aria-label="Microfone"
            />
          ) : (
            <button aria-label="Microfone">
              <Mic size={18} />
            </button>
          )}
          {callToken ? (
            <DeafenToggle outputVolume={user.settings.outputVolume} />
          ) : (
            <button aria-label="Áudio">
              <Headphones size={18} />
            </button>
          )}
          <button
            aria-label="Configurações"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>
        </div>
      </aside>

      <section className="conversation">
        {homeOpen ? (
          <SocialHome
            apiUrl={API_URL}
            onOpenDirect={openDirect}
            onChanged={() => loadSpaces()}
          />
        ) : !activeSpace ? (
          <div className="community-empty">
            <div className="community-empty__mark">VL</div>
            <span>COMECE SUA COMUNIDADE</span>
            <h1>Seu VozLivre está vazio</h1>
            <p>
              Comunidades não vêm vinculadas à conta. Crie uma nova ou entre
              somente com um convite recebido.
            </p>
            <div>
              <button onClick={() => openDialog("community")}>
                <Plus size={18} /> Criar comunidade
              </button>
              <button onClick={() => openDialog("join")}>
                <Link2 size={18} /> Entrar com convite
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="topbar">
              <button
                className="mobile-menu"
                onClick={() => setMobileNav((value) => !value)}
                aria-label="Abrir canais"
              >
                <span />
                <span />
                <span />
              </button>
              {showVoiceStage ? (
                <Volume2 size={20} className="muted-icon" />
              ) : (
                <span className="channel-header-icon">
                  <Hash size={21} />
                  <Lock size={9} />
                </span>
              )}
              <div className="channel-title">
                <strong>
                  {showVoiceStage ? voiceChannel?.name : channel?.name}
                </strong>
                {showVoiceStage ? (
                  <span>Conectado à sala de voz.</span>
                ) : (
                  channel?.topic && <span>{channel.topic}</span>
                )}
              </div>
              <div className="topbar-actions">
                {channel?.parentChannelId && (
                  <button
                    aria-label={channel.archivedAt ? "Reabrir thread" : "Arquivar thread"}
                    title={channel.archivedAt ? "Reabrir thread" : "Arquivar thread"}
                    onClick={() =>
                      void toggleThreadArchived().catch((reason) =>
                        setCallError(
                          reason instanceof Error ? reason.message : "Operação não concluída.",
                        ),
                      )
                    }
                  >
                    {channel.archivedAt ? <Check size={18} /> : <Lock size={18} />}
                  </button>
                )}
                {!channel?.parentChannelId && (
                  <button
                    aria-label="Threads do canal"
                    onClick={() => {
                      if (!channel) return;
                      setThreadsOpen(true);
                      void loadThreads(channel.id).catch((reason) =>
                        setCallError(
                          reason instanceof Error
                            ? reason.message
                            : "Não foi possível carregar as threads.",
                        ),
                      );
                    }}
                  >
                    <AtSign size={18} />
                  </button>
                )}
                <button
                  aria-label="Buscar mensagens"
                  onClick={() => void openInspector("search")}
                >
                  <Search size={18} />
                </button>
                <button
                  aria-label="Notificações"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Bell size={18} />
                </button>
                <button
                  aria-label="Mensagens fixadas"
                  onClick={() => void openInspector("pins")}
                >
                  <Pin size={18} />
                </button>
                <button
                  aria-label="Membros"
                  onClick={() => void openInspector("members")}
                >
                  <Users size={19} />
                </button>
              </div>
            </header>
            {showVoiceStage && callToken ? (
              <div className="voice-stage">
                <VideoConference />
                {callCanShareScreen && (
                  <TrackToggle
                    className="low-latency-share"
                    source={Track.Source.ScreenShare}
                    captureOptions={screenCaptureOptions}
                    publishOptions={screenPublishOptions}
                  >
                    <MonitorUp size={16} />
                    <span>Compartilhar tela</span>
                  </TrackToggle>
                )}
              </div>
            ) : (
              <>
                <div className="messages" ref={messagesRef} aria-live="polite">
                  <div className="channel-intro">
                    <div className="channel-intro__icon">
                      <Hash size={40} />
                      <Lock size={13} />
                    </div>
                    <h1>Bem-vindo(a) a #{channel?.name}!</h1>
                    <p>
                      Este é o começo do canal particular{" "}
                      <strong>#{channel?.name}</strong>.
                    </p>
                    {activeSpace.permissions.includes("MANAGE_CHANNELS") && (
                      <div className="channel-intro__actions">
                        <button onClick={() => void openChannelAccess()}>
                          <UserPlus size={15} /> Adicionar membros ou cargos
                        </button>
                        <button onClick={() => openDialog("channel")}>
                          <Plus size={15} /> Criar canal
                        </button>
                      </div>
                    )}
                    <span className="channel-role-badge">
                      <span />{" "}
                      {activeSpace.role === "owner"
                        ? "Proprietário"
                        : activeSpace.role === "admin"
                          ? "Administrador"
                          : "Membro"}
                    </span>
                  </div>
                  {hasMoreMessages && messages[0] && (
                    <button
                      className="load-older"
                      onClick={() => {
                        olderScrollHeightRef.current =
                          messagesRef.current?.scrollHeight ?? 0;
                        socket.emit("chat:history:more", {
                          channelId: channel?.id,
                          beforeId: messages[0].id,
                        });
                      }}
                    >
                      Carregar mensagens anteriores
                    </button>
                  )}
                  {messages.map((message, index) => {
                    const previous = messages[index - 1];
                    const showDate =
                      !previous ||
                      messageDay(previous.createdAt) !==
                        messageDay(message.createdAt);
                    const compact = isCompactMessage(previous, message);
                    const canDelete =
                      message.authorId === user.id ||
                      activeSpace.permissions.includes("MANAGE_MESSAGES");
                    return (
                      <Fragment key={message.id}>
                        {showDate && (
                          <div className="message-date">
                            <span>{formatMessageDate(message.createdAt)}</span>
                          </div>
                        )}
                        <article
                          className={`message ${compact ? "message--compact" : ""}`}
                        >
                          {compact ? (
                            <time className="message__hover-time">
                              {formatMessageTime(message.createdAt)}
                            </time>
                          ) : (
                            <Avatar
                              name={message.author}
                              index={index}
                              url={message.authorAvatarUrl}
                            />
                          )}
                          <div className="message__content">
                            {message.replyTo && (
                              <button
                                className="message-reply-reference"
                                onClick={() =>
                                  document
                                    .getElementById(
                                      `message-${message.replyTo?.id}`,
                                    )
                                    ?.scrollIntoView({
                                      behavior: "smooth",
                                      block: "center",
                                    })
                                }
                              >
                                <Reply size={11} />
                                <strong>{message.replyTo.author}</strong>
                                <span>{message.replyTo.body}</span>
                              </button>
                            )}
                            {!compact && (
                              <div className="message__meta">
                                <strong>{message.author}</strong>
                                <time>
                                  {formatMessageTime(message.createdAt)}
                                </time>
                                {message.editedAt && <small>(editada)</small>}
                                {message.pinnedAt && (
                                  <Pin size={11} aria-label="Mensagem fixada" />
                                )}
                              </div>
                            )}
                            {editingId === message.id ? (
                              <form
                                className="message-edit"
                                onSubmit={(event) =>
                                  saveMessageEdit(event, message.id)
                                }
                              >
                                <input
                                  autoFocus
                                  value={editingBody}
                                  maxLength={4000}
                                  onChange={(event) =>
                                    setEditingBody(event.target.value)
                                  }
                                />
                                <button aria-label="Salvar edição">
                                  <Save size={14} />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Cancelar edição"
                                  onClick={() => setEditingId("")}
                                >
                                  <X size={14} />
                                </button>
                              </form>
                            ) : (
                              message.body && (
                                <p id={`message-${message.id}`}>
                                  <RichMessage
                                    body={message.body}
                                    mentionLabels={mentionLabels}
                                  />
                                </p>
                              )
                            )}
                            {message.sticker && (
                              <img
                                className="message-sticker"
                                src={mediaUrl(message.sticker.url)}
                                alt={message.sticker.name}
                              />
                            )}
                            <MessageAttachments
                              attachments={message.attachments}
                            />
                            {message.thread && (
                              <button
                                className="message-thread-card"
                                onClick={() => void openThread({
                                  id: message.thread!.id,
                                  topic: message.thread!.title,
                                  archivedAt: message.thread!.archivedAt,
                                })}
                              >
                                <AtSign size={16} />
                                <span>
                                  <strong>{message.thread.title}</strong>
                                  <small>
                                    {message.thread.messageCount} mensagens
                                    {message.thread.archivedAt ? " · arquivada" : ""}
                                  </small>
                                </span>
                              </button>
                            )}
                            <div className="message-reactions">
                              {message.reactions.map((reaction) => (
                                <button
                                  key={reaction.emoji}
                                  className={
                                    reaction.userIds.includes(user.id)
                                      ? "selected"
                                      : ""
                                  }
                                  onClick={() =>
                                    socket.emit("chat:reaction", {
                                      messageId: message.id,
                                      emoji: reaction.emoji,
                                    })
                                  }
                                >
                                  {reaction.emoji} <span>{reaction.count}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="message-actions">
                            {!channel?.parentChannelId && (
                              <button
                                aria-label={
                                  message.thread
                                    ? "Abrir thread"
                                    : "Criar thread"
                                }
                                onClick={() => {
                                  if (message.thread)
                                    void openThread({
                                      id: message.thread.id,
                                      topic: message.thread.title,
                                      archivedAt: message.thread.archivedAt,
                                    });
                                  else {
                                    setThreadSource(message);
                                    setThreadTitle(
                                      message.body.slice(0, 60) || "Nova thread",
                                    );
                                  }
                                }}
                              >
                                <AtSign size={14} />
                              </button>
                            )}
                            <button
                              aria-label="Responder"
                              onClick={() => setReplyingTo(message)}
                            >
                              <Reply size={14} />
                            </button>
                            {["👍", "❤️", "😂"].map((emoji) => (
                              <button
                                key={emoji}
                                aria-label={`Reagir ${emoji}`}
                                onClick={() =>
                                  socket.emit("chat:reaction", {
                                    messageId: message.id,
                                    emoji,
                                  })
                                }
                              >
                                {emoji}
                              </button>
                            ))}
                            {activeSpace.permissions.includes(
                              "MANAGE_MESSAGES",
                            ) && (
                              <button
                                aria-label={
                                  message.pinnedAt
                                    ? "Desafixar mensagem"
                                    : "Fixar mensagem"
                                }
                                onClick={() => void togglePin(message)}
                              >
                                <Pin size={14} />
                              </button>
                            )}
                            {message.authorId === user.id && (
                              <button
                                aria-label="Editar mensagem"
                                onClick={() => {
                                  setEditingId(message.id);
                                  setEditingBody(message.body);
                                }}
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                aria-label="Excluir mensagem"
                                onClick={() =>
                                  socket.emit("chat:delete", {
                                    messageId: message.id,
                                  })
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </article>
                      </Fragment>
                    );
                  })}
                </div>
                <div className="composer-wrap">
                  {replyingTo && (
                    <div className="replying-banner">
                      <span>
                        Respondendo a <strong>{replyingTo.author}</strong>
                      </span>
                      <button
                        onClick={() => setReplyingTo(null)}
                        aria-label="Cancelar resposta"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  )}
                  {pendingAttachments.length > 0 && (
                    <div className="pending-attachments">
                      {pendingAttachments.map((item) => (
                        <span key={item.id}>
                          <File size={14} />
                          {item.name}
                          <button
                            onClick={() => void cancelPendingAttachment(item.id)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {emojiOpen && (
                    <div className="emoji-picker">
                      {[
                        "😀",
                        "😂",
                        "😍",
                        "🥳",
                        "😎",
                        "🤔",
                        "😢",
                        "😡",
                        "👍",
                        "👎",
                        "❤️",
                        "🔥",
                        "🎉",
                        "✅",
                        "👀",
                        "🚀",
                      ].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            changeDraft(`${draft}${emoji}`);
                            setEmojiOpen(false);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  {mentionOpen && (
                    <div className="mention-picker">
                      {mentionItems.length === 0 && <span>Nenhuma menção disponível.</span>}
                      {mentionItems.map((item) => (
                        <button key={`${item.kind}:${item.id}`} onClick={() => addMention(item)}>
                          <AtSign size={14} />
                          <span>{item.name}</span>
                          <small>{item.kind === "role" ? "cargo" : item.kind === "everyone" ? "todos" : "membro"}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  {stickerOpen && (
                    <div className="sticker-picker">
                      {stickers.length === 0 && <span>Nenhuma figurinha nesta comunidade.</span>}
                      {stickers.map((item) => (
                        <button key={item.id} onClick={() => sendSticker(item.id)} title={item.name}>
                          <img src={mediaUrl(item.url)} alt={item.name} />
                        </button>
                      ))}
                    </div>
                  )}
                  <form className="composer" onSubmit={sendMessage}>
                    <input
                      ref={fileInputRef}
                      hidden
                      type="file"
                      multiple
                      onChange={(event) => void uploadFiles(event.target.files)}
                    />
                    <button
                      type="button"
                      aria-label="Anexar arquivos"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <span className="upload-spinner" />
                      ) : (
                        <Paperclip size={20} />
                      )}
                    </button>
                    <input
                      value={draft}
                      onChange={(event) => changeDraft(event.target.value)}
                      placeholder={
                        replyingTo
                          ? `Responder a ${replyingTo.author}`
                          : `Conversar em #${channel?.name ?? ""}`
                      }
                      aria-label="Mensagem"
                      disabled={!channel || Boolean(channel.archivedAt)}
                    />
                    <button
                      type="button"
                      aria-label="Mencionar"
                      onClick={() => {
                        setMentionOpen((value) => !value);
                        setEmojiOpen(false);
                        setStickerOpen(false);
                      }}
                    >
                      <AtSign size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label="Figurinhas"
                      onClick={() => {
                        setStickerOpen((value) => !value);
                        setEmojiOpen(false);
                        setMentionOpen(false);
                      }}
                    >
                      <Sticker size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label="Emoji"
                      onClick={() => {
                        setEmojiOpen((value) => !value);
                        setMentionOpen(false);
                        setStickerOpen(false);
                      }}
                    >
                      <Smile size={19} />
                    </button>
                    <button
                      className="composer__send"
                      type="submit"
                      aria-label="Enviar mensagem"
                    >
                      <Send size={18} />
                    </button>
                  </form>
                  {Object.values(typingUsers).length > 0 && (
                    <div className="typing-indicator">
                      <strong>{Object.values(typingUsers).join(", ")}</strong>{" "}
                      {Object.values(typingUsers).length === 1
                        ? "está digitando…"
                        : "estão digitando…"}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>

      {callError && (
        <div className="toast" role="alert">
          {callError}
          <button onClick={() => setCallError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {settingsOpen && (
        <SettingsPanel
          user={user}
          onUserUpdated={onUserUpdated}
          onClose={() => setSettingsOpen(false)}
          onLogout={async () => {
            try {
              await fetch(`${API_URL}/auth/logout`, {
                method: "POST",
                credentials: "include",
              });
            } finally {
              socket.disconnect();
              onLogout();
            }
          }}
        />
      )}
      {spaceManagementOpen && activeSpace && (
        <SpaceManagement
          apiUrl={API_URL}
          space={activeSpace}
          currentUserId={user.id}
          onClose={() => setSpaceManagementOpen(false)}
          onChanged={async () => {
            await loadSpaces(activeSpace.id);
            socket.emit("spaces:sync");
          }}
        />
      )}
      {groupManagementOpen && activeSpace?.kind === "GROUP" && (
        <GroupManagement
          apiUrl={API_URL}
          group={activeSpace}
          currentUserId={user.id}
          onClose={() => setGroupManagementOpen(false)}
          onChanged={async () => {
            await loadSpaces(activeSpace.id);
            socket.emit("spaces:sync");
          }}
        />
      )}
      {accessOpen && (
        <ActionDialog
          title="Membros e cargos"
          onClose={() => setAccessOpen(false)}
        >
          <form className="channel-access-form" onSubmit={saveChannelAccess}>
            <p>
              Escolha quais membros ou cargos podem acessar{" "}
              <strong>#{channel?.name}</strong>. Proprietários e administradores
              sempre mantêm acesso.
            </p>
            {submitting && !channelAccess ? (
              <div className="access-loading">Carregando acessos…</div>
            ) : (
              channelAccess && (
                <>
                  <button
                    type="button"
                    className={`access-restriction ${accessRestricted ? "selected" : ""}`}
                    aria-pressed={accessRestricted}
                    onClick={() => setAccessRestricted((value) => !value)}
                  >
                    <Lock size={17} />
                    <span>
                      <strong>Canal restrito</strong>
                      <small>
                        {accessRestricted
                          ? "Somente as seleções abaixo podem entrar."
                          : "Todos os membros da comunidade podem entrar."}
                      </small>
                    </span>
                    <Check size={17} />
                  </button>
                  <div className="access-section">
                    <strong>CARGOS</strong>
                    {channelAccess.availableRoles.map((role) => (
                      <button
                        type="button"
                        key={role.id}
                        className={
                          accessRoles.includes(role.id) ? "selected" : ""
                        }
                        aria-pressed={accessRoles.includes(role.id)}
                        onClick={() =>
                          setAccessRoles((current) =>
                            current.includes(role.id)
                              ? current.filter((id) => id !== role.id)
                              : [...current, role.id],
                          )
                        }
                      >
                        <span className={`role-dot role-dot--${role.id}`} />
                        {role.name}
                        <Check size={15} />
                      </button>
                    ))}
                  </div>
                  <div className="access-section">
                    <strong>MEMBROS</strong>
                    {channelAccess.members.map((member) => (
                      <button
                        type="button"
                        key={member.id}
                        className={
                          accessMemberIds.includes(member.id) ? "selected" : ""
                        }
                        aria-pressed={accessMemberIds.includes(member.id)}
                        onClick={() =>
                          setAccessMemberIds((current) =>
                            current.includes(member.id)
                              ? current.filter((id) => id !== member.id)
                              : [...current, member.id],
                          )
                        }
                      >
                        <span className="access-avatar">
                          {member.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          {member.displayName}
                          <small>{member.email}</small>
                        </span>
                        <Check size={15} />
                      </button>
                    ))}
                  </div>
                </>
              )
            )}
            {formError && <div className="dialog-error">{formError}</div>}
            <button
              className="dialog-primary"
              disabled={submitting || !channelAccess}
            >
              {submitting ? "Salvando…" : "Salvar acessos"}
            </button>
          </form>
        </ActionDialog>
      )}
      {threadSource && (
        <ActionDialog
          title="Criar thread"
          onClose={() => {
            setThreadSource(null);
            setFormError("");
          }}
        >
          <form onSubmit={createThread}>
            <p>
              Abra uma conversa paralela a partir da mensagem de{" "}
              <strong>{threadSource.author}</strong>.
            </p>
            <label>
              Título da thread
              <input
                autoFocus
                required
                maxLength={80}
                value={threadTitle}
                onChange={(event) => setThreadTitle(event.target.value)}
              />
            </label>
            {formError && <div className="dialog-error">{formError}</div>}
            <button className="dialog-primary" disabled={submitting}>
              {submitting ? "Criando…" : "Criar thread"}
            </button>
          </form>
        </ActionDialog>
      )}
      {threadsOpen && (
        <ActionDialog title="Threads do canal" onClose={() => setThreadsOpen(false)}>
          <div className="thread-list">
            {threadList.length === 0 && <p>Nenhuma thread foi criada neste canal.</p>}
            {threadList.map((thread) => (
              <article key={thread.id}>
                <AtSign size={17} />
                <button onClick={() => void openThread(thread)}>
                  <strong>{thread.topic}</strong>
                  <small>
                    {thread._count.messages} mensagens
                    {thread.archivedAt ? " · arquivada" : ""}
                  </small>
                </button>
              </article>
            ))}
          </div>
        </ActionDialog>
      )}
      {inspector && (
        <ActionDialog
          title={
            inspector === "search"
              ? "Buscar mensagens"
              : inspector === "pins"
                ? "Mensagens fixadas"
                : "Membros da comunidade"
          }
          onClose={() => setInspector(null)}
        >
          {inspector === "search" && (
            <form
              className="inspector-search"
              onSubmit={(event) => {
                event.preventDefault();
                void openInspector("search", searchQuery);
              }}
            >
              <input
                autoFocus
                minLength={2}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Busque por palavras da mensagem"
              />
              <button>
                <Search size={16} /> Buscar
              </button>
            </form>
          )}
          {inspectorLoading ? (
            <div className="access-loading">Carregando…</div>
          ) : inspector === "members" ? (
            <div className="inspector-list">
              {(inspectorItems as CommunityMember[]).map((member) => (
                <article key={member.id}>
                  <Avatar name={member.displayName} index={0} />
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>
                      {member.status ||
                        (member.role === "owner"
                          ? "Proprietário"
                          : member.role === "admin"
                            ? "Administrador"
                            : "Membro")}
                    </small>
                  </div>
                  {member.roles.map((role) => (
                    <span key={role.id} style={{ color: role.color }}>
                      {role.name}
                    </span>
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <div className="inspector-messages">
              {(inspectorItems as Message[]).length === 0 && (
                <p>Nenhuma mensagem encontrada.</p>
              )}
              {(inspectorItems as Message[]).map((message) => (
                <article key={message.id}>
                  <div>
                    <strong>{message.author}</strong>
                    <time>
                      {formatMessageDate(message.createdAt)}{" "}
                      {formatMessageTime(message.createdAt)}
                    </time>
                  </div>
                  <p>{message.body || "Anexo"}</p>
                  {inspector === "pins" && (
                    <button onClick={() => void togglePin(message)}>
                      <Pin size={13} /> Desafixar
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </ActionDialog>
      )}
      {dialog && (
        <ActionDialog
          title={
            dialog === "community"
              ? "Criar comunidade"
              : dialog === "channel"
                ? "Criar canal"
                : dialog === "invite"
                  ? "Convidar pessoas"
                  : "Entrar com convite"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "community" ? (
            <form onSubmit={createCommunity}>
              <p>
                Você será o proprietário e poderá convidar outras pessoas
                depois.
              </p>
              <label>
                Nome da comunidade
                <input
                  autoFocus
                  value={communityName}
                  maxLength={80}
                  onChange={(event) => setCommunityName(event.target.value)}
                  placeholder="ex: Comunidade Voz Livre"
                  required
                />
              </label>
              {formError && <div className="dialog-error">{formError}</div>}
              <button className="dialog-primary" disabled={submitting}>
                {submitting ? "Criando…" : "Criar comunidade"}
              </button>
            </form>
          ) : dialog === "channel" ? (
            <form onSubmit={createChannel}>
              <label>
                Nome do canal
                <input
                  autoFocus
                  value={channelName}
                  maxLength={50}
                  onChange={(event) => setChannelName(event.target.value)}
                  placeholder="ex: projetos"
                  required
                />
              </label>
              <fieldset>
                <legend>Tipo</legend>
                <button
                  type="button"
                  className={channelKind === "TEXT" ? "selected" : ""}
                  onClick={() => setChannelKind("TEXT")}
                >
                  <Hash size={18} />
                  Texto
                </button>
                <button
                  type="button"
                  className={channelKind === "VOICE" ? "selected" : ""}
                  onClick={() => setChannelKind("VOICE")}
                >
                  <Volume2 size={18} />
                  Voz
                </button>
              </fieldset>
              {activeSpace && activeSpace.categories.length > 0 && (
                <label>
                  Categoria
                  <select
                    value={channelCategoryId}
                    onChange={(event) => setChannelCategoryId(event.target.value)}
                  >
                    <option value="">Sem categoria</option>
                    {activeSpace.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {formError && <div className="dialog-error">{formError}</div>}
              <button className="dialog-primary" disabled={submitting}>
                {submitting ? "Criando…" : "Criar canal"}
              </button>
            </form>
          ) : dialog === "invite" ? (
            <div className="invite-dialog">
              {!inviteUrl && (
                <div className="invite-options">
                  <label>
                    Expiração
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
                    Limite de usos
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      value={inviteMaxUses}
                      onChange={(event) => setInviteMaxUses(Number(event.target.value))}
                    />
                    <small>Use 0 para não limitar.</small>
                  </label>
                </div>
              )}
              <p>Este espaço é privado. O link expira em 7 dias.</p>
              {inviteUrl ? (
                <>
                  <label>
                    Link de convite
                    <input readOnly value={inviteUrl} />
                  </label>
                  <button
                    className="dialog-primary"
                    onClick={() =>
                      void navigator.clipboard.writeText(inviteUrl)
                    }
                  >
                    <Copy size={16} /> Copiar convite
                  </button>
                </>
              ) : (
                <button
                  className="dialog-primary"
                  disabled={submitting}
                  onClick={() => void createInvite()}
                >
                  {submitting ? "Gerando…" : "Gerar convite"}
                </button>
              )}
              {formError && <div className="dialog-error">{formError}</div>}
            </div>
          ) : (
            <form onSubmit={joinInvite}>
              <p>Cole o link ou código enviado pelo administrador.</p>
              <label>
                Convite
                <input
                  autoFocus
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="Código ou link de convite"
                  required
                />
              </label>
              {formError && <div className="dialog-error">{formError}</div>}
              <button className="dialog-primary" disabled={submitting}>
                {submitting ? "Entrando…" : "Entrar na comunidade"}
              </button>
            </form>
          )}
        </ActionDialog>
      )}
    </main>
  );

  if (!callToken) return shell;
  return (
    <LiveKitRoom
      className="voice-room-root"
      token={callToken}
      serverUrl={LIVEKIT_URL}
      options={roomOptions}
      connect
      audio
      video={false}
      onConnected={() => {
        if (voiceChannelId)
          socket.emit("voice:join", { channelId: voiceChannelId });
      }}
      onDisconnected={() => leaveCall(voiceChannelId)}
      data-lk-theme="default"
    >
      {shell}
      <RoomAudioRenderer />
      <MicrophoneGain volume={user.settings.inputVolume} />
      <DeviceRouting settings={user.settings} />
    </LiveKitRoom>
  );
}

function CategorizedChannels({
  space,
  activeText,
  activeVoice,
  voicePresence,
  onSelectText,
  onSelectVoice,
  onAdd,
  onInvite,
  onOpenVoice,
  onLeaveVoice,
}: {
  space: Space;
  activeText: string;
  activeVoice: string;
  voicePresence: Record<string, VoiceParticipant[]>;
  onSelectText: (id: string) => void;
  onSelectVoice: (id: string) => void;
  onAdd?: () => void;
  onInvite: () => void;
  onOpenVoice: () => void;
  onLeaveVoice: () => void;
}) {
  const renderGroup = (title: string, channels: Channel[], add?: () => void) => (
    <ChannelGroup
      key={title}
      title={title.toUpperCase()}
      channels={channels}
      active={activeText}
      voiceActive={activeVoice}
      voicePresence={voicePresence}
      onAdd={add}
      onSelect={(id) => {
        const selected = channels.find((channel) => channel.id === id);
        if (selected?.kind === "VOICE") onSelectVoice(id);
        else onSelectText(id);
      }}
      onInvite={onInvite}
      onOpenVoice={onOpenVoice}
      onLeaveVoice={onLeaveVoice}
    />
  );
  const uncategorized = space.channels.filter((channel) => !channel.categoryId);
  return (
    <>
      {uncategorized.length > 0 && renderGroup("CANAIS", uncategorized, onAdd)}
      {space.categories
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((category) =>
          renderGroup(
            category.name,
            space.channels.filter((channel) => channel.categoryId === category.id),
            onAdd,
          ),
        )}
    </>
  );
}

function ChannelGroup({
  title,
  channels: items,
  active,
  voiceActive = active,
  voicePresence = {},
  onSelect,
  onAdd,
  onInvite,
  onOpenVoice,
  onLeaveVoice,
}: {
  title: string;
  channels: Channel[];
  active: string;
  voiceActive?: string;
  voicePresence?: Record<string, VoiceParticipant[]>;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  onInvite?: () => void;
  onOpenVoice?: () => void;
  onLeaveVoice?: () => void;
}) {
  return (
    <section className="channel-group">
      <div className="channel-group__title">
        <span>{title}</span>
        {onAdd && (
          <button onClick={onAdd} aria-label={`Adicionar em ${title}`}>
            <Plus size={15} />
          </button>
        )}
      </div>
      {items.map((item) => {
        const participants = voicePresence[item.id] ?? [];
        const connected = item.kind === "VOICE" && voiceActive === item.id;
        const expanded =
          item.kind === "VOICE" && (connected || participants.length > 0);
        return (
          <div
            className={`channel-entry ${expanded ? "channel-entry--expanded" : ""}`}
            key={item.id}
          >
            <div className="channel-row">
              <button
                className={`channel ${connected || (item.kind === "TEXT" && active === item.id) ? "channel--active" : ""}`}
                onClick={() => onSelect(item.id)}
              >
                {item.kind === "VOICE" ? (
                  <Volume2 size={18} />
                ) : (
                  <Hash size={18} />
                )}
                <span>{item.name}</span>
                {item.kind === "TEXT" && item.unreadCount > 0 && (
                  <i>{item.unreadCount > 99 ? "99+" : item.unreadCount}</i>
                )}
              </button>
              {item.kind === "VOICE" && expanded && (
                <div className="channel-actions">
                  {connected && (
                    <button
                      onClick={onOpenVoice}
                      aria-label={`Abrir sala ${item.name}`}
                    >
                      <Video size={15} />
                    </button>
                  )}
                  <button
                    onClick={onInvite}
                    aria-label={`Convidar para ${item.name}`}
                  >
                    <UserPlus size={15} />
                  </button>
                  {connected && (
                    <button
                      className="channel-action--leave"
                      onClick={onLeaveVoice}
                      aria-label={`Desconectar de ${item.name}`}
                    >
                      <PhoneOff size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {connected && (
              <div className="voice-channel-status">
                Conectado ao canal de voz
              </div>
            )}
            {expanded &&
              participants.map((participant) => (
                <div className="channel-voice-user" key={participant.userId}>
                  <div>{participant.displayName.slice(0, 1).toUpperCase()}</div>
                  <span>{participant.displayName}</span>
                  <Mic size={12} />
                </div>
              ))}
            {expanded && (
              <button className="voice-invite-row" onClick={onInvite}>
                <div>
                  <UserPlus size={13} />
                </div>
                <span>Convidar para voz</span>
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

function VoiceConnectionDock({
  channel,
  spaceName,
  onLeave,
  onOpenStage,
  onInvite,
  cameraDeviceId,
  screenCaptureOptions,
  screenPublishOptions,
  canShareScreen,
}: {
  channel: Channel;
  spaceName: string;
  onLeave: () => void;
  onOpenStage: () => void;
  onInvite: () => void;
  cameraDeviceId: string;
  screenCaptureOptions: ScreenShareCaptureOptions;
  screenPublishOptions: TrackPublishOptions;
  canShareScreen: boolean;
}) {
  return (
    <section className="voice-dock">
      <header>
        <div className="voice-dock__signal">
          <Radio size={18} />
        </div>
        <div className="voice-dock__copy">
          <strong>Voz conectada</strong>
          <span>
            {channel.name} / {spaceName}
          </span>
        </div>
        <AudioLines
          size={18}
          className="voice-dock__quality"
          aria-label="Conexão de voz ativa"
        />
        <button
          className="voice-dock__disconnect"
          onClick={onLeave}
          aria-label="Desconectar da voz"
        >
          <PhoneOff size={17} />
        </button>
      </header>
      <div className="voice-dock__actions">
        <TrackToggle
          source={Track.Source.Camera}
          captureOptions={
            cameraDeviceId ? { deviceId: cameraDeviceId } : undefined
          }
          aria-label="Ativar câmera"
          onChange={(enabled) => {
            if (enabled) onOpenStage();
          }}
        />
        {canShareScreen ? (
          <TrackToggle
            source={Track.Source.ScreenShare}
            captureOptions={screenCaptureOptions}
            publishOptions={screenPublishOptions}
            aria-label="Compartilhar tela"
            onChange={(enabled) => {
              if (enabled) onOpenStage();
            }}
          />
        ) : (
          <button disabled title="Sem permissão para compartilhar a tela">
            <MonitorUp size={17} />
          </button>
        )}
        <button onClick={onOpenStage} aria-label="Abrir sala">
          <LayoutGrid size={17} />
        </button>
        <button onClick={onInvite} aria-label="Convidar para voz">
          <UserPlus size={17} />
        </button>
      </div>
    </section>
  );
}

class InputGainProcessor {
  readonly name = "vozlivre-input-gain";
  processedTrack?: MediaStreamTrack;
  private source?: MediaStreamAudioSourceNode;
  private gain?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private volume = 1;

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(value, 2));
    if (this.gain)
      this.gain.gain.setTargetAtTime(
        this.volume,
        this.gain.context.currentTime,
        0.01,
      );
  }

  async init(options: {
    track: MediaStreamTrack;
    audioContext: AudioContext;
  }) {
    this.source = options.audioContext.createMediaStreamSource(
      new MediaStream([options.track]),
    );
    this.gain = options.audioContext.createGain();
    this.destination = options.audioContext.createMediaStreamDestination();
    this.gain.gain.value = this.volume;
    this.source.connect(this.gain).connect(this.destination);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }

  async restart(options: {
    track: MediaStreamTrack;
    audioContext: AudioContext;
  }) {
    await this.destroy();
    await this.init(options);
  }

  async destroy() {
    this.source?.disconnect();
    this.gain?.disconnect();
    this.destination?.disconnect();
    this.processedTrack?.stop();
    this.source = undefined;
    this.gain = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
  }
}

function MicrophoneGain({ volume }: { volume: number }) {
  const room = useRoomContext();
  const [processor] = useState(() => new InputGainProcessor());
  const trackRef = useRef<LocalAudioTrack | null>(null);

  useEffect(() => {
    processor.setVolume(volume / 100);
  }, [processor, volume]);

  useEffect(() => {
    const apply = async () => {
      const publication = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const track = publication?.track;
      if (!(track instanceof LocalAudioTrack) || track === trackRef.current) return;
      trackRef.current = track;
      await track.setProcessor(processor);
    };
    const handlePublished = () => void apply().catch(() => undefined);
    void apply().catch(() => undefined);
    room.on(RoomEvent.LocalTrackPublished, handlePublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handlePublished);
      if (trackRef.current) void trackRef.current.stopProcessor();
      trackRef.current = null;
    };
  }, [processor, room]);

  return null;
}

function DeviceRouting({ settings }: { settings: UserSettings }) {
  const room = useRoomContext();
  useEffect(() => {
    if (settings.inputDeviceId)
      void room.switchActiveDevice("audioinput", settings.inputDeviceId, true);
    if (settings.outputDeviceId)
      void room.switchActiveDevice("audiooutput", settings.outputDeviceId, true);
    if (settings.cameraDeviceId)
      void room.switchActiveDevice("videoinput", settings.cameraDeviceId, true);
  }, [room, settings.cameraDeviceId, settings.inputDeviceId, settings.outputDeviceId]);
  return null;
}

function DeafenToggle({ outputVolume }: { outputVolume: number }) {
  const room = useRoomContext();
  const [deafened, setDeafened] = useState(false);

  useEffect(() => {
    const applyVolume = (participant: RemoteParticipant) => {
      const volume = deafened ? 0 : outputVolume / 100;
      participant.setVolume(volume, Track.Source.Microphone);
      participant.setVolume(volume, Track.Source.ScreenShareAudio);
    };

    room.remoteParticipants.forEach(applyVolume);
    room.on(RoomEvent.ParticipantConnected, applyVolume);
    return () => {
      room.off(RoomEvent.ParticipantConnected, applyVolume);
      if (deafened) {
        room.remoteParticipants.forEach((participant) => {
          participant.setVolume(outputVolume / 100, Track.Source.Microphone);
          participant.setVolume(
            outputVolume / 100,
            Track.Source.ScreenShareAudio,
          );
        });
      }
    };
  }, [deafened, outputVolume, room]);

  return (
    <button
      className={`profile-deafen-toggle ${deafened ? "profile-deafen-toggle--active" : ""}`}
      aria-label={deafened ? "Ativar áudio" : "Desativar áudio"}
      aria-pressed={deafened}
      onClick={() => setDeafened((current) => !current)}
    >
      {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
    </button>
  );
}

function ActionDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="action-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <span>VOZLIVRE</span>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function AuthScreen({
  initialError = "",
  onAuthenticated,
}: {
  initialError?: string;
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(
        challengeToken ? `${API_URL}/auth/login/2fa` : `${API_URL}/auth/${mode}`,
        {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          challengeToken
            ? { challengeToken, code: twoFactorCode }
            : mode === "register"
            ? { displayName, email, password }
            : { email, password },
        ),
        },
      );
      const payload = (await response.json()) as {
        user?: AuthUser;
        requiresTwoFactor?: boolean;
        challengeToken?: string;
        message?: string | string[];
      };
      if (!response.ok) {
        const message = Array.isArray(payload.message)
          ? payload.message[0]
          : payload.message;
        throw new Error(message ?? "Não foi possível continuar.");
      }
      if (payload.requiresTwoFactor && payload.challengeToken) {
        setChallengeToken(payload.challengeToken);
        setTwoFactorCode("");
        return;
      }
      if (!payload.user) throw new Error("Não foi possível continuar.");
      onAuthenticated(payload.user);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível continuar.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((current) => (current === "login" ? "register" : "login"));
    setError("");
    setPassword("");
    setConfirmPassword("");
    setChallengeToken("");
    setTwoFactorCode("");
  };

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <div className="auth-mark">
            <img src="/app-icon-192.png" alt="" />
          </div>
          <strong>VozLivre</strong>
        </div>
        <div className="auth-story__copy">
          <span>CONVERSE SEM DISTÂNCIA</span>
          <h1>
            Seu grupo inteiro,
            <br />
            na mesma frequência.
          </h1>
          <p>
            Canais, mensagens e chamadas em um espaço criado para permanecer
            próximo.
          </p>
        </div>
        <div className="signal-orbit">
          <i />
          <i />
          <i />
          <div>
            <Mic size={28} />
          </div>
        </div>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-brand auth-brand--mobile">
            <div className="auth-mark">
              <img src="/app-icon-192.png" alt="" />
            </div>
            <strong>VozLivre</strong>
          </div>
          <header>
            <span>
              {challengeToken
                ? "CONFIRME SUA IDENTIDADE"
                : mode === "login"
                  ? "BEM-VINDO DE VOLTA"
                  : "CRIE SEU ESPAÇO"}
            </span>
            <h2>
              {challengeToken
                ? "Verificação em duas etapas"
                : mode === "login"
                  ? "Entre na sua conta"
                  : "Crie sua conta"}
            </h2>
            <p>
              {challengeToken
                ? "Informe o código do autenticador ou um código de recuperação."
                : mode === "login"
                ? "Suas conversas estão esperando por você."
                : "Leva menos de um minuto para começar."}
            </p>
          </header>
          {!challengeToken && mode === "register" && (
            <label className="auth-field">
              <span>Nome de exibição</span>
              <div>
                <Users size={17} />
                <input
                  autoComplete="name"
                  required
                  maxLength={50}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Como as pessoas verão você"
                />
              </div>
            </label>
          )}
          {!challengeToken && <label className="auth-field">
            <span>E-mail</span>
            <div>
              <Mail size={17} />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@exemplo.com"
              />
            </div>
          </label>}
          {!challengeToken && <label className="auth-field">
            <span>Senha</span>
            <div>
              <Lock size={17} />
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo de 8 caracteres"
              />
            </div>
          </label>}
          {!challengeToken && mode === "register" && (
            <label className="auth-field">
              <span>Confirmar senha</span>
              <div>
                <KeyRound size={17} />
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Digite a senha novamente"
                />
              </div>
            </label>
          )}
          {challengeToken && (
            <label className="auth-field">
              <span>Código de verificação</span>
              <div>
                <KeyRound size={17} />
                <input
                  autoFocus
                  required
                  maxLength={32}
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value)}
                  placeholder="000000 ou código de recuperação"
                />
              </div>
            </label>
          )}
          {mode === "login" && (
            <button type="button" className="forgot-button">
              Esqueceu sua senha?
            </button>
          )}
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="auth-submit" disabled={submitting}>
            {submitting
              ? "Aguarde…"
              : mode === "login"
                ? "Entrar"
                : "Criar conta"}
            <span>→</span>
          </button>
          <div className="auth-switch">
            {mode === "login"
              ? "Ainda não tem uma conta?"
              : "Já possui uma conta?"}{" "}
            <button type="button" onClick={switchMode}>
              {mode === "login" ? "Cadastre-se" : "Entrar"}
            </button>
          </div>
          <footer>
            <Shield size={14} /> Sua senha é armazenada com hash e a sessão usa
            cookie protegido.
          </footer>
        </form>
      </section>
    </main>
  );
}

const settingSections = [
  { id: "account", label: "Minha conta", icon: Users },
  { id: "profile", label: "Perfis", icon: SlidersHorizontal },
  { id: "privacy", label: "Privacidade e segurança", icon: Shield },
  { id: "voice", label: "Voz e vídeo", icon: Mic },
  { id: "notifications", label: "Notificações", icon: Bell },
  { id: "appearance", label: "Aparência", icon: Palette },
];

function SettingsPanel({
  user,
  onClose,
  onLogout,
  onUserUpdated,
}: {
  user: AuthUser;
  onClose: () => void;
  onLogout: () => void;
  onUserUpdated: (user: AuthUser) => void;
}) {
  const [section, setSection] = useState("account");
  const [editingProfile, setEditingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [status, setStatus] = useState(user.status);
  const [preferences, setPreferences] = useState(user.settings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  const saveProfile = async (event?: FormEvent) => {
    event?.preventDefault();
    setSaving(true);
    setAccountError("");
    setAccountSuccess("");
    try {
      const response = await fetch(`${API_URL}/auth/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, bio, status }),
      });
      const payload = (await response.json()) as {
        user?: AuthUser;
        message?: string;
      };
      if (!response.ok || !payload.user)
        throw new Error(
          payload.message ?? "Não foi possível atualizar o perfil.",
        );
      onUserUpdated(payload.user);
      setEditingProfile(false);
      setAccountSuccess("Perfil atualizado.");
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o perfil.",
      );
    } finally {
      setSaving(false);
    }
  };
  const savePreferences = async () => {
    setSaving(true);
    setAccountError("");
    setAccountSuccess("");
    try {
      if (
        preferences.desktopNotifications &&
        "Notification" in window &&
        Notification.permission === "default"
      )
        await Notification.requestPermission();
      const response = await fetch(`${API_URL}/auth/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const payload = (await response.json()) as {
        settings?: UserSettings;
        message?: string;
      };
      if (!response.ok || !payload.settings)
        throw new Error(
          payload.message ?? "Não foi possível salvar as configurações.",
        );
      onUserUpdated({ ...user, settings: payload.settings });
      setPreferences(payload.settings);
      setAccountSuccess("Configurações salvas.");
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as configurações.",
      );
    } finally {
      setSaving(false);
    }
  };
  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setAccountError("");
    setAccountSuccess("");
    if (newPassword !== confirmPassword) {
      setAccountError("A confirmação da nova senha não confere.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/auth/password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(payload.message ?? "Não foi possível alterar a senha.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setChangingPassword(false);
      setAccountSuccess("Senha alterada com segurança.");
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : "Não foi possível alterar a senha.",
      );
    } finally {
      setSaving(false);
    }
  };
  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    setSaving(true);
    setAccountError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_URL}/auth/avatar`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const payload = (await response.json()) as {
        avatarUrl?: string;
        message?: string;
      };
      if (!response.ok || !payload.avatarUrl)
        throw new Error(payload.message ?? "Não foi possível atualizar a foto.");
      onUserUpdated({ ...user, avatarUrl: payload.avatarUrl });
      setAccountSuccess("Foto de perfil atualizada.");
    } catch (reason) {
      setAccountError(reason instanceof Error ? reason.message : "Falha ao enviar a foto.");
    } finally {
      setSaving(false);
    }
  };

  const removeAvatar = async () => {
    const response = await fetch(`${API_URL}/auth/avatar`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) return;
    onUserUpdated({ ...user, avatarUrl: null });
  };
  return (
    <div className="settings-layer">
      <aside className="settings-nav">
        <strong>CONFIGURAÇÕES DO USUÁRIO</strong>
        {settingSections.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={section === item.id ? "active" : ""}
              onClick={() => setSection(item.id)}
            >
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
        <div />
        <button className="logout-option" onClick={onLogout}>
          <LogOut size={17} />
          Sair
        </button>
      </aside>
      <section className="settings-content">
        <button className="settings-close" onClick={onClose}>
          <X size={21} />
          <span>ESC</span>
        </button>
        {section === "account" ? (
          <>
            <h2>Minha conta</h2>
            <div className="account-banner">
              <div className="avatar account-avatar">
                {user.avatarUrl ? (
                  <img src={mediaUrl(user.avatarUrl)} alt="" />
                ) : (
                  user.displayName[0].toUpperCase()
                )}
              </div>
              <strong>{user.displayName}</strong>
              <button onClick={() => setEditingProfile(true)}>
                Editar perfil
              </button>
              <input
                hidden
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => void uploadAvatar(event.target.files?.[0])}
              />
              <button onClick={() => avatarInputRef.current?.click()}>
                Alterar foto
              </button>
              {user.avatarUrl && (
                <button onClick={() => void removeAvatar()}>Remover foto</button>
              )}
            </div>
            <div className="account-details">
              <div>
                <span>NOME DE EXIBIÇÃO</span>
                <strong>{user.displayName}</strong>
                <button onClick={() => setEditingProfile(true)}>Editar</button>
              </div>
              <div>
                <span>E-MAIL</span>
                <strong>{user.email}</strong>
                <small>
                  O e-mail identifica sua conta e ainda não pode ser alterado.
                </small>
              </div>
            </div>
            {editingProfile && (
              <form className="account-form" onSubmit={saveProfile}>
                <label>
                  Nome de exibição
                  <input
                    autoFocus
                    value={displayName}
                    maxLength={50}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <div>
                  <button
                    type="button"
                    onClick={() => setEditingProfile(false)}
                  >
                    Cancelar
                  </button>
                  <button disabled={saving}>
                    <Save size={14} /> Salvar perfil
                  </button>
                </div>
              </form>
            )}
            <h3>Senha e autenticação</h3>
            {!changingPassword ? (
              <button
                className="primary-option"
                onClick={() => setChangingPassword(true)}
              >
                <KeyRound size={16} /> Alterar senha
              </button>
            ) : (
              <form className="account-form" onSubmit={savePassword}>
                <label>
                  Senha atual
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </label>
                <label>
                  Nova senha
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </label>
                <label>
                  Confirmar nova senha
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
                <div>
                  <button
                    type="button"
                    onClick={() => setChangingPassword(false)}
                  >
                    Cancelar
                  </button>
                  <button disabled={saving}>
                    <KeyRound size={14} /> Alterar senha
                  </button>
                </div>
              </form>
            )}
            <TwoFactorSettings
              apiUrl={API_URL}
              enabled={user.twoFactorEnabled}
              onChanged={(twoFactorEnabled) =>
                onUserUpdated({ ...user, twoFactorEnabled })
              }
            />
            {accountError && <div className="dialog-error">{accountError}</div>}
            {accountSuccess && (
              <div className="account-success">{accountSuccess}</div>
            )}
            <div className="security-note">
              <Shield size={19} />
              <div>
                <strong>Sessão protegida</strong>
                <p>
                  O login usa um cookie HttpOnly que não pode ser lido por
                  scripts no navegador.
                </p>
              </div>
              <Check size={18} />
            </div>
          </>
        ) : (
          <div className="preference-page">
            <h2>
              {settingSections.find((item) => item.id === section)?.label}
            </h2>
            {section === "profile" && (
              <div className="preference-card">
                <label>
                  Nome de exibição
                  <input
                    value={displayName}
                    maxLength={50}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <label>
                  Status personalizado
                  <input
                    value={status}
                    maxLength={80}
                    onChange={(event) => setStatus(event.target.value)}
                    placeholder="No que você está pensando?"
                  />
                </label>
                <label>
                  Sobre mim
                  <textarea
                    value={bio}
                    maxLength={190}
                    onChange={(event) => setBio(event.target.value)}
                  />
                </label>
                <button
                  className="settings-save"
                  onClick={() => void saveProfile()}
                  disabled={saving}
                >
                  <Save size={15} /> Salvar perfil
                </button>
              </div>
            )}
            {section === "privacy" && (
              <div className="preference-card">
                <SettingToggle
                  label="Notificações somente de menções"
                  description="Priorize mensagens que mencionam seu nome."
                  checked={preferences.mentionNotifications}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      mentionNotifications: value,
                    }))
                  }
                />
                <p className="preference-note">
                  <Shield size={16} /> Cookies HttpOnly, validação de origem e
                  autorização de canal permanecem ativos em todas as sessões.
                </p>
              </div>
            )}
            {section === "voice" && (
              <div className="preference-card">
                <DeviceSelect
                  label="Microfone"
                  kind="audioinput"
                  devices={devices}
                  value={preferences.inputDeviceId}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      inputDeviceId: value,
                    }))
                  }
                />
                <DeviceSelect
                  label="Saída de áudio"
                  kind="audiooutput"
                  devices={devices}
                  value={preferences.outputDeviceId}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      outputDeviceId: value,
                    }))
                  }
                />
                <DeviceSelect
                  label="Câmera"
                  kind="videoinput"
                  devices={devices}
                  value={preferences.cameraDeviceId}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      cameraDeviceId: value,
                    }))
                  }
                />
                <label>
                  Volume de entrada <strong>{preferences.inputVolume}%</strong>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={preferences.inputVolume}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        inputVolume: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Volume de saída <strong>{preferences.outputVolume}%</strong>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={preferences.outputVolume}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        outputVolume: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Qualidade do compartilhamento
                  <select
                    value={preferences.screenQuality}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        screenQuality: event.target.value as "720p" | "1080p",
                      }))
                    }
                  >
                    <option value="720p">720p — conexão limitada</option>
                    <option value="1080p">1080p — melhor qualidade</option>
                  </select>
                </label>
              </div>
            )}
            {section === "notifications" && (
              <div className="preference-card">
                <SettingToggle
                  label="Notificações do sistema"
                  description="Avise quando uma mensagem chegar com o VozLivre em segundo plano."
                  checked={preferences.desktopNotifications}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      desktopNotifications: value,
                    }))
                  }
                />
                <SettingToggle
                  label="Som de notificação"
                  description="Reproduza um aviso discreto para novas mensagens."
                  checked={preferences.notificationSound}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      notificationSound: value,
                    }))
                  }
                />
                <SettingToggle
                  label="Menções"
                  description="Destaque notificações que citam você."
                  checked={preferences.mentionNotifications}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      mentionNotifications: value,
                    }))
                  }
                />
              </div>
            )}
            {section === "appearance" && (
              <div className="preference-card">
                <label>
                  Tema
                  <select
                    value={preferences.theme}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        theme: event.target.value as UserSettings["theme"],
                      }))
                    }
                  >
                    <option value="dark">Escuro</option>
                    <option value="midnight">Meia-noite</option>
                    <option value="light">Claro</option>
                  </select>
                </label>
                <SettingToggle
                  label="Modo compacto"
                  description="Reduza o espaço vertical entre mensagens."
                  checked={preferences.compactMode}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      compactMode: value,
                    }))
                  }
                />
                <SettingToggle
                  label="Reduzir movimentos"
                  description="Desative transições e rolagens animadas."
                  checked={preferences.reducedMotion}
                  onChange={(value) =>
                    setPreferences((current) => ({
                      ...current,
                      reducedMotion: value,
                    }))
                  }
                />
              </div>
            )}
            {section !== "profile" && (
              <button
                className="settings-save"
                onClick={() => void savePreferences()}
                disabled={saving}
              >
                <Save size={15} />{" "}
                {saving ? "Salvando…" : "Salvar configurações"}
              </button>
            )}
            {accountError && <div className="dialog-error">{accountError}</div>}
            {accountSuccess && (
              <div className="account-success">{accountSuccess}</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`setting-toggle ${checked ? "selected" : ""}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <i>
        <b />
      </i>
    </button>
  );
}

function DeviceSelect({
  label,
  kind,
  devices,
  value,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (value: string) => void;
}) {
  const options = devices.filter((device) => device.kind === kind);
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Padrão do sistema</option>
        {options.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function Avatar({
  name,
  index,
  url,
}: {
  name: string;
  index: number;
  url?: string | null;
}) {
  const palette = ["#4967ff", "#ff735f", "#31b98d", "#927dff"];
  return (
    <div
      className="avatar message__avatar"
      style={{ background: palette[index % palette.length] }}
    >
      {url ? <img src={mediaUrl(url)} alt="" /> : name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="message-attachments">
      {attachments.map((attachment) => {
        const url = attachment.url.startsWith("http")
          ? attachment.url
          : `${API_URL}${attachment.url}`;
        if (attachment.mimeType.startsWith("image/"))
          return (
            <a key={attachment.id} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt={attachment.name} loading="lazy" />
            </a>
          );
        if (attachment.mimeType.startsWith("video/"))
          return (
            <video key={attachment.id} controls preload="metadata" src={url} />
          );
        if (attachment.mimeType.startsWith("audio/"))
          return (
            <audio key={attachment.id} controls preload="metadata" src={url} />
          );
        return (
          <a
            className="file-attachment"
            key={attachment.id}
            href={url}
            download={attachment.name}
          >
            <File size={22} />
            <span>
              <strong>{attachment.name}</strong>
              <small>{formatBytes(attachment.size)}</small>
            </span>
            <Download size={17} />
          </a>
        );
      })}
    </div>
  );
}

function formatBytes(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function messageDay(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function formatMessageDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function isCompactMessage(previous: Message | undefined, current: Message) {
  return Boolean(
    previous &&
    !current.replyTo &&
    previous.author === current.author &&
    messageDay(previous.createdAt) === messageDay(current.createdAt) &&
    new Date(current.createdAt).getTime() -
      new Date(previous.createdAt).getTime() <
      5 * 60 * 1000,
  );
}
export default App;
