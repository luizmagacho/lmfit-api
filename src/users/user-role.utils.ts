import type { UserRole } from './schemas/user.schema';

/** Roles stored in JWT / returned by `GET /auth/me` (legacy finance|ops → staff). */
export function normalizeRoleForJwt(role: UserRole): UserRole {
  if (role === 'finance' || role === 'ops') return 'staff';
  return role;
}

/** Staff-area routes: admin or anyone with staff-equivalent access. */
export function roleSatisfies(userRole: UserRole, allowed: UserRole[]): boolean {
  if (allowed.includes(userRole)) return true;
  if ((userRole === 'finance' || userRole === 'ops') && allowed.includes('staff')) {
    return true;
  }
  return false;
}
