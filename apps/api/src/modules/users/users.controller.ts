import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type {
  DeviceSessionList,
  Settings,
  UserProfile,
  UsernameAvailability,
} from '@typing-game/contracts';
import type { Response } from 'express';

import type { AuthContext } from '../../common/auth/auth-context';
import { CookieService } from '../../common/cookies/cookie.service';
import { CurrentAuth } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { MINUTE, RateLimit, perIp } from '../../common/rate-limit/rate-limit';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  UpdateProfileDto,
  UpdateSettingsDto,
  UsernameAvailabilityDto,
} from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly cookies: CookieService,
  ) {}

  @Get('me')
  me(@CurrentAuth() auth: AuthContext): UserProfile {
    return this.users.profile(auth);
  }

  @Patch('me')
  updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body() body: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.users.updateProfile(auth, body);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    return this.users.changePassword(auth, body);
  }

  @Patch('me/settings')
  updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Body() body: UpdateSettingsDto,
  ): Promise<Settings> {
    return this.users.updateSettings(auth, body);
  }

  @Get('me/sessions')
  listSessions(@CurrentAuth() auth: AuthContext): Promise<DeviceSessionList> {
    return this.users.listSessions(auth);
  }

  @Delete('me/sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { wasCurrent } = await this.users.revokeSession(auth, id);

    // US-5.5 — revoking one's own current session behaves exactly like logout.
    if (wasCurrent) this.cookies.clearSession(response);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @CurrentAuth() auth: AuthContext,
    @Body() body: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.users.deleteAccount(auth, body);
    this.cookies.clearSession(response);
  }

  /** Rate-limited by design so it cannot be used to enumerate the user list. */
  @Public()
  @Get('username-available')
  @RateLimit(perIp(30, MINUTE))
  usernameAvailable(@Query() query: UsernameAvailabilityDto): Promise<UsernameAvailability> {
    return this.users.usernameAvailability(query.username);
  }
}
