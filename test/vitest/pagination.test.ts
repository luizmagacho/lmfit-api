import { describe, expect, it } from 'vitest';
import { skipFromPage } from '../../src/common/dto/pagination-query.dto';

describe('skipFromPage', () => {
  it('computes skip for page 1', () => {
    expect(skipFromPage(1, 20)).toBe(0);
  });

  it('computes skip for page 3', () => {
    expect(skipFromPage(3, 10)).toBe(20);
  });
});
