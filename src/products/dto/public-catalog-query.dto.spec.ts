import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublicCatalogQueryDto } from './public-catalog-query.dto';

describe('PublicCatalogQueryDto — sort is a closed enum, price/pagination coerce from query strings', () => {
  it('rejects a sort value outside the 4 known options', async () => {
    const dto = plainToInstance(PublicCatalogQueryDto, { sort: 'preco-aleatorio' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sort')).toBe(true);
  });

  it('accepts every documented sort value', async () => {
    for (const sort of ['relevancia', 'menor-preco', 'maior-preco', 'lancamentos']) {
      const dto = plainToInstance(PublicCatalogQueryDto, { sort });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'sort')).toBe(false);
    }
  });

  it('coerces priceMin/priceMax query strings into numbers', async () => {
    const dto = plainToInstance(PublicCatalogQueryDto, { priceMin: '100', priceMax: '250' }, { enableImplicitConversion: true });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.priceMin).toBe(100);
    expect(dto.priceMax).toBe(250);
  });

  it('rejects a negative priceMin', async () => {
    const dto = plainToInstance(PublicCatalogQueryDto, { priceMin: -10 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'priceMin')).toBe(true);
  });

  it('defaults page/limit from the inherited PaginationQueryDto when omitted', async () => {
    const dto = plainToInstance(PublicCatalogQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('rejects an oversized limit (Loop 10 hardening: caps the DB fetch size)', async () => {
    const dto = plainToInstance(PublicCatalogQueryDto, { limit: 999999 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects an oversized category/size/color string (Loop 10 hardening)', async () => {
    const long = 'x'.repeat(101);
    const dto = plainToInstance(PublicCatalogQueryDto, { category: long, size: long, color: long });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'category')).toBe(true);
    expect(errors.some((e) => e.property === 'size')).toBe(true);
    expect(errors.some((e) => e.property === 'color')).toBe(true);
  });

  it('rejects an oversized search string (Loop 10 hardening, inherited from PaginationQueryDto)', async () => {
    const dto = plainToInstance(PublicCatalogQueryDto, { search: 'x'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'search')).toBe(true);
  });
});
