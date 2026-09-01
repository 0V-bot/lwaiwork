import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTodoDto {
  @ApiProperty({ example: 'Ship the NestJS skeleton' })
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(255, { message: 'title must be at most 255 characters' })
  title: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ example: '2026-09-30T12:00:00.000Z', type: String })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'dueAt must be a valid ISO-8601 date' })
  dueAt?: Date;
}
