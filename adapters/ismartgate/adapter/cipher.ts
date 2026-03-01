import { createCipheriv, createDecipheriv, createHash, randomUUID } from "node:crypto";

const BLOCK_SIZE = 16;

export class ISmartGateCipher {
  private readonly key: Buffer;
  readonly token: string;

  constructor(username: string, password: string) {
    const sha1hex = createHash("sha1")
      .update(username.toLowerCase() + password)
      .digest("hex");

    // Key derivation: specific character positions from SHA1 hex
    const keyStr =
      sha1hex.slice(32, 36) + "a" +
      sha1hex.slice(7, 10) + "!" +
      sha1hex.slice(18, 21) + "*#" +
      sha1hex.slice(24, 26);
    this.key = Buffer.from(keyStr, "utf-8"); // 16 bytes = AES-128

    this.token = createHash("sha1")
      .update(username.toLowerCase() + "@ismartgate")
      .digest("hex");
  }

  encrypt(plaintext: string): string {
    // IV: 16 hex chars from UUID (matches Python lib's uuid.uuid4().hex[:16])
    const ivStr = randomUUID().replace(/-/g, "").slice(0, BLOCK_SIZE);
    const ivBytes = Buffer.from(ivStr, "utf-8");

    // PKCS5-pad plaintext as string, then encode to UTF-8 bytes
    const paddedStr = pkcs5PadString(plaintext);
    const paddedBytes = Buffer.from(paddedStr, "utf-8");

    const cipher = createCipheriv("aes-128-cbc", this.key, ivBytes);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(paddedBytes), cipher.final()]);

    // Output: IV bytes (as UTF-8 string) + base64(ciphertext)
    return ivStr + encrypted.toString("base64");
  }

  decrypt(encoded: string): string {
    // First 16 bytes of UTF-8 encoded content = IV
    const encodedBytes = Buffer.from(encoded, "utf-8");
    const ivBytes = encodedBytes.subarray(0, BLOCK_SIZE);

    // Rest is base64-encoded ciphertext
    const ciphertextB64 = encoded.slice(BLOCK_SIZE);
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    const decipher = createDecipheriv("aes-128-cbc", this.key, ivBytes);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return pkcs5UnpadBytes(decrypted).toString("utf-8");
  }
}

/** PKCS5-pad a string using chr() values (matches Python implementation). */
function pkcs5PadString(data: string): string {
  const padLen = BLOCK_SIZE - (data.length % BLOCK_SIZE);
  return data + String.fromCharCode(padLen).repeat(padLen);
}

/** Remove PKCS5 padding from decrypted bytes. */
function pkcs5UnpadBytes(data: Buffer): Buffer {
  if (data.length === 0) return data;
  const padLen = data[data.length - 1]!;
  if (padLen < 1 || padLen > BLOCK_SIZE) return data;
  return data.subarray(0, data.length - padLen);
}
