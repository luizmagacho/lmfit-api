import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  private resendClient: Resend | null = null;

  constructor(private readonly config: ConfigService) {}

  private getResend(): Resend | null {
    if (this.resendClient) return this.resendClient;
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) return null;
    this.resendClient = new Resend(apiKey);
    return this.resendClient;
  }

  async sendEmail(to: string | string[], subject: string, text: string, html?: string): Promise<void> {
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
    const from = this.config.get<string>('SMTP_FROM') ?? 'noreply@kivoni.local';
    const toAddresses = typeof to === 'string' ? to.split(',').map((s) => s.trim()) : to;
    await transporter.sendMail({
      from,
      to: toAddresses,
      subject,
      text,
      html,
    });
    this.log.log(`Email sent to ${toAddresses.join(', ')}: ${subject}`);
  }

  async sendStaffEmail(subject: string, text: string): Promise<void> {
    const to = this.config.get<string>('STAFF_NOTIFY_EMAILS');
    if (!to?.trim()) {
      this.log.debug('STAFF_NOTIFY_EMAILS not set; skip email');
      return;
    }
    await this.sendEmail(to, subject, text);
  }

  logStaffAlert(message: string, meta?: Record<string, unknown>) {
    this.log.warn(`${message} ${meta ? JSON.stringify(meta) : ''}`);
  }

  /**
   * Loop 37 — e-mail de "esqueci minha senha" via Resend (API HTTP, não SMTP — mais confiável
   * pra transacional e com melhor deliverability que `sendEmail`/nodemailer). Sem `RESEND_API_KEY`
   * configurada, apenas loga e retorna (mesmo padrão de degradação graciosa de `sendEmail` sem
   * `SMTP_HOST`) — o token já foi criado e continua válido, só o e-mail não sai.
   */
  async sendPasswordResetEmail(to: string, resetLink: string, tenantName: string): Promise<void> {
    const resend = this.getResend();
    if (!resend) {
      this.log.warn('RESEND_API_KEY not set; skip password reset email');
      return;
    }
    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Kivoni <onboarding@resend.dev>';
    const subject = `Redefinir senha — ${tenantName}`;
    const text = `Recebemos um pedido para redefinir a senha da sua conta em ${tenantName}.\n\nClique no link abaixo para criar uma nova senha (válido por 30 minutos):\n${resetLink}\n\nSe você não pediu isso, pode ignorar este e-mail — sua senha atual continua válida.`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 32px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #7c3aed, #6d28d9);">
            <span style="color: #ffffff; font-size: 22px; font-weight: 700; line-height: 48px;">K</span>
          </div>
        </div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; text-align: center; margin: 0 0 8px;">Redefinir sua senha</h1>
        <p style="font-size: 14px; color: #64748b; text-align: center; margin: 0 0 32px; line-height: 1.6;">
          Recebemos um pedido para redefinir a senha da sua conta em <strong style="color: #334155;">${tenantName}</strong>.
        </p>
        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${resetLink}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 10px;">
            Criar nova senha
          </a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0 0 24px;">
          Este link expira em 30 minutos. Se você não pediu essa alteração, pode ignorar este e-mail — sua senha atual continua válida.
        </p>
        <p style="font-size: 11px; color: #cbd5e1; text-align: center; word-break: break-all; margin: 0 0 32px;">
          Ou copie e cole no navegador:<br>${resetLink}
        </p>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center;">
          <p style="font-size: 11px; color: #cbd5e1; margin: 0;">Equipe Kivoni</p>
        </div>
      </div>
    `;
    // O SDK da Resend NÃO lança exceção pra erros da própria API (chave inválida, domínio não
    // verificado, remetente rejeitado etc.) — devolve `{ data, error }`. Sem checar `error` aqui,
    // uma falha da Resend passaria batido como sucesso (só uma exception de rede/transporte cairia
    // no catch de quem chama este método).
    const { error } = await resend.emails.send({ from, to, subject, text, html });
    if (error) {
      throw new Error(`Resend rejected the email: ${error.message}`);
    }
    this.log.log(`Password reset email sent to ${to}`);
  }
}
