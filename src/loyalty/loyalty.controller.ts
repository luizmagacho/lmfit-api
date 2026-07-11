import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Audited } from '../audit/audited.decorator';
import { RedeemPointsDto } from './dto/redeem-points.dto';
import { LoyaltyService } from './loyalty.service';

@ApiTags('loyalty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('customers/:customerId/loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Post('redeem')
  @Audited('loyalty.redeem')
  redeem(
    @TenantId() tenantId: string,
    @Param('customerId') customerId: string,
    @Body() dto: RedeemPointsDto,
  ) {
    return this.loyalty.redeem(tenantId, customerId, dto.points);
  }
}
