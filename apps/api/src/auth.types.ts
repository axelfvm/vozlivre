export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
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
