import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from './prisma.service';
import { storedUploadName, uploadDirectory } from './uploads';

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(
      () => void this.cleanupAbandonedAttachments(),
      60 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async replaceAvatar(userId: string, storedName: string) {
    let current: { avatarUrl: string | null };
    const avatarUrl = `/uploads/${storedName}`;
    try {
      current = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarUrl: true },
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl },
      });
    } catch (error) {
      await this.remove(storedName);
      throw error;
    }
    const previous = storedUploadName(current.avatarUrl);
    if (previous && previous !== storedName) await this.remove(previous);
    return { avatarUrl };
  }

  async removeAvatar(userId: string) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    const previous = storedUploadName(current.avatarUrl);
    if (previous) await this.remove(previous);
    return { avatarUrl: null };
  }

  async removeMany(storedNames: string[]) {
    await Promise.all(
      [...new Set(storedNames)].map((name) => this.remove(name)),
    );
  }

  async validateImage(file: Express.Multer.File) {
    const handle = await open(join(uploadDirectory, file.filename), 'r');
    const header = Buffer.alloc(16);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const valid =
      (file.mimetype === 'image/png' &&
        header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (file.mimetype === 'image/jpeg' &&
        header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) ||
      (file.mimetype === 'image/gif' &&
        ['GIF87a', 'GIF89a'].includes(
          header.subarray(0, 6).toString('ascii'),
        )) ||
      (file.mimetype === 'image/webp' &&
        header.subarray(0, 4).toString('ascii') === 'RIFF' &&
        header.subarray(8, 12).toString('ascii') === 'WEBP');
    if (valid) return;
    await this.remove(file.filename);
    throw new BadRequestException(
      'O conteúdo do arquivo não é uma imagem válida.',
    );
  }

  async spaceUploads(spaceId: string) {
    const [space, stickers, attachments] = await Promise.all([
      this.prisma.space.findUnique({
        where: { id: spaceId },
        select: { iconUrl: true },
      }),
      this.prisma.spaceSticker.findMany({
        where: { spaceId },
        select: { storedName: true },
      }),
      this.prisma.messageAttachment.findMany({
        where: { message: { channel: { spaceId } } },
        select: { storedName: true },
      }),
    ]);
    const icon = storedUploadName(space?.iconUrl);
    return [
      ...(icon ? [icon] : []),
      ...stickers.map((item) => item.storedName),
      ...attachments.map((item) => item.storedName),
    ];
  }

  async channelUploads(channelId: string) {
    return this.prisma.messageAttachment
      .findMany({
        where: { message: { channelId } },
        select: { storedName: true },
      })
      .then((items) => items.map((item) => item.storedName));
  }

  async remove(storedName: string) {
    if (!/^[a-zA-Z0-9._-]+$/.test(storedName)) return;
    try {
      await unlink(join(uploadDirectory, storedName));
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code !== 'ENOENT') {
        this.logger.warn(`Não foi possível remover o arquivo ${storedName}.`);
      }
    }
  }

  async cleanupAbandonedAttachments() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const abandoned = await this.prisma.messageAttachment.findMany({
      where: { messageId: null, createdAt: { lt: cutoff } },
      select: { id: true, storedName: true },
      take: 500,
    });
    if (!abandoned.length) return 0;
    await this.prisma.messageAttachment.deleteMany({
      where: { id: { in: abandoned.map((item) => item.id) } },
    });
    await this.removeMany(abandoned.map((item) => item.storedName));
    return abandoned.length;
  }
}
