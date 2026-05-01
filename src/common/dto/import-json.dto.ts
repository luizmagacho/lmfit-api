import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional } from 'class-validator';

export class ImportJsonDto {
  @ApiProperty({
    description: 'Rows using API field names (same keys as GET list items)',
    type: 'array',
    items: { type: 'object' },
  })
  @IsArray()
  items!: Record<string, unknown>[];

  @ApiPropertyOptional({
    description: 'Validate only; no writes when true',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
