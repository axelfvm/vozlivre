import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const uploadDirectory = join(process.cwd(), 'uploads');
mkdirSync(uploadDirectory, { recursive: true });

export const uploadStorage = diskStorage({
  destination: uploadDirectory,
  filename: (_request, file, callback) =>
    callback(null, `${randomUUID()}${extensionForMime(file.mimetype)}`),
});

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.weba',
  'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/octet-stream': '.bin',
};

export function imageFileFilter(
  _request: Express.Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  const allowed = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ].includes(file.mimetype);
  callback(
    allowed ? null : new BadRequestException('Envie uma imagem válida.'),
    allowed,
  );
}

export function attachmentFileFilter(
  _request: Express.Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  const allowed = Boolean(MIME_EXTENSIONS[file.mimetype]);
  callback(
    allowed ? null : new BadRequestException('Tipo de arquivo não permitido.'),
    allowed,
  );
}

export function storedUploadName(url: string | null | undefined) {
  return url?.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null;
}

function extensionForMime(mimeType: string) {
  return MIME_EXTENSIONS[mimeType] ?? '.bin';
}
