import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  COLOR_PATTERN,
  COLOR_MESSAGE,
  CONTENT_BYTE_CAP,
  TAG_MAX_LEN,
  TAGS_MAX_LEN,
} from './create-note.dto';

/**
 * Partial-update payload. Every field is optional - the service only re-encrypts
 * a column when its corresponding DTO field was actually present.
 *
 * `archivedAt: null` is reserved for "un-archive" and must NOT be picked up
 * here - we model archive / un-archive via DELETE / PATCH /:id routes, not
 * via a body field. Adding it would let a client accidentally reveal /
 * hide a row just by toggling a property, which is a footgun.
 */
export class UpdateNoteDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200, example: '工程周会要点 (final)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    maxLength: CONTENT_BYTE_CAP,
    description:
      `Plaintext body. Replaces the existing ciphertext; regenerates preview. ` +
      `Hard cap ${CONTENT_BYTE_CAP} bytes UTF-8.`,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CONTENT_BYTE_CAP)
  content?: string;

  @ApiPropertyOptional({ type: [String], maxItems: TAGS_MAX_LEN })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TAGS_MAX_LEN)
  @IsString({ each: true })
  @MaxLength(TAG_MAX_LEN, { each: true })
  @Type(() => String)
  tags?: string[];

  @ApiPropertyOptional({ example: '#F59E0B', description: '#RGB or #RRGGBB.' })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color?: string;
}
