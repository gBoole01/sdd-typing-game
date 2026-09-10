import {
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
  updateSettingsSchema,
  usernameAvailabilityQuerySchema,
} from '@typing-game/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class UpdateSettingsDto extends createZodDto(updateSettingsSchema) {}
export class DeleteAccountDto extends createZodDto(deleteAccountSchema) {}
export class UsernameAvailabilityDto extends createZodDto(usernameAvailabilityQuerySchema) {}
