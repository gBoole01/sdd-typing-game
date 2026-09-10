import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CredentialsService } from '../auth/credentials.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, CredentialsService],
})
export class UsersModule {}
