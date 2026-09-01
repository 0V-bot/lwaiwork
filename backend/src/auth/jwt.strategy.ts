import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import {
  ACCESS_TOKEN_TYPE,
  BLACKLIST_KEY_PREFIX,
  assertSecretStrength,
} from './constants';

/** Claims embedded in both access and refresh tokens. */
export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
  type: string;
  iat?: number;
  exp?: number;
}

/** What `validate()` attaches to `request.user`. */
export interface RequestUser {
  userId: string;
  email: string;
  jti: string;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: assertSecretStrength(config.get<string>('JWT_SECRET'), 'JWT_SECRET'),
    });
  }

  /**
   * Runs after signature + expiry verification.
   * 1. reject non-access tokens (a refresh token must never open an API route)
   * 2. reject blacklisted jti (post-logout)
   * 3. reject tokens for deleted/unknown users
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (payload.type !== ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid token type');
    }

    try {
      const revoked = await this.redis.exists(`${BLACKLIST_KEY_PREFIX}${payload.jti}`);
      if (revoked) {
        throw new UnauthorizedException('Token has been revoked');
      }
    } catch (err) {
      // SECURITY: fail closed. If the revocation store is unreachable we cannot
      // prove the token is still valid, so we refuse the request.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Revocation check failed, denying request: ${message}`);
      throw new UnauthorizedException('Unable to validate token');
    }

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return {
      userId: user.id,
      email: user.email,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
