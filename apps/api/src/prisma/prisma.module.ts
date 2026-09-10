import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * The one legitimate global module: every domain module needs it, and importing
 * it everywhere is noise without benefit (spec 002 § 5).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
