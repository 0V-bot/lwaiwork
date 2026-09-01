import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './entities/file.entity';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { OssProvider } from './oss.provider';

/**
 * Files module.
 *
 * Wiring:
 *   * `TypeOrmModule.forFeature([FileEntity])` so the service can
 *     `@InjectRepository(FileEntity)` and TypeORM's repository is the
 *     row-of-record for blobs.
 *   * `OssProvider` is a module-local provider - it owns the singleton
 *     ali-oss client and the lifecycle probe; no other module needs
 *     to touch OSS creds.
 *
 * The module does NOT export anything publicly; if a future caller needs
 * the signed URL helper outside the module, lift `OssProvider` to a
 * separate `oss.module.ts` then.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FileEntity])],
  controllers: [FilesController],
  providers: [FilesService, OssProvider],
  exports: [FilesService, OssProvider],
})
export class FilesModule {}
