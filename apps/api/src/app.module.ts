import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { VoiceController } from './voice.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { SessionRegistry } from './session.registry';
import { MediaSessionCleaner } from './media-session-cleaner';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import { VoicePresenceService } from './voice-presence.service';
import { validateEnvironment } from './environment';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    AppController,
    AuthController,
    VoiceController,
    SpacesController,
    HealthController,
  ],
  providers: [
    AppService,
    AuthService,
    AuthGuard,
    ChatGateway,
    ChatService,
    PrismaService,
    SessionRegistry,
    MediaSessionCleaner,
    SpacesService,
    VoicePresenceService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
