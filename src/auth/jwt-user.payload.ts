import type { UserRole } from '../users/schemas/user.schema';

export type JwtUserPayload = {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string;
};
