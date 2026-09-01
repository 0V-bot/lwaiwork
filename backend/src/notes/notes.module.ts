import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from './entities/note.entity';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';
import { NotesKeyProvider } from './key.provider';

/**
 * Notes module.
 *
 * Providers:
 *   * `NotesKeyProvider` is a regular provider (not a global module) - only
 *     the notes service needs the master key, and the rest of the app
 *     should NOT be tempted to touch it.
 *
 * NotesService implements `OnModuleInit` to run the AES-256-GCM round-trip
 * self-check at startup; that hook fires AFTER all providers have been
 * constructed, so the key is fully parsed before the check runs.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Note])],
  controllers: [NotesController],
  providers: [NotesService, NotesKeyProvider],
  exports: [NotesService, NotesKeyProvider],
})
export class NotesModule {}
