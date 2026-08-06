import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CustomerAuthService } from './customer-auth.service';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { CustomerRefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('public-customer-auth')
@Controller('public/customer-auth')
export class PublicCustomerAuthController {
  constructor(private readonly customerAuth: CustomerAuthService) {}

  // Loop 10 — mesmo limite de auth.controller.ts's login (15/min): dispara e-mail real por
  // chamada, alvo clássico de spam/abuso se deixado só no limite geral de 120/min.
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('request-link')
  requestLink(@Body() dto: RequestMagicLinkDto, @TenantId() tenantId: string) {
    return this.customerAuth.requestMagicLink(tenantId, dto.email, dto.redirectBase);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('verify')
  verify(@Body() dto: VerifyMagicLinkDto, @TenantId() tenantId: string) {
    return this.customerAuth.verifyMagicLink(tenantId, dto.token);
  }

  @Post('refresh')
  refresh(@Body() dto: CustomerRefreshTokenDto, @TenantId() tenantId: string) {
    return this.customerAuth.refresh(tenantId, dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: CustomerRefreshTokenDto, @TenantId() tenantId: string) {
    return this.customerAuth.logout(tenantId, dto.refreshToken);
  }
}
