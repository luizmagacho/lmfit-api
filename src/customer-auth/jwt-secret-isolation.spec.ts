import * as jwt from 'jsonwebtoken';

const STAFF_SECRET = 'staff-secret-min-32-chars-aaaaaaaaaaaaaaaaaaaa';
const CUSTOMER_SECRET = 'customer-secret-min-32-chars-bbbbbbbbbbbbbbbbb';

describe('Staff vs. customer JWT secret isolation (AC1 mechanism)', () => {
  it('a staff-signed token fails signature verification under the customer secret', () => {
    const staffToken = jwt.sign({ sub: 'u1', email: 'a@b.com', role: 'admin', tenantId: 't1' }, STAFF_SECRET);
    expect(() => jwt.verify(staffToken, CUSTOMER_SECRET)).toThrow(/invalid signature/i);
  });

  it('a customer-signed token fails signature verification under the staff secret', () => {
    const customerToken = jwt.sign({ sub: 'c1', tenantId: 't1' }, CUSTOMER_SECRET);
    expect(() => jwt.verify(customerToken, STAFF_SECRET)).toThrow(/invalid signature/i);
  });

  it('each token verifies correctly under its own secret', () => {
    const staffToken = jwt.sign({ sub: 'u1', tenantId: 't1' }, STAFF_SECRET);
    const customerToken = jwt.sign({ sub: 'c1', tenantId: 't1' }, CUSTOMER_SECRET);
    expect(() => jwt.verify(staffToken, STAFF_SECRET)).not.toThrow();
    expect(() => jwt.verify(customerToken, CUSTOMER_SECRET)).not.toThrow();
  });
});
