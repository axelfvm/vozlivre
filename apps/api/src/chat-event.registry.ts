import { Injectable } from '@nestjs/common';

type ChatEventListener = (
  channelId: string,
  event: string,
  payload: unknown,
) => void | Promise<void>;

@Injectable()
export class ChatEventRegistry {
  private readonly listeners = new Set<ChatEventListener>();

  subscribe(listener: ChatEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async notify(channelId: string, event: string, payload: unknown) {
    await Promise.allSettled(
      [...this.listeners].map(async (listener) =>
        listener(channelId, event, payload),
      ),
    );
  }
}
