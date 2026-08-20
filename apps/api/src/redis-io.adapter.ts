import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private publisher?: ReturnType<typeof createClient>;
  private subscriber?: ReturnType<typeof createClient>;

  constructor(
    app: INestApplicationContext,
    private readonly url: string,
  ) {
    super(app);
  }

  async connect() {
    this.publisher = createClient({ url: this.url });
    this.subscriber = this.publisher.duplicate();
    this.publisher.on('error', (error: Error) =>
      this.logger.error(`Redis publisher: ${error.message}`),
    );
    this.subscriber.on('error', (error: Error) =>
      this.logger.error(`Redis subscriber: ${error.message}`),
    );
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    this.adapterConstructor = createAdapter(this.publisher, this.subscriber);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async close(server: Server) {
    await super.close(server);
    await Promise.allSettled([
      this.subscriber?.isOpen ? this.subscriber.quit() : Promise.resolve(),
      this.publisher?.isOpen ? this.publisher.quit() : Promise.resolve(),
    ]);
  }
}
