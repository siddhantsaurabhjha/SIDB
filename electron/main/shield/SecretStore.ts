import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

/**
 * Small encrypted key store (API keys). Values are encrypted with the OS credential facility via
 * Electron safeStorage. If the OS can't encrypt, nothing is stored: we never fall back to plain text.
 */
export class SecretStore {
  constructor(private readonly file: string) {}

  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
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

  set(name: string, value: string): void {
    if (!this.isAvailable()) throw new Error("Secure storage is not available on this system, so the key can't be saved safely.");
    const data = this.read();
    data[name] = safeStorage.encryptString(value).toString("base64");
    this.write(data);
  }

  get(name: string): string | null {
    const enc = this.read()[name];
    if (!enc || !this.isAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, "base64"));
    } catch {
      return null;
    }
  }

  has(name: string): boolean {
    return name in this.read();
  }

  delete(name: string): void {
    const data = this.read();
    delete data[name];
    this.write(data);
  }
}
