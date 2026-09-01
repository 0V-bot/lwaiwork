import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'The refresh token issued at login/register' })
  @IsString()
  @MaxLength(2048)
  refreshToken: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Refresh token to revoke. Omit to only blacklist the current access token.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}
