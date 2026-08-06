import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Audited } from '../audit/audited.decorator';
import { RejectReviewDto } from './dto/reject-review.dto';
import { ReviewsService } from './reviews.service';

/** Moderação de avaliações (tela de gestão). */
@ApiTags('reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query() q: PaginationQueryDto,
    @Query('status') status?: string,
  ) {
    return this.reviews.findAll(tenantId, q.page, q.limit, status);
  }

  @Patch(':id/approve')
  @Audited('reviews.approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtUserPayload, @TenantId() tenantId: string) {
    return this.reviews.approve(tenantId, id, user.sub);
  }

  @Patch(':id/reject')
  @Audited('reviews.reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectReviewDto,
    @CurrentUser() user: JwtUserPayload,
    @TenantId() tenantId: string,
  ) {
    return this.reviews.reject(tenantId, id, user.sub, dto.note);
  }
}
