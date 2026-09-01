import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query string for `GET /notes`.
 *
 * Defaults mirror the habits module: page 1, limit 20, `updatedAt DESC` -
 * the freshly-edited note surfaces first, which is the most common UX.
 *
 * The on-disk column is `user_id`, but the controller never accepts a
 * `userId` from the client - that value is ALWAYS taken from the validated
 * JWT principal.
 */
export class QueryNotesDto {
  @ApiPropertyOptional({ example: false, default: false, description: 'Include archived notes' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean = false;

  @ApiPropertyOptional({
    example: 'work',
    description: 'Return only notes that carry this tag (exact match).',
  })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: 'updatedAt',
    default: 'updatedAt',
    enum: ['updatedAt', 'createdAt'],
  })
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt'])
  sortBy?: 'updatedAt' | 'createdAt' = 'updatedAt';

  @ApiPropertyOptional({
    example: 'DESC',
    default: 'DESC',
    enum: ['ASC', 'DESC'],
  })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC' = 'DESC';
}
