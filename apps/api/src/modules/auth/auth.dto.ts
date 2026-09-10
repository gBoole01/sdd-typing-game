import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  validateResetTokenSchema,
} from '@typing-game/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * DTOs are derived from the schemas in `packages/contracts` — never declared
 * beside them. `z.infer` cannot drift from its schema; a hand-written twin can
 * (ARCHITECTURE.md § 2).
 */
export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class ValidateResetTokenDto extends createZodDto(validateResetTokenSchema) {}
