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
import { validateEnvironment } from './environment';
import { HealthController } from './health.controller';
import { SpaceChangeRegistry } from './space-change.registry';
import { ChatController } from './chat.controller';
import { MediaService } from './media.service';
import { ChatEventRegistry } from './chat-event.registry';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { CommunityFeaturesController } from './community-features.controller';
import { CommunityFeaturesService } from './community-features.service';
import { resolve } from 'node:path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '..', '..', '.env'),
      ],
      validate: validateEnvironment,
    }),
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
    ChatController,
    SocialController,
    CommunityFeaturesController,
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
    SpaceChangeRegistry,
    ChatEventRegistry,
    MediaService,
    SocialService,
    CommunityFeaturesService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
