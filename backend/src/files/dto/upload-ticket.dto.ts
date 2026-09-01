import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';


/**
 * Per-file upload size cap, enforced at DTO level. Mirrored on the service
 * side (own 413) and on the OSS POST policy (`conditions: content-length-range`)
 * so rejection happens at all three layers:
 *   * browser validates before issuing the PUT
 *   * Nest rejects the request body before any OSS call
 *   * OSS rejects the bytes during the PUT (defence-in-depth)
 *
 * 100 MiB. An image / small PDF almost never needs more, and pushing the
 * limit higher invites cold-cache PUTs that time out.
 */
export const FILE_MAX_SIZE = 100 * 1024 * 1024;

/**
 * Query string for `GET /files`. Encrypted-style pagination matches the
 * other modules: page (>=1), limit (1..100), `includeArchived` switch and an
 * `imagesOnly` filter so the gallery view can short-circuit without
 * carrying binary MIME in every row.
 */
export class ListFilesDto {
  @ApiPropertyOptional({ example: false, default: false, description: 'Include archived (soft-deleted) files in the list.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
  @IsBoolean()
  includeArchived: boolean = false;

  @ApiPropertyOptional({ example: false, default: false, description: 'Limit to image/* MIME types.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
  @IsBoolean()
  imagesOnly: boolean = false;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

/**
 * POST /files/upload-ticket.
 *
 * Validates the requested filename / content-type / size before we reserve
 * an OSS key. The client gets back:
 *   * `uploadUrl` - the OSS POST endpoint
 *   * `ossKey`    - the object key to PUT under
 *   * `fileId`    - reserved UUID (also the row's eventual id; the row
 *                   isn't persisted until /files/confirm succeeds)
 *   * `expiresAt` - ticket TTL (5 minutes)
 *   * `form`      - the POST-policy form fields the client must include
 *                   in its multipart PUT to OSS
 */
export class UploadTicketDto {
  @ApiProperty({
    maxLength: 255,
    example: 'profile-avatar.png',
    description:
      'Original filename, used for display only. The on-disk OSS key always uses ' +
      'a generated UUID prefix to avoid collisions.',
  })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    maxLength: 127,
    example: 'image/png',
    description:
      'MIME type. Must be on the server-side whitelist (image/* / application/pdf / ' +
      'text/* / application/json / application/zip). Generic `application/octet-stream` ' +
      'is explicitly rejected.',
  })
  @IsString()
  @MaxLength(127)
  contentType!: string;

  @ApiProperty({
    minimum: 1,
    maximum: FILE_MAX_SIZE,
    example: 524288,
    description:
      'Total PUT body size in bytes. Server-side cap is ' + `${FILE_MAX_SIZE}` +
      ' (~100 MiB); large requests are returned as 413 before any OSS round-trip.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FILE_MAX_SIZE)
  size!: number;
}
