import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { CustomerJwtPayload } from './customer-jwt.payload';
import { MagicLinkToken } from './schemas/magic-link-token.schema';
import { CustomerRefreshToken } from './schemas/customer-refresh-token.schema';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantsService } from '../tenants/tenants.service';

const REFRESH_DAYS = 14;
const MAGIC_LINK_MINUTES = 15;

const ALLOWED_REDIRECT_BASE_PATTERNS: RegExp[] = [
  /^https?:\/\/([a-z0-9-]+\.)*kivoni\.com\.br$/i,
  /^https?:\/\/([a-z0-9-]+\.)*lmfit\.com\.br$/i,
  /^https?:\/\/([a-z0-9-]+\.)?localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
];

@Injectable()
export class CustomerAuthService {
  private readonly log = new Logger(CustomerAuthService.name);

  constructor(
    private readonly customers: CustomersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly tenants: TenantsService,
    @InjectModel(MagicLinkToken.name)
    private readonly magicLinkModel: Model<MagicLinkToken>,
    @InjectModel(CustomerRefreshToken.name)
    private readonly refreshModel: Model<CustomerRefreshToken>,
  ) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private resolveRedirectBase(redirectBase?: string): string {
    const fallback = this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    if (!redirectBase) return fallback;
    const ok = ALLOWED_REDIRECT_BASE_PATTERNS.some((re) => re.test(redirectBase));
    return ok ? redirectBase : fallback;
  }

  async requestMagicLink(tenantId: string, email: string, redirectBase?: string): Promise<{ ok: true }> {
    const normalized = email.trim().toLowerCase();
    const customer = await this.customers.findOrCreateByEmail(tenantId, normalized);

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(rawToken);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + MAGIC_LINK_MINUTES);
    await this.magicLinkModel.create({
      tenantId: new Types.ObjectId(tenantId),
      customerId: customer._id as Types.ObjectId,
      tokenHash,
      expiresAt,
    });

