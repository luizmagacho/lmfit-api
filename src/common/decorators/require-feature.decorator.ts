import { SetMetadata } from '@nestjs/common';
import type { Feature } from '../enums/feature.enum';

export const REQUIRED_FEATURES_KEY = 'required_features';
export const RequireFeature = (...features: Feature[]) =>
  SetMetadata(REQUIRED_FEATURES_KEY, features);
