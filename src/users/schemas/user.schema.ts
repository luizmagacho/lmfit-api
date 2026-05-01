import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Canonical + legacy (`finance` / `ops` kept for existing DB rows; prefer `staff`). */
export type UserRole =
  | 'admin'
  | 'staff'
  | 'wholesaler'
  | 'retail'
  | 'customer'
  | 'finance'
  | 'ops';

export const USER_ROLE_VALUES = [
  'admin',
  'staff',
  'wholesaler',
  'retail',
  'customer',
  'finance',
  'ops',
] as const satisfies readonly UserRole[];

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, enum: USER_ROLE_VALUES, default: 'staff' })
  role: UserRole;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 }, { unique: true });
