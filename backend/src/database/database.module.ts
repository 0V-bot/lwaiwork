import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Todo } from '../todos/todo.entity';
import { Habit } from '../habits/entities/habit.entity';
import { HabitLog } from '../habits/entities/habit-log.entity';
import { Note } from '../notes/entities/note.entity';

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

        // ---------------------------------------------------------------------
        // SSL 必须由环境变量显式控制，不能跟着 NODE_ENV 自动开启。
        //
        // 原因（2026-09-01 实战踩坑）：
        //   原先写成 ssl: isProd ? { rejectUnauthorized: true } : undefined，
        //   结果 docker 内网连 postgres:5432 时报
        //   "The server does not support SSL connections" —— 容器内的 postgres
        //   默认不启用 SSL，而生产模式却强制要求 SSL，必然连不上。
        //
        // 规则：
        //   容器内网（docker compose）-> DATABASE_SSL=false（默认）
        //   外部托管数据库（RDS 等） -> DATABASE_SSL=true，并按需配置 rejectUnauthorized
        // ---------------------------------------------------------------------
        const sslEnabled = config.get<string>('DATABASE_SSL') === 'true';
        const sslRejectUnauthorized =
          config.get<string>('DATABASE_SSL_REJECT_UNAUTHORIZED') !== 'false';

        if (isProd && sslEnabled) {
          logger.log('Database SSL: enabled (rejectUnauthorized=' + sslRejectUnauthorized + ')');
        }

        return {
          type: 'postgres',
          url: config.get<string>('DATABASE_URL'),
          entities: [User, Todo, Habit, HabitLog, Note],
          migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
          // SECURITY/SAFETY: dropSchema is NEVER enabled.
          synchronize,
          dropSchema: false,
          migrationsRun: false,
          retryAttempts: 10,
          retryDelay: 3000,
          // Never log parameters - they may contain PII.
          logging: isProd ? ['error', 'warn', 'migration'] : ['error', 'warn'],
          ssl: sslEnabled ? { rejectUnauthorized: sslRejectUnauthorized } : false,
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
