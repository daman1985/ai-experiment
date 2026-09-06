import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function getKey(): Buffer {
  const keyString = process.env.ENCRYPTION_KEY;
  if (!keyString) {
    throw new Error("ENCRYPTION_KEY environment variable is not set.");
  }
  const key = Buffer.from(keyString, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be a base64 string decoding to exactly 32 bytes. Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  authTag: string;
}

// AES-256-GCM: a fresh random IV per call, auth tag verified on decrypt so
// tampering or a wrong key fails loudly instead of returning garbage. Used
// only for API keys stored in ProviderConfig -- never for anything that
// needs to be searchable or compared in the database.
export function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
