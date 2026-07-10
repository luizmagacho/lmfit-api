import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { FiscalService } from './fiscal.service';

@ApiTags('fiscal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('orders/:orderId/fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Post('emit')
  emit(@TenantId() tenantId: string, @Param('orderId') orderId: string) {
    return this.fiscal.emitForOrder(tenantId, orderId);
  }

  @Get()
  list(@TenantId() tenantId: string, @Param('orderId') orderId: string) {
    return this.fiscal.getForOrder(tenantId, orderId);
  }
}
