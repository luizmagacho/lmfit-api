import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtUserPayload } from './jwt-user.payload';
import { RefreshToken } from './schemas/refresh-token.schema';
import { PasswordResetToken } from './schemas/password-reset-token.schema';
import { UsersService } from '../users/users.service';
import type { UserRole } from '../users/schemas/user.schema';
import { normalizeRoleForJwt } from '../users/user-role.utils';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantsService } from '../tenants/tenants.service';

const REFRESH_DAYS = 14;
const PASSWORD_RESET_MINUTES = 30;

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly tenants: TenantsService,
    @InjectModel(RefreshToken.name)
    private readonly refreshModel: Model<RefreshToken>,
    @InjectModel(PasswordResetToken.name)
    private readonly passwordResetModel: Model<PasswordResetToken>,
  ) {}

  private hashRefresh(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Base pública do próprio tenant (`https://<slug>.kivoni.com.br`) pra montar o link de reset —
   *  nunca aceita uma base vinda do cliente (evitaria open redirect); em dev sem subdomínio real,
   *  cai pra `WEB_ORIGIN`. */
  private resolveTenantWebOrigin(slug: string): string {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    if (isProd) return `https://${slug}.kivoni.com.br`;
    return this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
  }

  /**
   * Loop 37 — nunca revela se o e-mail existe (mesma resposta `{ok:true}` sempre, com ou sem
   * usuário encontrado) — evita enumeração de contas. `tenantId` vem SEMPRE do `@TenantId()` do
   * controller (subdomínio/header), nunca do corpo da requisição: é o que garante que o lookup e o
   * e-mail disparado são sempre do tenant certo, mesmo que o mesmo e-mail exista em outro tenant.
   */
  async forgotPassword(tenantId: string, email: string): Promise<{ ok: true }> {
    const user = await this.users.findByEmail(tenantId, email);
    if (!user) return { ok: true };

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashRefresh(rawToken);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + PASSWORD_RESET_MINUTES);
    await this.passwordResetModel.create({
      tenantId: new Types.ObjectId(tenantId),
      userId: user._id as Types.ObjectId,
      tokenHash,
      expiresAt,
    });

    const tenant = await this.tenants.findById(tenantId);
    const base = this.resolveTenantWebOrigin(tenant.slug);
    const link = `${base}/reset-password?token=${rawToken}`;

    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.log.log(`[dev] password reset link for ${email}: ${link}`);
    }

    try {
      await this.notifications.sendPasswordResetEmail(user.email, link, tenant.name);
    } catch (e) {
      // Mesmo racional do magic link: o token já foi criado e é válido mesmo se o envio falhar
      // (ex.: Resend fora do ar) — a criação do token é uma preocupação separada da entrega.
      this.log.warn(`Failed to send password reset email to ${user.email}: ${(e as Error).message}`);
    }

    return { ok: true };
  }

  /**
   * Consome o token (sempre escopado por `tenantId`, igual `verifyMagicLink`), grava a nova senha
   * via `UsersService.update` (que já escopa `{_id, tenantId}` no `findOneAndUpdate`), e desloga
   * todas as outras sessões do usuário — depois de uma troca de senha, nenhuma sessão antiga (que
   * pode ter sido a via de comprometimento) deve continuar valendo.
   */
  async resetPassword(tenantId: string, rawToken: string, newPassword: string): Promise<{ ok: true }> {
    const tokenHash = this.hashRefresh(rawToken);
    const doc = await this.passwordResetModel
      .findOne({ tenantId: new Types.ObjectId(tenantId), tokenHash })
      .exec();
    if (!doc || doc.expiresAt < new Date()) {
      throw new BadRequestException('Link inválido ou expirado. Solicite um novo.');
    }
    await this.passwordResetModel.deleteOne({ _id: doc._id }).exec();

    await this.users.update(tenantId, String(doc.userId), { password: newPassword });
    await this.refreshModel.deleteMany({ userId: doc.userId }).exec();

    return { ok: true };
  }

  async login(tenantId: string, email: string, password: string) {
    const user = await this.users.findByEmail(tenantId, email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const rawRefresh = randomBytes(48).toString('base64url');
    const tokenHash = this.hashRefresh(rawRefresh);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.refreshModel.create({
      userId: user._id as Types.ObjectId,
      tokenHash,
      expiresAt,
      tenantId: user.tenantId as Types.ObjectId,
    });

    const role = normalizeRoleForJwt(user.role as UserRole);
    const locationId = user.assignedLocationId ? String(user.assignedLocationId) : undefined;
    const payload: JwtUserPayload = {
      sub: String(user._id),
      email: user.email,
      role,
      tenantId: String(user.tenantId),
      locationId,
    };
    const accessToken = await this.jwt.signAsync(
      { ...payload },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES') ?? '15m',
      } as never,
    );

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role,
        tenantId: String(user.tenantId),
        locationId,
      },
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashRefresh(refreshToken);
    const doc = await this.refreshModel.findOne({ tokenHash }).exec();
    if (!doc || doc.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.refreshModel.deleteOne({ _id: doc._id }).exec();

    const user = await this.users.findById(undefined, String(doc.userId));
    if (!user) throw new UnauthorizedException('User not found');

    const rawRefresh = randomBytes(48).toString('base64url');
    const newHash = this.hashRefresh(rawRefresh);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.refreshModel.create({
      userId: user._id as Types.ObjectId,
      tokenHash: newHash,
      expiresAt,
      tenantId: user.tenantId as Types.ObjectId,
    });

    const role = normalizeRoleForJwt(user.role as UserRole);
    const locationId = user.assignedLocationId ? String(user.assignedLocationId) : undefined;
    const payload: JwtUserPayload = {
      sub: String(user._id),
      email: user.email,
      role,
      tenantId: String(user.tenantId),
      locationId,
    };
    const accessToken = await this.jwt.signAsync(
      { ...payload },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES') ?? '15m',
      } as never,
    );

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role,
        tenantId: String(user.tenantId),
        locationId,
      },
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashRefresh(refreshToken);
    await this.refreshModel.deleteOne({ tokenHash }).exec();
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.users.findById(undefined, userId);
    if (!user) throw new UnauthorizedException();
    return {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: normalizeRoleForJwt(user.role as UserRole),
      tenantId: String(user.tenantId),
      locationId: user.assignedLocationId ? String(user.assignedLocationId) : undefined,
      hasSeenTour: user.hasSeenTour === true,
    };
  }

  async markTourSeen(userId: string) {
    await this.users.markTourSeen(userId);
    return { ok: true };
  }
}
