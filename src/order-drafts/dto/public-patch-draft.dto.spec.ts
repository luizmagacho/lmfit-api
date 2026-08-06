import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { PublicCreateDraftDto, PublicDraftLineDto, PublicPatchDraftDto } from './public-patch-draft.dto';

describe('PublicDraftLineDto — quantity caps (Loop 10 hardening)', () => {
  it('rejects a quantity above 9999', async () => {
    const dto = plainToInstance(PublicDraftLineDto, { variantId: new Types.ObjectId().toString(), quantity: 10000 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'quantity')).toBe(true);
  });

  it('accepts a quantity within bounds', async () => {
    const dto = plainToInstance(PublicDraftLineDto, { variantId: new Types.ObjectId().toString(), quantity: 5 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('PublicCreateDraftDto — waId length cap (Loop 10 hardening)', () => {
  it('rejects an oversized waId', async () => {
    const dto = plainToInstance(PublicCreateDraftDto, { waId: 'x'.repeat(51) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'waId')).toBe(true);
  });
});

describe('PublicPatchDraftDto — array/string caps (Loop 10 hardening)', () => {
  it('rejects more than 100 lines in a single patch', async () => {
    const lines = Array.from({ length: 101 }, () => ({ variantId: new Types.ObjectId().toString(), quantity: 1 }));
    const dto = plainToInstance(PublicPatchDraftDto, { lines });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'lines')).toBe(true);
  });

  it('accepts up to 100 lines', async () => {
    const lines = Array.from({ length: 100 }, () => ({ variantId: new Types.ObjectId().toString(), quantity: 1 }));
    const dto = plainToInstance(PublicPatchDraftDto, { lines });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an oversized paymentMethodChoice', async () => {
    const dto = plainToInstance(PublicPatchDraftDto, { paymentMethodChoice: 'x'.repeat(101) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'paymentMethodChoice')).toBe(true);
  });

  it('rejects an oversized couponCode', async () => {
    const dto = plainToInstance(PublicPatchDraftDto, { couponCode: 'x'.repeat(51) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'couponCode')).toBe(true);
  });
});
