import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AccessToken } from 'livekit-server-sdk';
import { ChannelKind } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { SpacesService } from './spaces.service';

class VoiceTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  channelId!: string;
}

@Controller('voice')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly config: ConfigService,
  ) {}

  @Post('token')
  async createToken(
    @Body() input: VoiceTokenDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const channel = await this.spaces.accessibleChannel(
      request.user.id,
      input.channelId,
      ChannelKind.VOICE,
    );
    const key = this.config.getOrThrow<string>('LIVEKIT_API_KEY');
    const secret = this.config.getOrThrow<string>('LIVEKIT_API_SECRET');
    const token = new AccessToken(key, secret, {
      identity: `${request.user.id}:${request.sessionId}`,
      name: request.user.displayName,
      ttl: '15m',
    });

    token.addGrant({
      roomJoin: true,
      room: `vozlivre-channel-${channel.id}`,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return {
      token: await token.toJwt(),
      room: `vozlivre-channel-${channel.id}`,
    };
  }
}
