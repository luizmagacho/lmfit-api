import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ProductionService } from './production.service';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { UpdateProductionBatchDto } from './dto/update-production-batch.dto';

@ApiTags('production')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('production')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Post('batches')
  create(@Body() dto: CreateProductionBatchDto) {
    return this.production.create(dto);
  }

  @Get('batches')
  @ApiQuery({ name: 'status', required: false })
  findAll(
    @Query() q: PaginationQueryDto,
    @Query('status') status?: string,
  ) {
    return this.production.findAll(q.page, q.limit, q.search, status);
  }

  /** Retorna lotes agrupados por status — para o Kanban */
  @Get('batches/kanban')
  findKanban() {
    return this.production.findKanban();
  }

  /** Lista todos os status distintos (colunas do Kanban) */
  @Get('batches/statuses')
  getStatuses() {
    return this.production.getDistinctStatuses();
  }

  @Get('batches/:id')
  findOne(@Param('id') id: string) {
    return this.production.findOne(id);
  }

  @Patch('batches/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductionBatchDto) {
    return this.production.update(id, dto);
  }

  @Delete('batches/:id')
  remove(@Param('id') id: string) {
    return this.production.remove(id);
  }

  /** Resumo CMV para DRE */
  @Get('cmv-summary')
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  cmvSummary(@Query('from') from: string, @Query('to') to: string) {
    return this.production.getCmvSummary(new Date(from), new Date(to));
  }
}
