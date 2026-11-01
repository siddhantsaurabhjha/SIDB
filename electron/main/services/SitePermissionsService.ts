import { and, eq } from "drizzle-orm";
import { sitePermissionSettings } from "../../../database/schema";
import type { Db } from "../db/database";

export interface SitePermission {
  origin: string;
  kind: string;
  decision: "allow" | "block";
}

export class SitePermissionsService {
  constructor(private readonly db: Db) {}

  async list(): Promise<SitePermission[]> {
    const rows = await this.db.orm.select().from(sitePermissionSettings);
    return rows.map(({ origin, kind, decision }) => ({ origin, kind, decision }));
  }

  async set(origin: string, kind: string, decision: "allow" | "block"): Promise<void> {
    await this.db.orm
      .insert(sitePermissionSettings)
      .values({ origin, kind, decision, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: [sitePermissionSettings.origin, sitePermissionSettings.kind], set: { decision, updatedAt: Date.now() } });
  }

  async clear(origin: string, kind: string): Promise<void> {
    await this.db.orm.delete(sitePermissionSettings).where(and(eq(sitePermissionSettings.origin, origin), eq(sitePermissionSettings.kind, kind)));
  }
}
