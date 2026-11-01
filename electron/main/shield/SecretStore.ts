import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

/** If the OS key store never answers, report "not available" instead of waiting forever. */
const AVAILABILITY_TIMEOUT_MS = 10_000;

/**
 * Small encrypted key store (API keys). Values are encrypted with the OS credential facility via Electron's
 * asynchronous safeStorage API. If the OS can't encrypt, nothing is stored: we never fall back to plain text.
 *
 * Only the async API is used. The old synchronous one is deprecated and, on a fresh Windows profile, blocked the whole
 * main process while the OS key was first being set up (seen on a clean CI machine: SIDB froze on the Shield status).
 * Values saved with the old API can still be decrypted.
 */
export class SecretStore {
  constructor(private readonly file: string) {}

  async isAvailable(): Promise<boolean> {
    try {
      return await Promise.race([
        safeStorage.isAsyncEncryptionAvailable(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), AVAILABILITY_TIMEOUT_MS).unref()),
      ]);
    } catch {
      return false;
    }
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, string>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(data: Record<string, string>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  async set(name: string, value: string): Promise<void> {
    if (!(await this.isAvailable())) throw new Error("Secure storage is not available on this system, so the key can't be saved safely.");
    const encrypted = await safeStorage.encryptStringAsync(value);
    const data = this.read();
    data[name] = encrypted.toString("base64");
    this.write(data);
  }

  async get(name: string): Promise<string | null> {
    const enc = this.read()[name];
    if (!enc || !(await this.isAvailable())) return null;
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(enc, "base64"));
      // The OS key was rotated (or a stronger one is available): store the value again with the current key.
      if (shouldReEncrypt) await this.set(name, result).catch(() => undefined);
      return result;
    } catch {
      return null;
    }
  }

  /** Whether a value is stored (reads the file only; no decryption). */
  has(name: string): boolean {
    return name in this.read();
  }

  delete(name: string): void {
    const data = this.read();
    delete data[name];
    this.write(data);
  }
}
