import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
  create(@Body() dto: PublicCreateDraftDto) {
    return this.drafts.createPublic(dto);
  }

  @Get(':token')
  get(@Param('token') token: string) {
    return this.drafts.getByToken(token);
  }

  @Patch(':token')
  patch(@Param('token') token: string, @Body() dto: PublicPatchDraftDto) {
    return this.drafts.patchByToken(token, dto);
  }

  @Post(':token/submit')
  submit(@Param('token') token: string, @Body() body: PublicSubmitDraftDto) {
    return this.drafts.submitByToken(token, body);
  }
}
