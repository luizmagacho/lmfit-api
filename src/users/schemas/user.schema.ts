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
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, enum: USER_ROLE_VALUES, default: 'staff' })
  role: UserRole;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  /** Local fixo de trabalho (PDV offline) — usado como fonte da alocação de estoque do
   *  funcionário; opcional, sem valor até um admin atribuir um local. */
  @Prop({ type: Types.ObjectId, ref: 'Location' })
  assignedLocationId?: Types.ObjectId;

  /** Guia de onboarding (AppShell) já mostrada pra este usuário — por usuário no banco, não por
   *  navegador/dispositivo (localStorage reaparecia a cada troca de aparelho/limpeza de dados). */
  @Prop({ type: Boolean, default: false })
  hasSeenTour?: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
