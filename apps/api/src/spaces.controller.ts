import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChannelKind } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { SpacesService } from './spaces.service';
import { ConfigService } from '@nestjs/config';
import { parseWebOrigins } from './environment';

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

class UpdateChannelAccessDto {
  @IsBoolean()
  restricted!: boolean;

  @IsArray()
  @IsString({ each: true })
  memberIds!: string[];

  @IsArray()
  @IsIn(['owner', 'admin', 'member'], { each: true })
  roles!: string[];
}

@Controller()
@UseGuards(AuthGuard)
export class SpacesController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly config: ConfigService,
  ) {}

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

  @Get('spaces/:spaceId/channels/:channelId/access')
  channelAccess(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.spaces.channelAccess(request.user.id, spaceId, channelId);
  }

  @Put('spaces/:spaceId/channels/:channelId/access')
  updateChannelAccess(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('channelId') channelId: string,
    @Body() input: UpdateChannelAccessDto,
  ) {
    return this.spaces.updateChannelAccess(
      request.user.id,
      spaceId,
      channelId,
      input,
    );
  }

  @Post('spaces/:spaceId/invites')
  async createInvite(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    const invite = await this.spaces.createInvite(request.user.id, spaceId);
    return {
      ...invite,
      inviteUrl: `${parseWebOrigins(this.config.getOrThrow<string>('WEB_ORIGIN'))[0]}/?invite=${invite.code}`,
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
