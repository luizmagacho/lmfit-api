import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendStaffEmail(subject: string, text: string): Promise<void> {
    const to = this.config.get<string>('STAFF_NOTIFY_EMAILS');
    if (!to?.trim()) {
      this.log.debug('STAFF_NOTIFY_EMAILS not set; skip email');
      return;
    }
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.log.warn('SMTP_HOST not set; skip email');
      return;
    }
    const transporter = nodemailer.createTransport({
      host,
      port: Number(this.config.get('SMTP_PORT') ?? 587),
      secure: this.config.get('SMTP_SECURE') === 'true',
      auth: this.config.get('SMTP_USER')
        ? {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
    const from = this.config.get<string>('SMTP_FROM') ?? 'noreply@lmfit.local';
    await transporter.sendMail({
      from,
      to: to.split(',').map((s) => s.trim()),
      subject,
      text,
    });
    this.log.log(`Staff email sent: ${subject}`);
  }

  logStaffAlert(message: string, meta?: Record<string, unknown>) {
    this.log.warn(`${message} ${meta ? JSON.stringify(meta) : ''}`);
  }
}
