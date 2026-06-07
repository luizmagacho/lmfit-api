import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireFeature } from '../common/decorators/require-feature.decorator';
import { Feature } from '../common/enums/feature.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
@RequireFeature(Feature.FINANCIAL)
@Roles('admin', 'staff')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.payments.findAll(tenantId, q.page, q.limit);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.findOne(tenantId, id);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.remove(tenantId, id);
  }
}
