import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { CreateInfluencerDto } from './dto/create-influencer.dto';
import { UpdateInfluencerDto } from './dto/update-influencer.dto';
import { InfluencersService } from './influencers.service';

@ApiTags('influencers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('influencers')
export class InfluencersController {
  constructor(private readonly influencers: InfluencersService) {}

  @Post()
  create(
    @Body() dto: CreateInfluencerDto,
    @CurrentUser() user: JwtUserPayload,
    @TenantId() tenantId: string,
  ) {
    return this.influencers.create(tenantId, dto, user.sub);
  }

  @Get()
  findAll(@Query() q: PaginationQueryDto, @TenantId() tenantId: string) {
    return this.influencers.findAll(tenantId, q.page, q.limit, q.search);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.influencers.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInfluencerDto,
    @TenantId() tenantId: string,
  ) {
    return this.influencers.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.influencers.remove(tenantId, id);
  }
}
