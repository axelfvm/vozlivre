import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatGateway } from './chat.gateway';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('JWT_SECRET') ??
          'vozlivre-local-jwt-secret-change-before-production',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    AppController,
    AuthController,
    VoiceController,
    SpacesController,
  ],
  providers: [
    AppService,
    AuthService,
    AuthGuard,
    ChatGateway,
    PrismaService,
    SessionRegistry,
    MediaSessionCleaner,
    SpacesService,
    VoicePresenceService,
  ],
})
export class AppModule {}
