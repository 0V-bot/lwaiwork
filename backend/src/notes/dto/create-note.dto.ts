import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { TITLE_MAX_BYTES, CONTENT_MAX_BYTES } from '../crypto-aes-gcm';

/**
 * Helper for the `color` field - keeps the regex in one place so the
 * validator on Create vs Update can't drift apart.
 *
 * Accepts `#RGB` and `#RRGGBB` so the front-end's compact palette works
 * without a migration later. Anything looser would let clients push arbitrary
 * CSS strings into the persisted colour, which we never want.
 */
export const COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const COLOR_MESSAGE = 'color must be #RGB or #RRGGBB (e.g. #2FAF9E)';

/** Byte cap that mirrors the crypto-layer caps; surfaces a 400 instead of a 500. */
export const TITLE_BYTE_CAP = TITLE_MAX_BYTES;
export const CONTENT_BYTE_CAP = CONTENT_MAX_BYTES;

/** Hard limit on how many tags a single note may carry - prevents abuse. */
export const TAGS_MAX_LEN = 32;
export const TAG_MAX_LEN = 32;

/** Cross-field byte guards run after class-validator - see NotesService.create. */
export function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export class CreateNoteDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 200,
    example: '工程周会要点',
    description:
      'Plaintext title. Encrypted at rest with AES-256-GCM (per-row IV). ' +
      `${TITLE_BYTE_CAP}-byte UTF-8 hard cap enforced by the crypto layer.`,
  })
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(200, { message: 'title must be at most 200 characters' })
  title!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: CONTENT_BYTE_CAP,
    example: '周一：\n- 完成 notes 模块接口设计\n- 与 PM 对齐上线节奏',
    description:
      'Plaintext body. Encrypted at rest with AES-256-GCM (per-row IV). ' +
      `Hard cap ${CONTENT_BYTE_CAP} bytes (50 KiB); over-cap requests are rejected.`,
  })
  @IsString()
  @MinLength(1, { message: 'content must not be empty' })
  @MaxLength(CONTENT_BYTE_CAP, {
    message: `content must be at most ${CONTENT_BYTE_CAP} bytes when UTF-8 encoded`,
  })
  content!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: TAGS_MAX_LEN,
    example: ['work', 'meeting'],
    description:
      'Plaintext tags, stored as text[]. Small enough to live in clear next ' +
      'to the ciphertext - the user can re-derive them from context. ' +
      `Each tag max ${TAG_MAX_LEN} chars.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TAGS_MAX_LEN, { message: `tags may contain at most ${TAGS_MAX_LEN} entries` })
  @IsString({ each: true })
  @MaxLength(TAG_MAX_LEN, { each: true, message: `each tag must be at most ${TAG_MAX_LEN} chars` })
  @Type(() => String)
  tags?: string[];

  @ApiPropertyOptional({
    example: '#2FAF9E',
    description: 'UI colour token. Accepts #RGB or #RRGGBB. Defaults to teal.',
    default: '#2FAF9E',
  })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color?: string;
}
