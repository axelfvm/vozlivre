import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { SocialService } from './social.service';

class GroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  memberIds!: string[];
}

class RenameGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}

@Controller('social')
@UseGuards(AuthGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get()
  overview(@Req() request: AuthenticatedRequest) {
    return this.social.overview(request.user.id);
  }

  @Get('users')
  search(@Req() request: AuthenticatedRequest, @Query('q') query = '') {
    return this.social.searchUsers(request.user.id, query);
  }

  @Post('friends/:userId')
  requestFriend(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.social.requestFriend(request.user.id, userId);
  }

  @Post('friends/:friendshipId/accept')
  accept(
    @Req() request: AuthenticatedRequest,
    @Param('friendshipId') friendshipId: string,
  ) {
    return this.social.acceptFriend(request.user.id, friendshipId);
  }

  @Delete('friends/:friendshipId')
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('friendshipId') friendshipId: string,
  ) {
    return this.social.removeFriend(request.user.id, friendshipId);
  }

  @Post('blocks/:userId')
  block(@Req() request: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.social.block(request.user.id, userId);
  }

  @Delete('blocks/:userId')
  unblock(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.social.unblock(request.user.id, userId);
  }

  @Post('directs/:userId')
  direct(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.social.createDirect(request.user.id, userId);
  }

  @Post('groups')
  group(@Req() request: AuthenticatedRequest, @Body() input: GroupDto) {
    return this.social.createGroup(
      request.user.id,
      input.name,
      input.memberIds,
    );
  }

  @Patch('groups/:spaceId')
  renameGroup(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: RenameGroupDto,
  ) {
    return this.social.renameGroup(request.user.id, spaceId, input.name);
  }

  @Delete('groups/:spaceId')
  deleteGroup(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.social.deleteGroup(request.user.id, spaceId);
  }

  @Post('groups/:spaceId/members/:userId')
  addMember(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('userId') userId: string,
  ) {
    return this.social.addGroupMember(request.user.id, spaceId, userId);
  }

  @Delete('groups/:spaceId/members/:userId')
  removeMember(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('userId') userId: string,
  ) {
    return this.social.removeGroupMember(request.user.id, spaceId, userId);
  }
}
