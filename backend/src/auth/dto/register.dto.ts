import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'ada@example.com', description: 'Stored lower-cased' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Length(3, 320, { message: 'email must be between 3 and 320 characters' })
  email: string;

  @ApiProperty({
    example: 'Sup3rSecret!',
    description: 'At least 8 characters, must contain both letters and digits',
  })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @Length(8, 128, { message: 'password must be between 8 and 128 characters' })
  @Matches(/[A-Za-z]/, { message: 'password must contain at least one letter' })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  password: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @Length(1, 120, { message: 'name must be between 1 and 120 characters' })
  name: string;
}
