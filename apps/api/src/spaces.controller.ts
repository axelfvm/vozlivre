import {
  Body,
  Controller,
  Get,
  Delete,
  Patch,
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
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
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

  @IsOptional()
  @IsString()
  categoryId?: string;
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
  @IsString({ each: true })
  roles!: string[];
}

class UpdateNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

class UpdateChannelDto extends UpdateNameDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  topic?: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;
}

class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

class CreateInviteDto {
  @IsOptional()
  @IsInt()
  expiresInDays?: number;

  @IsOptional()
  @IsInt()
  maxUses?: number;
}

class UpdateMemberDto {
  @IsIn(['admin', 'member'])
  role!: string;

  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
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

  @Get('spaces/:spaceId/manage')
  manage(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.spaces.management(request.user.id, spaceId);
  }

  @Patch('spaces/:spaceId')
  renameSpace(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: UpdateNameDto,
  ) {
    return this.spaces.renameSpace(
      request.user.id,
      spaceId,
      input.name,
      input.description,
    );
  }

  @Delete('spaces/:spaceId')
  deleteSpace(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.spaces.deleteSpace(request.user.id, spaceId);
  }

  @Post('spaces/:spaceId/roles')
  createRole(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: CreateRoleDto,
  ) {
    return this.spaces.createRole(request.user.id, spaceId, input);
  }

  @Patch('spaces/:spaceId/roles/:roleId')
  updateRole(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('roleId') roleId: string,
    @Body() input: CreateRoleDto,
  ) {
    return this.spaces.updateRole(request.user.id, spaceId, roleId, input);
  }

  @Delete('spaces/:spaceId/roles/:roleId')
  deleteRole(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.spaces.deleteRole(request.user.id, spaceId, roleId);
  }

  @Put('spaces/:spaceId/members/:memberId')
  updateMember(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
    @Body() input: UpdateMemberDto,
  ) {
    return this.spaces.updateMember(request.user.id, spaceId, memberId, input);
  }

  @Delete('spaces/:spaceId/members/:memberId')
  removeMember(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.spaces.removeMember(request.user.id, spaceId, memberId);
  }

  @Get('spaces/:spaceId/members')
  members(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.spaces.members(request.user.id, spaceId);
  }

  @Post('spaces/:spaceId/leave')
  leave(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.spaces.leaveSpace(request.user.id, spaceId);
  }

  @Post('spaces/:spaceId/transfer/:memberId')
  transfer(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.spaces.transferOwnership(request.user.id, spaceId, memberId);
  }

  @Post('spaces/:spaceId/channels')
  createChannel(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: CreateChannelDto,
  ) {
    return this.spaces.createChannel(request.user.id, spaceId, input);
  }

  @Patch('spaces/:spaceId/channels/:channelId')
  renameChannel(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('channelId') channelId: string,
    @Body() input: UpdateChannelDto,
  ) {
    return this.spaces.renameChannel(
      request.user.id,
      spaceId,
      channelId,
      input.name,
      input.topic,
      input.categoryId,
    );
  }

  @Delete('spaces/:spaceId/channels/:channelId')
  deleteChannel(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.spaces.deleteChannel(request.user.id, spaceId, channelId);
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
    @Body() input: CreateInviteDto,
  ) {
    const invite = await this.spaces.createInvite(
      request.user.id,
      spaceId,
      input,
    );
    return {
      ...invite,
      inviteUrl: `${parseWebOrigins(this.config.getOrThrow<string>('WEB_ORIGIN'))[0]}/?invite=${invite.code}`,
    };
  }

  @Get('spaces/:spaceId/invites')
  listInvites(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.spaces.listInvites(request.user.id, spaceId);
  }

  @Delete('spaces/:spaceId/invites/:inviteId')
  revokeInvite(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.spaces.revokeInvite(request.user.id, spaceId, inviteId);
  }

  @Post('invites/:code/join')
  joinInvite(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
  ) {
    return this.spaces.joinByInvite(request.user.id, code);
  }
}
