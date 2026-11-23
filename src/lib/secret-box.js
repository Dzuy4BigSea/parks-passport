import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Encrypts small secrets (the SendGrid key) for storage in the database, with AES-256-GCM.
 * The key comes from SETTINGS_KEY in .env if set; otherwise from a random key file created once
 * in the data volume (mode 600). Either way a copy of the database alone can't reveal the secret.
 */
export function createSecretBox({ envKey = '', keyFile }) {
  let key;
  if (envKey) {
    key = crypto.createHash('sha256').update(envKey).digest();
  } else {
    if (!fs.existsSync(keyFile)) {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    key = crypto.createHash('sha256').update(fs.readFileSync(keyFile, 'utf8').trim()).digest();
  }
  return {
    seal(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
    },
    // Returns null if the value can't be decrypted (e.g. the key changed).
    open(sealed) {
      try {
        const [v, iv, tag, data] = String(sealed).split(':');
        if (v !== 'v1') return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}
