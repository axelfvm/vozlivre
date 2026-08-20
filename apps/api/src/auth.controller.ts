import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Delete,
  Post,
  Patch,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsEmail,
  IsNotEmpty,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { imageFileFilter, uploadStorage } from './uploads';

class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  displayName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password!: string;
}

class TwoFactorLoginDto {
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;
}

class TwoFactorCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  code!: string;
}

class DisableTwoFactorDto extends TwoFactorCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password!: string;
}

class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(190)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  status?: string;
}

class UpdateSettingsDto {
  @IsOptional() @IsIn(['dark', 'midnight', 'light']) theme?:
    'dark' | 'midnight' | 'light';
  @IsOptional() @IsBoolean() compactMode?: boolean;
  @IsOptional() @IsBoolean() reducedMotion?: boolean;
  @IsOptional() @IsBoolean() desktopNotifications?: boolean;
  @IsOptional() @IsBoolean() notificationSound?: boolean;
  @IsOptional() @IsBoolean() mentionNotifications?: boolean;
  @IsOptional() @IsString() @MaxLength(255) inputDeviceId?: string;
  @IsOptional() @IsString() @MaxLength(255) outputDeviceId?: string;
  @IsOptional() @IsString() @MaxLength(255) cameraDeviceId?: string;
  @IsOptional() @IsInt() inputVolume?: number;
  @IsOptional() @IsInt() outputVolume?: number;
  @IsOptional() @IsIn(['720p', '1080p']) screenQuality?: '720p' | '1080p';
}

class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly media: MediaService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body() input: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(input);
    this.setSession(response, result.token);
    return { user: result.user };
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input);
    if (result.requiresTwoFactor)
      return {
        requiresTwoFactor: true,
        challengeToken: result.challengeToken,
      };
    this.setSession(response, result.token);
    return { requiresTwoFactor: false, user: result.user };
  }

  @Post('login/2fa')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async completeTwoFactorLogin(
    @Body() input: TwoFactorLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.completeTwoFactor(
      input.challengeToken,
      input.code,
    );
    this.setSession(response, result.token);
    return { user: result.user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return { user: request.user };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeSession(request.user.id, request.sessionId);
    response.clearCookie('vozlivre_session', { path: '/' });
    return { ok: true };
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(request.user.id, input);
  }

  @Patch('settings')
  @UseGuards(AuthGuard)
  updateSettings(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateSettingsDto,
  ) {
    return this.auth.updateSettings(request.user.id, input);
  }

  @Post('password')
  @UseGuards(AuthGuard)
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() input: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      request.user.id,
      input.currentPassword,
      input.newPassword,
    );
  }

  @Post('2fa/setup')
  @UseGuards(AuthGuard)
  setupTwoFactor(@Req() request: AuthenticatedRequest) {
    return this.auth.beginTwoFactorSetup(request.user.id);
  }

  @Post('2fa/enable')
  @UseGuards(AuthGuard)
  enableTwoFactor(
    @Req() request: AuthenticatedRequest,
    @Body() input: TwoFactorCodeDto,
  ) {
    return this.auth.enableTwoFactor(request.user.id, input.code);
  }

  @Post('2fa/disable')
  @UseGuards(AuthGuard)
  disableTwoFactor(
    @Req() request: AuthenticatedRequest,
    @Body() input: DisableTwoFactorDto,
  ) {
    return this.auth.disableTwoFactor(
      request.user.id,
      input.password,
      input.code,
    );
  }

  @Post('avatar')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: imageFileFilter,
    }),
  )
  async uploadAvatar(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Selecione uma imagem.');
    await this.media.validateImage(file);
    return this.media.replaceAvatar(request.user.id, file.filename);
  }

  @Delete('avatar')
  @UseGuards(AuthGuard)
  removeAvatar(@Req() request: AuthenticatedRequest) {
    return this.media.removeAvatar(request.user.id);
  }

  private setSession(response: Response, token: string) {
    const production = this.config.get<string>('NODE_ENV') === 'production';
    response.cookie('vozlivre_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: production,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}
