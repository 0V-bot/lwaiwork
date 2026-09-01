import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TAG_MAX_LEN } from './create-note.dto';

/**
 * Body for `POST /notes/search`.
 *
 * SECURITY: full-text search at the moment only hits the plaintext `preview`
 * column. This is a deliberate product tradeoff: the preview is a short
 * snippet (~200 chars) so searching it cannot reconstruct the full plaintext
 * content of a note. Searches over the encrypted `content_ciphertext` would
 * require either decrypting every row (expensive) or a sidecar index
 * encrypted with a different scheme - out of scope for Milestone 2.
 *
 * Match is case-insensitive substring (`ILIKE '%query%'`), tag filter is
 * "has this tag" using Postgres array containment (`tags @> ARRAY[?]`).
 */
export class SearchNoteDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 200,
    example: 'milestone',
    description:
      'Case-insensitive substring match on the plaintext preview column only. ' +
      'Will not find matches in the encrypted body.',
  })
  @IsString()
  @MinLength(1, { message: 'query must not be empty' })
  @MaxLength(200, { message: 'query must be at most 200 characters' })
  query!: string;

  @ApiPropertyOptional({
    example: 'work',
    description: 'Restrict results to notes that carry this tag (exact match).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TAG_MAX_LEN)
  tag?: string;
}
