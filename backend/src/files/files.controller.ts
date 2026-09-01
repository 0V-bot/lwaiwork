import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { FilesService, type FileDetail, type PaginatedFiles } from './files.service';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { ListFilesDto, UploadTicketDto } from './dto/upload-ticket.dto';

/**
 * Files controller.
 *
 * All routes are JWT-protected and the userId comes from the validated
 * principal, not from any DTO field. The OSS-facing URLs are all *short
 * lived* (5 minutes by default) so a stolen URL stays useless very
 * quickly - see OssProvider / FilesService.DOWNLOAD_TTL_SECONDS.
 *
 * Route ordering is critical: literal-path handlers (`upload-ticket`,
 * `confirm`, `download-url`) MUST come BEFORE the parametric `:id` handler,
 * otherwise Nest will route `POST /files/upload-ticket` to the `:id`
 * parser and ask for a UUID that is "upload-ticket".
 */
@ApiTags('files')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // ------------------------------------------------------------------ upload
  @Post('upload-ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request an upload ticket (POST-policy for OSS direct upload)',
    description:
      'Reserves an OSS object key under the caller\'s namespace, signs a 5-minute ' +
      'POST policy covering key prefix + content-type + size, and returns the form ' +
      'fields the client needs to PUT to OSS directly. The row is NOT yet persisted ' +
      '- call POST /files/confirm after the PUT returns 200.',
  })
  @ApiOkResponse({ description: 'POST-policy form + uploadUrl + fileId.' })
  requestUploadTicket(
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadTicketDto,
  ): ReturnType<FilesService['requestUploadTicket']> {
    return this.filesService.requestUploadTicket(
      user.userId,
      dto.filename,
      dto.contentType,
      dto.size,
    );
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an upload finished and persist the row',
    description:
      'Run after the client PUT-ed the bytes to OSS. Validates that ossKey is ' +
      'inside the caller\'s prefix (`users/${userId}/`) so a stolen ticket cannot ' +
      'be used to write a row on behalf of another tenant. Returns the new file ' +
      'detail including a 5-minute signed download URL.',
  })
  @ApiOkResponse({ description: 'New file detail with embedded download URL.' })
  @ApiNotFoundResponse({ description: 'Reserved fileId not found (caller leaked).' })
  confirmUpload(
    @CurrentUser() user: RequestUser,
    @Body() dto: ConfirmUploadDto,
  ): Promise<FileDetail> {
    return this.filesService.confirmUpload(user.userId, dto);
  }

  // ------------------------------------------------------------------ list
  @Get()
  @ApiOperation({
    summary: 'List my files (paginated, by-recent)',
    description:
      'Returns summaries only (no signed URLs). Archived rows are excluded by ' +
      'default - pass `includeArchived=true` to include them.',
  })
  @ApiOkResponse({ description: 'Paginated list of file summaries.' })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: ListFilesDto,
  ): Promise<PaginatedFiles> {
    return this.filesService.findAll(user.userId, query);
  }

  // ------------------------------------------------------------------ detail
  @Get(':id')
  @ApiOperation({
    summary: 'Get one of my files (with a 5-minute signed download URL)',
  })
  @ApiOkResponse({ description: 'File detail including the embedded download URL.' })
  @ApiNotFoundResponse({ description: 'File not found, or owned by someone else.' })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<FileDetail> {
    return this.filesService.findOne(user.userId, id);
  }

  // ------------------------------------------------------------------ download
  /**
   * `GET /files/:id/download-url` returns a 302 redirect to an OSS signed
   * URL. The browser follows the redirect and renders/downloads the object
   * directly from the bucket - we never proxied the bytes through Nest.
   *
   * 302 (not 307) is intentional: the browser converts the GET to GET
   * unconditionally, which is exactly what we want for downloads.
   *
   * `ApiProduces('application/octet-stream')` is a Swagger hint only -
   * the actual response body is empty (the 302 takes over).
   */
  @Get(':id/download-url')
  @ApiOperation({
    summary: 'Redirect to a short-lived signed OSS URL for the file',
    description:
      'Returns a 302 redirect to an OSS URL valid for 5 minutes. NEVER exposes ' +
      'the bucket to the client long-term; never proxies the bytes through Nest.',
  })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    description: '302 redirect; JSON body only emitted on error paths.',
  })
  @ApiNotFoundResponse({ description: 'File not found, or owned by someone else.' })
  async downloadUrl(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    let signed;
    try {
      signed = await this.filesService.getDownloadUrl(user.userId, id);
    } catch (err) {
      // Nest filters will turn a `NotFoundException` into a 404 JSON body
      // before `res` ever sees it. We only reach this catch for the rare
      // cases where the service threw a non-HttpException, e.g. OSS outage.
      if (err instanceof Error) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    res.status(HttpStatus.FOUND).setHeader('Location', signed.url).end();
  }

  // ------------------------------------------------------------------ archive
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-archive one of my files (idempotent)',
    description:
      'Sets `archivedAt = now()` and best-effort deletes the OSS object. Re-' +
      'archiving an already-archived row is a no-op success.',
  })
  @ApiOkResponse({ description: '{ "message": "File archived" }' })
  @ApiNotFoundResponse({ description: 'File not found, or owned by someone else.' })
  @ApiCreatedResponse({ description: 'Unused (kept for symmetry with detail).' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ message: string }> {
    return this.filesService.archive(user.userId, id);
  }
}
