import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { QueryNotesDto } from './dto/query-notes.dto';
import { SearchNoteDto } from './dto/search-note.dto';
import {
  NotesService,
  type NoteDetail,
  type NoteSummary,
  type Paginated,
} from './notes.service';

/**
 * Notes module. Every endpoint is JWT-protected and the userId is sourced
 * exclusively from the validated JWT principal via `@CurrentUser()` - the
 * DTOs never accept a `userId` (and neither do the path params), so there
 * is no way for a client to read or mutate another tenant's rows.
 *
 * Encryption: AES-256-GCM with per-field random IVs. List responses strip
 * the (potentially large) body and only ship the plaintext `preview`
 * column; full-body reads go through `GET /notes/:id`.
 *
 * Route ordering: `/notes/search` is declared BEFORE `:id` so the literal
 * segment is not shadowed by the parametric one.
 */
@ApiTags('notes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  // ---------------------------------------------------------------- search
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search my notes (case-insensitive substring on the plaintext preview)',
    description:
      'Returns summaries only - no content is decrypted. Matches against the ' +
      '~200-char preview column; will NOT find matches in the encrypted body. ' +
      'Soft-archived notes are excluded.',
  })
  @ApiOkResponse({ description: 'Array of note summaries (no `content`).' })
  search(
    @CurrentUser() user: RequestUser,
    @Body() dto: SearchNoteDto,
  ): Promise<NoteSummary[]> {
    return this.notesService.search(user.userId, dto);
  }

  // ---------------------------------------------------------------- list / create
  @Get()
  @ApiOperation({
    summary: 'List my notes (paginated, by-recent)',
    description:
      'Returns summaries only (`title` decrypted, `content` omitted). ' +
      'Archived notes are hidden by default; pass `includeArchived=true` to ' +
      'include them. Optional `tag` filter requires the note to carry that ' +
      'tag exactly.',
  })
  @ApiOkResponse({ description: 'Paginated list of note summaries.' })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryNotesDto,
  ): Promise<Paginated<NoteSummary>> {
    return this.notesService.findAll(user.userId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a note owned by me',
    description:
      'Encrypts title and content with the server-side master key. ' +
      'Returns the full note (including decrypted body) so the UI can render ' +
      'without a follow-up GET. Will be refused with 503 if MASTER_KEY is missing.',
  })
  @ApiCreatedResponse({ description: 'The new note with title + content decrypted.' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateNoteDto,
  ): Promise<NoteDetail> {
    return this.notesService.create(user.userId, dto);
  }

  // ---------------------------------------------------------------- per-note
  @Get(':id')
  @ApiOperation({
    summary: 'Get one of my notes (decrypted title + content)',
  })
  @ApiOkResponse({ description: 'Decrypted title + content for one note.' })
  @ApiNotFoundResponse({ description: 'Note not found, or the row belongs to someone else.' })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<NoteDetail> {
    return this.notesService.findOne(user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Partially update one of my notes',
    description:
      'Re-encrypts only the fields that are present in the body. Regenerates ' +
      'the plaintext preview whenever `content` is replaced.',
  })
  @ApiOkResponse({ description: 'Updated note with title + content decrypted.' })
  @ApiNotFoundResponse({ description: 'Note not found, or the row belongs to someone else.' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateNoteDto,
  ): Promise<NoteDetail> {
    return this.notesService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-archive one of my notes (idempotent)',
    description:
      'Sets `archivedAt = now()` instead of deleting the row. Re-archiving ' +
      'an already-archived row is a no-op success.',
  })
  @ApiOkResponse({ description: '{ "message": "Note archived" }' })
  @ApiNotFoundResponse({ description: 'Note not found, or the row belongs to someone else.' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ message: string }> {
    return this.notesService.remove(user.userId, id);
  }
}
