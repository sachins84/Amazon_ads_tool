/**
 * AES-256-GCM encryption for storing OAuth tokens at rest.
 * Key is derived from ENCRYPTION_SECRET in .env.local.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET is not set in .env.local");
  // Derive a 32-byte key from the secret
  return scryptSync(secret, "amazon-ads-salt", 32);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv  = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: iv(12) + tag(16) + ciphertext — all as hex
  return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

export function decrypt(hex: string): string {
  const key  = getKey();
  const buf  = Buffer.from(hex, "hex");
  const iv   = buf.subarray(0, 12);
  const tag  = buf.subarray(12, 28);
  const data = buf.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
