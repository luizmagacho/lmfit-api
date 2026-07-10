import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateLeadDto {
  @ApiProperty({ enum: ['new', 'contacted', 'closed'] })
  @IsIn(['new', 'contacted', 'closed'])
  status: 'new' | 'contacted' | 'closed';
}
