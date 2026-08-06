import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetConversationAiEnabledDto {
  @ApiProperty()
  @IsBoolean()
  aiEnabled: boolean;
}
