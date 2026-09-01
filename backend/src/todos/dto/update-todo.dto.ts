import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTodoDto {
  @ApiPropertyOptional({ example: 'Ship the NestJS skeleton (v2)' })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'title must be at most 255 characters' })
  title?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({
    example: '2026-09-30T12:00:00.000Z',
    type: String,
    description: 'Set to null to clear the due date',
  })
  @IsOptional()
  @IsDate({ message: 'dueAt must be a valid ISO-8601 date' })
  @Type(() => Date)
  dueAt?: Date | null;
}
