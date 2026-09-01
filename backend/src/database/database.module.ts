import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Todo } from '../todos/todo.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        const logger = new Logger('DatabaseModule');
        const isProd = config.get<string>('NODE_ENV') === 'production';
        const synchronize = config.get<string>('TYPEORM_SYNCHRONIZE') === 'true';

        if (isProd && synchronize) {
          logger.error(
            '\x1b[31m' +
              'TYPEORM_SYNCHRONIZE=true while NODE_ENV=production! ' +
              'This can silently ALTER/DROP columns. Set it to false and run migrations.' +
              '\x1b[0m',
          );
        }

        return {
          type: 'postgres',
          url: config.get<string>('DATABASE_URL'),
          entities: [User, Todo],
          migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
          // SECURITY/SAFETY: dropSchema is NEVER enabled.
          synchronize,
          dropSchema: false,
          migrationsRun: false,
          retryAttempts: 10,
          retryDelay: 3000,
          // Never log parameters - they may contain PII.
          logging: isProd ? ['error', 'warn', 'migration'] : ['error', 'warn'],
          ssl: isProd ? { rejectUnauthorized: true } : undefined,
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
