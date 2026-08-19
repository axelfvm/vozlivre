import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChannelKind } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { SpacesService } from './spaces.service';

class CreateChannelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsEnum(ChannelKind)
  kind!: ChannelKind;
}

class CreateSpaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}

@Controller()
@UseGuards(AuthGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get('spaces')
  list(@Req() request: AuthenticatedRequest) {
    return this.spaces.listForUser(request.user.id);
  }

  @Post('spaces')
  createSpace(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateSpaceDto,
  ) {
    return this.spaces.createSpace(request.user.id, input);
  }

  @Post('spaces/:spaceId/channels')
  createChannel(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: CreateChannelDto,
  ) {
    return this.spaces.createChannel(request.user.id, spaceId, input);
  }

  @Post('spaces/:spaceId/invites')
  async createInvite(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    const invite = await this.spaces.createInvite(request.user.id, spaceId);
    return {
      ...invite,
      inviteUrl: `${process.env.WEB_ORIGIN ?? 'http://localhost:5173'}/?invite=${invite.code}`,
    };
  }

  @Post('invites/:code/join')
  joinInvite(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
  ) {
    return this.spaces.joinByInvite(request.user.id, code);
  }
}
