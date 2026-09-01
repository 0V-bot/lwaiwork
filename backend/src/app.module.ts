import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TodosModule } from './todos/todos.module';
import { HabitsModule } from './habits/habits.module';
import { NotesModule } from './notes/notes.module';
import { SchedulesModule } from './schedules/schedules.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),
    DatabaseModule,
    RedisModule,
    UsersModule,
    AuthModule,
    TodosModule,
    HabitsModule,
    NotesModule,
    SchedulesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
