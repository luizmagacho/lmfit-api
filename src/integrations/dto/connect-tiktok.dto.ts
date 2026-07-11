import { IsOptional, IsString } from 'class-validator';

export class ConnectTiktokDto {
  @IsOptional() @IsString() label?: string;

  /** App key do app Kivoni cadastrado no TikTok Shop Partner Center. */
  @IsString() applicationKey: string;

  /** App secret do mesmo app. */
  @IsString() apiKey: string;

  /** `auth_code` recebido no redirect de autorização do vendedor. */
  @IsString() authCode: string;
}
