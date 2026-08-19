import { Injectable } from '@nestjs/common';

type SessionListener = (
  userId: string,
  message: string,
) => void | Promise<void>;

@Injectable()
export class SessionRegistry {
  private readonly listeners = new Set<SessionListener>();

  subscribe(listener: SessionListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async invalidateConnections(userId: string, message: string) {
    await Promise.allSettled(
      [...this.listeners].map((listener) => listener(userId, message)),
    );
  }
}
