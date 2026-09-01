import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import type { User } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { AuthResponseDto, UserDto } from './dto/auth-response.dto';
import type { JwtPayload } from './jwt.strategy';
import {
  ACCESS_TOKEN_TYPE,
  DEFAULT_ACCESS_TTL,
  DEFAULT_REFRESH_TTL,
  REFRESH_KEY_PREFIX,
  REFRESH_TOKEN_TYPE,
  BLACKLIST_KEY_PREFIX,
  assertSecretStrength,
  parseTtlToSeconds,
} from './constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  // -------------------------------------------------------------- secrets / ttl
  private get accessSecret(): string {
    return assertSecretStrength(this.config.get<string>('JWT_SECRET'), 'JWT_SECRET');
  }

  private get refreshSecret(): string {
    return assertSecretStrength(
      this.config.get<string>('JWT_REFRESH_SECRET'),
      'JWT_REFRESH_SECRET',
    );
  }

  /** TTLs are parsed to seconds so the same number drives both the JWT
   *  `expiresIn` claim and the Redis key TTL - they can never drift apart. */
  private get accessTtlSeconds(): number {
    const raw = this.config.get<string>('JWT_ACCESS_TTL') ?? DEFAULT_ACCESS_TTL;
    const seconds = parseTtlToSeconds(raw);
    if (seconds <= 0) {
      throw new Error(`JWT_ACCESS_TTL is not a valid duration: "${raw}"`);
    }
    return seconds;
  }

  private get refreshTtlSeconds(): number {
    const raw = this.config.get<string>('JWT_REFRESH_TTL') ?? DEFAULT_REFRESH_TTL;
    const seconds = parseTtlToSeconds(raw);
    if (seconds <= 0) {
      throw new Error(`JWT_REFRESH_TTL is not a valid duration: "${raw}"`);
    }
    return seconds;
  }

  // -------------------------------------------------------------- public API
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const user = await this.users.create(dto.email, dto.password, dto.name);
    return this.issueTokenPair(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users.validateCredentials(dto.email, dto.password);
    if (!user) {
      // SECURITY: single generic message - never say which half was wrong.
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokenPair(user);
  }

  /**
   * Rotates the refresh token: the presented token is deleted and a brand new
   * pair is issued. Re-using an old token therefore fails on the next attempt
   * (stolen-token detection).
   */
  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== REFRESH_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid token type');
    }

    const key = `${REFRESH_KEY_PREFIX}${payload.jti}`;
    let storedUserId: string | null;
    try {
      storedUserId = await this.redis.get(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Refresh store unreachable: ${message}`);
      throw new ServiceUnavailableException('Session store unavailable, please retry');
    }

    if (!storedUserId || storedUserId !== payload.sub) {
      // Token was already rotated (= possible replay of a stolen token).
      // Kill the whole session to be safe.
      this.logger.warn(`Refresh token replay detected for user ${payload.sub}`);
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Rotation: the old token dies here.
    await this.redis.del(key);
    return this.issueTokenPair(user);
  }

  /**
   * Revokes the access token (blacklist until natural expiry) and, when given,
   * the refresh token (deleted from Redis).
   */
  async logout(
    accessJti: string,
    accessExp: number | undefined,
    refreshToken?: string,
  ): Promise<{ message: string }> {
    if (accessJti) {
      const now = Math.floor(Date.now() / 1000);
      const remaining = accessExp ? accessExp - now : this.accessTtlSeconds;
      if (remaining > 0) {
        await this.redis.set(`${BLACKLIST_KEY_PREFIX}${accessJti}`, '1', remaining);
      }
    }

    if (refreshToken) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
          secret: this.refreshSecret,
        });
        if (payload.type === REFRESH_TOKEN_TYPE) {
          await this.redis.del(`${REFRESH_KEY_PREFIX}${payload.jti}`);
        }
      } catch {
        // Token is already invalid/expired - nothing to revoke. Swallowed on
        // purpose so logout stays idempotent.
      }
    }

    return { message: 'Logged out' };
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return UsersService.toSafeUser(user);
  }

  // -------------------------------------------------------------- internals
  private async issueTokenPair(user: User): Promise<AuthResponseDto> {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessSeconds = this.accessTtlSeconds;
    const refreshSeconds = this.refreshTtlSeconds;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        {
          sub: user.id,
          email: user.email,
          jti: accessJti,
          type: ACCESS_TOKEN_TYPE,
        },
        { secret: this.accessSecret, expiresIn: accessSeconds },
      ),
      this.jwt.signAsync(
        {
          sub: user.id,
          email: user.email,
          jti: refreshJti,
          type: REFRESH_TOKEN_TYPE,
        },
        { secret: this.refreshSecret, expiresIn: refreshSeconds },
      ),
    ]);

    try {
      await this.redis.set(
        `${REFRESH_KEY_PREFIX}${refreshJti}`,
        user.id,
        refreshSeconds,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // SECURITY: fail closed. If the refresh token cannot be persisted we
      // cannot honour logout/rotation, so we refuse to hand it out.
      this.logger.error(`Failed to persist refresh token: ${message}`);
      throw new ServiceUnavailableException(
        'Session store unavailable, please retry',
      );
    }

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessSeconds,
      user: UsersService.toSafeUser(user),
    };
  }
}
