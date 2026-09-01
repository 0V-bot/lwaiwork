import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { RequestUser } from '../../auth/jwt.strategy';

/** Injects the validated JWT principal: `@CurrentUser() user: RequestUser` */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
    return request.user;
  },
);
