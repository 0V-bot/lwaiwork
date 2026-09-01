import { AuthGuard } from '@nestjs/passport';

/**
 * Protects a route with the `jwt` strategy (JwtStrategy).
 * Usage: `@UseGuards(JwtAuthGuard)`
 */
export class JwtAuthGuard extends AuthGuard('jwt') {}
