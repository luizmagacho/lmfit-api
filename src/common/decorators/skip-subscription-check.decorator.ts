import { SetMetadata } from '@nestjs/common';

export const IS_SKIP_SUBSCRIPTION_CHECK_KEY = 'isSkipSubscriptionCheck';
export const SkipSubscriptionCheck = () => SetMetadata(IS_SKIP_SUBSCRIPTION_CHECK_KEY, true);
