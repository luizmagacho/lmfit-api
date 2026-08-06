import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
/** Marca valores já criptografados por esta versão do formato — nenhum outro utilitário de
 *  criptografia reversível existia neste projeto antes (Loop 18); o prefixo também é o que permite
 *  `decrypt()` reconhecer e devolver sem alteração um valor legado ainda em texto plano, sem exigir
 *  uma migração coordenada de todos os dados existentes de uma vez. */
const PREFIX = 'enc:v1:';

/**
 * Loop 18 — utilitário genérico de criptografia simétrica reversível pra credenciais guardadas no
 * banco (tokens de API, secrets). AES-256-GCM: autenticado (detecta adulteração via `authTag`, não
 * só embaralha), IV aleatório por chamada (o mesmo texto puro nunca produz o mesmo ciphertext duas
 * vezes). A chave de 32 bytes é derivada de `CREDENTIALS_ENCRYPTION_KEY` via scrypt — aceita
 * qualquer string configurada no .env, não exige acertar exatamente 32 bytes crus.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('CREDENTIALS_ENCRYPTION_KEY');
    if (!raw) {
      this.logger.warn(
        'CREDENTIALS_ENCRYPTION_KEY não configurada — encrypt() vai falhar se chamado (decrypt() de valores legados em texto plano continua funcionando).',
      );
      this.key = null;
    } else {
      this.key = scryptSync(raw, 'kivoni-credentials-encryption-salt', 32);
    }
  }

  /** Reconhece o formato desta versão — usado por `decrypt()` pra decidir se descriptografa ou
   *  devolve um valor legado em texto plano sem alteração. */
  isEncrypted(value: string | undefined | null): value is string {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plaintext: string): string {
    if (!this.key) throw new Error('CREDENTIALS_ENCRYPTION_KEY não configurada — não é possível criptografar.');
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /** Valores que não reconhece o formato (`isEncrypted` falso) são devolvidos sem alteração —
   *  trata como um dado legado em texto plano ainda não migrado, em vez de lançar erro. */
  decrypt(value: string): string {
    if (!this.isEncrypted(value)) return value;
    if (!this.key) throw new Error('CREDENTIALS_ENCRYPTION_KEY não configurada — não é possível descriptografar.');
    const rest = value.slice(PREFIX.length);
    const [ivB64, authTagB64, dataB64] = rest.split(':');
    if (!ivB64 || !authTagB64 || !dataB64) {
      throw new Error('Valor criptografado malformado.');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}
