export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  status: string;
  settings: UserSettings;
  twoFactorEnabled: boolean;
};

export type UserSettings = {
  theme: 'dark' | 'midnight' | 'light';
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
  screenQuality: '720p' | '1080p';
};

export type SessionPayload = {
  sub: string;
  email: string;
  sid: string;
};

export type AuthSession = {
  user: AuthUser;
  sessionId: string;
};
