import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { assertSecretStrength, DEFAULT_ACCESS_TTL, parseTtlToSeconds } from './constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const rawTtl = config.get<string>('JWT_ACCESS_TTL') ?? DEFAULT_ACCESS_TTL;
        const ttlSeconds = parseTtlToSeconds(rawTtl);
        if (ttlSeconds <= 0) {
          throw new Error(`JWT_ACCESS_TTL is not a valid duration: "${rawTtl}"`);
        }
        return {
          // Default secret/expiresIn. AuthService always signs with an explicit
          // secret so access and refresh tokens use different keys.
          secret: assertSecretStrength(config.get<string>('JWT_SECRET'), 'JWT_SECRET'),
          signOptions: { expiresIn: ttlSeconds },
        };
      },
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