    const base = this.resolveRedirectBase(redirectBase);
    const link = `${base}/conta?token=${rawToken}`;

    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.log.log(`[dev] magic link for ${normalized}: ${link}`);
    }

    try {
      await this.notifications.sendEmail(
        normalized,
        'Seu link de acesso',
        `Clique para entrar na sua conta: ${link} (expira em ${MAGIC_LINK_MINUTES} minutos)`,
        `<p>Clique para entrar na sua conta:</p><p><a href="${link}">${link}</a></p><p>Expira em ${MAGIC_LINK_MINUTES} minutos.</p>`,
      );
    } catch (e) {
      // O token já foi criado e é válido mesmo se o envio falhar (ex.: domínio de e-mail não
      // verificado no provedor) — não derrubamos o pedido do comprador por uma falha de entrega,
      // que é uma preocupação de infraestrutura separada da criação do link em si.
      this.log.warn(`Failed to send magic link email to ${normalized}: ${(e as Error).message}`);
    }

    return { ok: true };
  }

  /**
   * Loop 18 — cliente já autenticado pede pra trocar de e-mail. Reusa exatamente o mesmo mecanismo
   * do login (token único, hash-at-rest, expira em `MAGIC_LINK_MINUTES`, `purpose` é o que
   * diferencia), mas manda o link pro e-mail NOVO — só quem realmente tem acesso a essa caixa de
   * entrada consegue confirmar a troca, mesmo que o e-mail já esteja pré-preenchido no formulário.
   */
  async requestEmailChange(
    tenantId: string,
    customerId: string,
    newEmail: string,
    redirectBase?: string,
  ): Promise<{ ok: true }> {
    const normalized = newEmail.trim().toLowerCase();
    const current = await this.customers.findOne(tenantId, customerId);
    if (current.email?.toLowerCase() === normalized) {
      throw new BadRequestException('Este já é o seu e-mail atual.');
    }
    const existing = await this.customers.findByEmail(tenantId, normalized);
    if (existing && String(existing._id) !== customerId) {
      throw new BadRequestException('Este e-mail já está em uso por outra conta.');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(rawToken);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + MAGIC_LINK_MINUTES);
    await this.magicLinkModel.create({
      tenantId: new Types.ObjectId(tenantId),
      customerId: new Types.ObjectId(customerId),
      tokenHash,
      expiresAt,
      purpose: 'email-change',
      pendingEmail: normalized,
    });

    const base = this.resolveRedirectBase(redirectBase);
    const link = `${base}/conta?token=${rawToken}`;

    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.log.log(`[dev] email-change link for ${normalized}: ${link}`);
    }

    try {
      await this.notifications.sendEmail(
        normalized,
        'Confirme seu novo e-mail',
        `Clique para confirmar que este é seu novo e-mail de acesso: ${link} (expira em ${MAGIC_LINK_MINUTES} minutos)`,
        `<p>Clique para confirmar que este é seu novo e-mail de acesso:</p><p><a href="${link}">${link}</a></p><p>Expira em ${MAGIC_LINK_MINUTES} minutos.</p>`,
      );
    } catch (e) {
      this.log.warn(`Failed to send email-change link to ${normalized}: ${(e as Error).message}`);
    }

    return { ok: true };
  }

  private async issueSession(tenantId: string, customerId: string) {
    const rawRefresh = randomBytes(48).toString('base64url');
    const tokenHash = this.hash(rawRefresh);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.refreshModel.create({
      tenantId: new Types.ObjectId(tenantId),
      customerId: new Types.ObjectId(customerId),
      tokenHash,
      expiresAt,
    });

    const payload: CustomerJwtPayload = { sub: customerId, tenantId };
    const accessToken = await this.jwt.signAsync({ ...payload });

    const customer = await this.customers.findOne(tenantId, customerId);
    return {
      accessToken,
      refreshToken: rawRefresh,
      customer: {
        id: String(customer._id),
        name: customer.name,
        email: customer.email ?? null,
      },
    };
  }

  async verifyMagicLink(tenantId: string, rawToken: string) {
    const tokenHash = this.hash(rawToken);
    const doc = await this.magicLinkModel
      .findOne({ tenantId: new Types.ObjectId(tenantId), tokenHash })
      .exec();
    if (!doc || doc.expiresAt < new Date()) {
      throw new UnauthorizedException('Link inválido ou expirado.');
    }
    await this.magicLinkModel.deleteOne({ _id: doc._id }).exec();

    // Loop 18 — clicar num link de troca de e-mail confirma a posse do e-mail novo E autentica:
    // trata igual a um login normal depois de gravar a mudança, pra funcionar mesmo se o clique
    // acontecer num navegador/dispositivo diferente do que pediu a troca (ex.: conferindo o e-mail
    // novo no celular enquanto a sessão original ficou aberta no notebook).
    if (doc.purpose === 'email-change' && doc.pendingEmail) {
      await this.customers.update(tenantId, String(doc.customerId), { email: doc.pendingEmail });
    }

    return this.issueSession(tenantId, String(doc.customerId));
  }

  async refresh(tenantId: string, refreshToken: string) {
    const tokenHash = this.hash(refreshToken);
    const doc = await this.refreshModel
      .findOne({ tenantId: new Types.ObjectId(tenantId), tokenHash })
      .exec();
    if (!doc || doc.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão expirada, faça login novamente.');
    }
    await this.refreshModel.deleteOne({ _id: doc._id }).exec();
    return this.issueSession(tenantId, String(doc.customerId));
  }

  async logout(tenantId: string, refreshToken: string) {
    const tokenHash = this.hash(refreshToken);
    await this.refreshModel
      .deleteOne({ tenantId: new Types.ObjectId(tenantId), tokenHash })
      .exec();
    return { ok: true };
  }

  async me(tenantId: string, customerId: string) {
    const customer = await this.customers.findOne(tenantId, customerId);
    const tenant = await this.tenants.findById(tenantId);
    return {
      id: String(customer._id),
      name: customer.name,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      loyaltyPoints: customer.loyaltyPoints ?? 0,
      storeCreditBalance: customer.storeCreditBalance ?? 0,
      redeemValuePerPoint: tenant?.loyalty?.redeemValuePerPoint ?? 0.01,
    };
  }
}
