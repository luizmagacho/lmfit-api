import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStorefrontConfigDto } from './update-storefront-config.dto';

describe('UpdateStorefrontConfigDto — heroImages cap (Loop 4d)', () => {
  it('rejects more than 8 hero images', async () => {
    const dto = plainToInstance(UpdateStorefrontConfigDto, {
      heroImages: Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.jpg`),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'heroImages')).toBe(true);
  });

  it('accepts up to 8 hero images', async () => {
    const dto = plainToInstance(UpdateStorefrontConfigDto, {
      heroImages: Array.from({ length: 8 }, (_, i) => `https://example.com/${i}.jpg`),
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'heroImages')).toHaveLength(0);
  });

  it('rejects non-string entries', async () => {
    const dto = plainToInstance(UpdateStorefrontConfigDto, {
      heroImages: [123, 'https://example.com/a.jpg'],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'heroImages')).toBe(true);
  });

  it('accepts an undefined/omitted heroImages (backward-compatible with single heroImageUrl)', async () => {
    const dto = plainToInstance(UpdateStorefrontConfigDto, { heroImageUrl: 'https://example.com/x.jpg' });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'heroImages')).toHaveLength(0);
  });
});
