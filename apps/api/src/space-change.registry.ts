import { Injectable } from '@nestjs/common';

type SpaceChangeListener = (spaceId: string) => void | Promise<void>;

@Injectable()
export class SpaceChangeRegistry {
  private readonly listeners = new Set<SpaceChangeListener>();

  subscribe(listener: SpaceChangeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async notify(spaceId: string) {
    await Promise.allSettled(
      [...this.listeners].map(async (listener) => listener(spaceId)),
    );
  }
}
