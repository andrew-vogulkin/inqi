import { AuthRole } from '@inqi/shared';

/** The authenticated principal the guards attach to the request. */
export interface AuthUser {
  sub: string;     // Customer.id
  email: string;
  role: AuthRole;
}
