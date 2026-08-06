import { EncryptionService } from './encryption.service';

function makeService(key = 'a-real-secret-key-from-env-config') {
  const config: any = { get: jest.fn().mockReturnValue(key) };
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  it('round-trips a plaintext value through encrypt/decrypt', () => {
    const service = makeService();
    const ciphertext = service.encrypt('super-secret-api-key-123');
    expect(service.decrypt(ciphertext)).toBe('super-secret-api-key-123');
  });

  it('produces a different ciphertext each time for the same plaintext (random IV)', () => {
    const service = makeService();
    const a = service.encrypt('same-value');
    const b = service.encrypt('same-value');
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe('same-value');
    expect(service.decrypt(b)).toBe('same-value');
  });

  it('marks its own output as encrypted via isEncrypted()', () => {
    const service = makeService();
    const ciphertext = service.encrypt('x');
    expect(service.isEncrypted(ciphertext)).toBe(true);
    expect(service.isEncrypted('plain-legacy-value')).toBe(false);
    expect(service.isEncrypted(undefined)).toBe(false);
    expect(service.isEncrypted(null)).toBe(false);
  });

  it('returns a legacy plaintext value unchanged from decrypt() instead of throwing', () => {
    const service = makeService();
    expect(service.decrypt('some-plain-legacy-token')).toBe('some-plain-legacy-token');
  });

  it('detects tampering via the GCM auth tag instead of silently returning corrupted data', () => {
    const service = makeService();
    const ciphertext = service.encrypt('sensitive-value');
    const tampered = ciphertext.slice(0, -4) + 'AAAA';
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('cannot be decrypted with a different key than the one it was encrypted with', () => {
    const service = makeService('key-one');
    const other = makeService('key-two');
    const ciphertext = service.encrypt('cross-key-test');
    expect(() => other.decrypt(ciphertext)).toThrow();
  });

  it('throws from encrypt() when no encryption key is configured', () => {
    const config: any = { get: jest.fn().mockReturnValue(undefined) };
    const service = new EncryptionService(config);
    expect(() => service.encrypt('x')).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('still returns legacy plaintext unchanged from decrypt() even with no key configured', () => {
    const config: any = { get: jest.fn().mockReturnValue(undefined) };
    const service = new EncryptionService(config);
    expect(service.decrypt('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });
});
