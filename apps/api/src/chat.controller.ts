import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { ChatService } from './chat.service';
import { attachmentFileFilter, uploadStorage } from './uploads';

@Controller()
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('channels/:channelId/messages/search')
  search(
    @Req() request: AuthenticatedRequest,
    @Param('channelId') channelId: string,
    @Query('q') query = '',
  ) {
    return this.chat.search(request.user.id, channelId, query);
  }

  @Get('channels/:channelId/pins')
  pins(
    @Req() request: AuthenticatedRequest,
    @Param('channelId') channelId: string,
  ) {
    return this.chat.pins(request.user.id, channelId);
  }

  @Post('messages/:messageId/pin')
  pin(
    @Req() request: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    return this.chat.setPinned(request.user.id, messageId, true);
  }

  @Delete('messages/:messageId/pin')
  unpin(
    @Req() request: AuthenticatedRequest,
    @Param('messageId') messageId: string,
  ) {
    return this.chat.setPinned(request.user.id, messageId, false);
  }

  @Post('channels/:channelId/read')
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param('channelId') channelId: string,
  ) {
    return this.chat.markRead(request.user.id, channelId);
  }

  @Post('channels/:channelId/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
      fileFilter: attachmentFileFilter,
    }),
  )
  upload(
    @Req() request: AuthenticatedRequest,
    @Param('channelId') channelId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Selecione um arquivo.');
    return this.chat.registerAttachment(request.user.id, channelId, file);
  }

  @Delete('attachments/:attachmentId')
  cancelAttachment(
    @Req() request: AuthenticatedRequest,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.chat.cancelAttachment(request.user.id, attachmentId);
  }
}
