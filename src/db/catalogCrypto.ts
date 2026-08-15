import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// OPDS catalog passwords are stored encrypted (AES-256-GCM) so a leaked
// library.db does not expose credentials in plaintext. The key lives in a
// separate file next to the database (`<dbPath>.key`, mode 0600), so copying
// just the DB is not enough to read the passwords.
//
// Encrypted values carry a versioned prefix so we can (a) tell encrypted from
// legacy plaintext rows (migrated lazily) and (b) change the format later:
//   enc:v1:<base64(iv || tag || ciphertext)>
const PREFIX = 'enc:v1:';

function keyPathFor(dbPath: string): string {
  return `${dbPath}.key`;
}

// Load the 32-byte key for this database, creating it on first use. If the
// key file cannot be written (read-only filesystem, etc.) we fall back to a
// deterministic key derived from the DB path — weaker, but the app keeps
// working and the stored password is still not plaintext.
function getOrCreateKey(dbPath: string): Buffer {
  const keyPath = keyPathFor(dbPath);
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === 32) return existing;
  } catch {
    // missing or unreadable — generate below
  }
  const key = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  } catch {
    return crypto.createHash('sha256').update(dbPath).digest();
  }
}

export function encryptCatalogPassword(dbPath: string, plaintext: string): string {
  if (plaintext === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getOrCreateKey(dbPath), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

// Returns the plaintext password. Legacy values that predate encryption (no
// `enc:v1:` prefix) are returned unchanged; values that fail to decrypt
// (e.g. DB copied without its key file) yield null so the caller can prompt
// the user for credentials again instead of crashing.
export function decryptCatalogPassword(dbPath: string, stored: string): string | null {
  if (stored === '') return '';
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getOrCreateKey(dbPath), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function isEncryptedCatalogPassword(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
