import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtUserPayload } from './jwt-user.payload';
import { RefreshToken } from './schemas/refresh-token.schema';
import { UsersService } from '../users/users.service';
import type { UserRole } from '../users/schemas/user.schema';
import { normalizeRoleForJwt } from '../users/user-role.utils';

const REFRESH_DAYS = 14;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(RefreshToken.name)
    private readonly refreshModel: Model<RefreshToken>,
  ) {}

  private hashRefresh(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
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
    });

    const role = normalizeRoleForJwt(user.role as UserRole);
    const payload: JwtUserPayload = {
      sub: String(user._id),
      email: user.email,
      role,
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

    const user = await this.users.findById(String(doc.userId));
    if (!user) throw new UnauthorizedException('User not found');

    const rawRefresh = randomBytes(48).toString('base64url');
    const newHash = this.hashRefresh(rawRefresh);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.refreshModel.create({
      userId: user._id as Types.ObjectId,
      tokenHash: newHash,
      expiresAt,
    });

    const role = normalizeRoleForJwt(user.role as UserRole);
    const payload: JwtUserPayload = {
      sub: String(user._id),
      email: user.email,
      role,
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
      },
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashRefresh(refreshToken);
    await this.refreshModel.deleteOne({ tokenHash }).exec();
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: normalizeRoleForJwt(user.role as UserRole),
    };
  }
}
