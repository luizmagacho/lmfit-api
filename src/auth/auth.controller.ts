import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtUserPayload } from './jwt-user.payload';
import { LoginDto } from './dto/login.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RefreshDto } from './dto/refresh.dto';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';

@ApiTags('auth')
@Controller('auth')
@SkipSubscriptionCheck()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('login')
  login(@TenantId() tenantId: string, @Body() dto: LoginDto) {
    return this.auth.login(tenantId, dto.email, dto.password);
  }

  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtUserPayload) {
    return this.auth.me(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('me/tour-seen')
  markTourSeen(@CurrentUser() user: JwtUserPayload) {
    return this.auth.markTourSeen(user.sub);
  }
}
