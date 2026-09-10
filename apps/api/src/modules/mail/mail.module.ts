import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema';
import { MemoryMailService } from './drivers/memory-mail.service';
import { MAIL_SERVICE, type MailService } from './mail.port';

/**
 * Driver selection happens once, at boot. The env schema already guarantees the
 * chosen driver has its credential (spec 002 § 5), so a misconfiguration fails
 * at startup rather than at the first password reset.
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_SERVICE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>): Promise<MailService> => {
        const driver = config.get('MAIL_DRIVER', { infer: true });
        const from = config.get('MAIL_FROM', { infer: true });

        if (driver === 'memory') return new MemoryMailService();

        if (driver === 'smtp') {
          const { SmtpMailService } = await import('./drivers/smtp-mail.service');
          return new SmtpMailService(config.get('SMTP_URL', { infer: true }) as string, from);
        }

        // Imported lazily so the AWS SDK is not loaded by a process that will
        // never send through it — which is every test run and every dev boot.
        const { SesMailService } = await import('./drivers/ses-mail.service');
        return new SesMailService(
          config.get('AWS_REGION', { infer: true }) as string,
          from,
          config.get('SES_CONFIGURATION_SET', { infer: true }),
        );
      },
    },
  ],
  exports: [MAIL_SERVICE],
})
export class MailModule {}
