import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit:action';

/** Marca um handler de mutação pra ser gravado no audit log. Ex.: @Audited('orders.update'). */
export const Audited = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
