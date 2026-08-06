import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { TenantFeatures } from '../common/decorators/tenant-features.decorator';
import {
  PublicCreateDraftDto,
  PublicPatchDraftDto,
} from './dto/public-patch-draft.dto';
import { PublicSubmitDraftDto } from './dto/public-submit-draft.dto';
import { OrderDraftsService } from './order-drafts.service';

@ApiTags('public-order-drafts')
@Controller('public/order-drafts')
export class PublicOrderDraftsController {
  constructor(private readonly drafts: OrderDraftsService) {}

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: PublicCreateDraftDto) {
    return this.drafts.createPublic(tenantId, dto);
  }

  @Get(':token')
  get(@TenantId() tenantId: string, @Param('token') token: string) {
    return this.drafts.getByToken(tenantId, token);
  }

  @Patch(':token')
  patch(
    @TenantId() tenantId: string,
    @Param('token') token: string,
    @Body() dto: PublicPatchDraftDto,
    @TenantFeatures() features: string[],
  ) {
    return this.drafts.patchByToken(tenantId, token, dto, features);
  }

  // Loop 10 — mesmo teto de "escrita adjacente a pagamento" já usado em
  // public-payments.controller.ts (dev-confirm/simulate-confirm), já que submit cria pedido real.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':token/submit')
  submit(
    @TenantId() tenantId: string,
    @Param('token') token: string,
    @Body() body: PublicSubmitDraftDto,
  ) {
    return this.drafts.submitByToken(tenantId, token, body);
  }
}
