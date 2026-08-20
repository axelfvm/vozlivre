import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { CommunityFeaturesService } from './community-features.service';
import { imageFileFilter, uploadStorage } from './uploads';

class NameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}

class ChannelOrderDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;
}

class ReorderDto {
  @IsArray()
  @IsString({ each: true })
  categoryIds!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChannelOrderDto)
  channels!: ChannelOrderDto[];
}

class ArchiveDto {
  @IsBoolean()
  archived!: boolean;
}

class TimeoutDto {
  @IsInt()
  @Min(0)
  minutes!: number;
}

class BanDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

@Controller()
@UseGuards(AuthGuard)
export class CommunityFeaturesController {
  constructor(private readonly features: CommunityFeaturesService) {}

  @Post('spaces/:spaceId/categories')
  createCategory(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: NameDto,
  ) {
    return this.features.createCategory(request.user.id, spaceId, input.name);
  }

  @Patch('spaces/:spaceId/categories/:categoryId')
  updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
    @Body() input: NameDto,
  ) {
    return this.features.updateCategory(
      request.user.id,
      spaceId,
      categoryId,
      input.name,
    );
  }

  @Delete('spaces/:spaceId/categories/:categoryId')
  deleteCategory(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.features.deleteCategory(request.user.id, spaceId, categoryId);
  }

  @Put('spaces/:spaceId/order')
  reorder(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: ReorderDto,
  ) {
    return this.features.reorder(request.user.id, spaceId, input);
  }

  @Post('messages/:messageId/thread')
  createThread(
    @Req() request: AuthenticatedRequest,
    @Param('messageId') messageId: string,
    @Body() input: NameDto,
  ) {
    return this.features.createThread(request.user.id, messageId, input.name);
  }

  @Get('channels/:channelId/threads')
  threads(
    @Req() request: AuthenticatedRequest,
    @Param('channelId') channelId: string,
  ) {
    return this.features.threads(request.user.id, channelId);
  }

  @Patch('threads/:threadId')
  archiveThread(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() input: ArchiveDto,
  ) {
    return this.features.setThreadArchived(
      request.user.id,
      threadId,
      input.archived,
    );
  }

  @Get('spaces/:spaceId/moderation')
  moderation(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.features.moderation(request.user.id, spaceId);
  }

  @Put('spaces/:spaceId/members/:memberId/timeout')
  timeout(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
    @Body() input: TimeoutDto,
  ) {
    return this.features.timeoutMember(
      request.user.id,
      spaceId,
      memberId,
      input.minutes,
    );
  }

  @Post('spaces/:spaceId/bans/:memberId')
  ban(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
    @Body() input: BanDto,
  ) {
    return this.features.banMember(
      request.user.id,
      spaceId,
      memberId,
      input.reason ?? '',
    );
  }

  @Delete('spaces/:spaceId/bans/:memberId')
  unban(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.features.unbanMember(request.user.id, spaceId, memberId);
  }

  @Get('spaces/:spaceId/audit')
  audit(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.features.auditLog(request.user.id, spaceId);
  }

  @Get('channels/:channelId/mentions')
  mentions(
    @Req() request: AuthenticatedRequest,
    @Param('channelId') channelId: string,
  ) {
    return this.features.mentions(request.user.id, channelId);
  }

  @Get('spaces/:spaceId/stickers')
  stickers(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.features.stickers(request.user.id, spaceId);
  }

  @Post('spaces/:spaceId/stickers')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
      fileFilter: imageFileFilter,
    }),
  )
  createSticker(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() input: NameDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Selecione uma imagem.');
    return this.features.createSticker(
      request.user.id,
      spaceId,
      input.name,
      file,
    );
  }

  @Delete('spaces/:spaceId/stickers/:stickerId')
  deleteSticker(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('stickerId') stickerId: string,
  ) {
    return this.features.deleteSticker(request.user.id, spaceId, stickerId);
  }

  @Post('spaces/:spaceId/icon')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: imageFileFilter,
    }),
  )
  async icon(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Selecione uma imagem.');
    await this.features.validateImage(file);
    return this.features.updateSpaceIcon(
      request.user.id,
      spaceId,
      file.filename,
    );
  }

  @Delete('spaces/:spaceId/icon')
  removeIcon(
    @Req() request: AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.features.removeSpaceIcon(request.user.id, spaceId);
  }
}
