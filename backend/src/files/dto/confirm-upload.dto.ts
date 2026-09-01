import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FILE_MAX_SIZE } from './upload-ticket.dto';

/**
 * Safe pattern for ossKey. We accept a UUID-shaped segment after
 * `users/${userId}/` plus a benign extension; this is the in-DB contract and
 * the service re-asserts it server-side even if the DTO is bypassed.
 *
 *   users/<uuid>/<uuid>.<ext>
 *
 * The slash count is fixed; the prefix MUST match the user's own id; ext
 * is a-z only to keep it shell-safe + mime-mappable.
 */
export const OSS_KEY_PATTERN =
  /^users\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]{1,8}$/;

/**
 * POST /files/confirm.
 *
 * The client just finished PUTting the bytes to OSS (using the form fields
 * returned by /upload-ticket). Now it reports back what OSS said so we can
 * persist the row. We deliberately do NOT round-trip to OSS to validate the
 * object (would double the cost) - the POST policy conditions + the ETag
 * signed by OSS are enough proof for the ticket issuer.
 *
 * `width` / `height` are optional but REQUIRED for image/* content; the
 * client usually knows them from a pre-upload canvas probe.
 */
export class ConfirmUploadDto {
  @ApiProperty({
    example: 'users/8d3b.../9f4a.png',
    description:
      'OSS object key the client PUT against. Server re-checks that the key ' +
      'starts with `users/${userId}/`, that nothing in the body tries to claim ' +
      'another tenant\'s slot.',
  })
  @IsString()
  @Matches(OSS_KEY_PATTERN, {
    message:
      'ossKey must look like users/<uuid>/<uuid>.<ext>; server will recheck the prefix.',
  })
  ossKey!: string;

  @ApiProperty({
    example: '"F4A7B91C5D2E0A1F1234567890ABCDEF"',
    description: 'ETag as returned by OSS in the PUT response, quotes included.',
  })
  @IsString()
  etag!: string;

  @ApiProperty({
    minimum: 1,
    maximum: FILE_MAX_SIZE,
    example: 524288,
    description: 'Final size in bytes (matches what the client PUT-ed).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FILE_MAX_SIZE)
  size!: number;

  @ApiPropertyOptional({
    minimum: 1,
    example: 1080,
    description: 'Pixel width. Only meaningful for image/* uploads.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  width?: number;

  @ApiPropertyOptional({
    minimum: 1,
    example: 1080,
    description: 'Pixel height. Only meaningful for image/* uploads.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  height?: number;
}
