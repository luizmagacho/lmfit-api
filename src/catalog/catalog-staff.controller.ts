import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('catalog')
export class CatalogStaffController {
  constructor(private readonly config: ConfigService) {}

  /** Returns the public catalog URL for WhatsApp / marketing. */
  @Post('share-link')
  shareLink() {
    const base = (
      this.config.get<string>('WEB_ADMIN_BASE_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    return {
      catalogUrl: `${base}/catalog`,
      note: 'Use um template WhatsApp aprovado para envio proativo.',
    };
  }
}
