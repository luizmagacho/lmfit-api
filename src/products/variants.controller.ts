import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { StockMovementDto } from './dto/stock-movement.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ProductsService } from './products.service';

@ApiTags('variants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('variants')
export class VariantsController {
  constructor(private readonly products: ProductsService) {}

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.products.getVariant(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.products.removeVariant(id);
  }

  @Post(':id/stock-movements')
  stockMove(
    @Param('id') id: string,
    @Body() dto: StockMovementDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.products.applyStockMovement(id, dto, user.sub);
  }
}
