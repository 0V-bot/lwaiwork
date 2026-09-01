import { ApiProperty } from '@nestjs/swagger';

/** Public user projection - never contains passwordHash. */
export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/** Returned by register / login / refresh. */
export class AuthResponseDto {
  @ApiProperty({ description: 'Short-lived access token (15 min)' })
  accessToken: string;

  @ApiProperty({ description: 'Long-lived refresh token (7 d), stored server-side in Redis' })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ description: 'Access token lifetime in seconds', example: 900 })
  expiresIn: number;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}

export class MessageResponseDto {
  @ApiProperty()
  message: string;
}
