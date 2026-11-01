import path from "node:path";
import { app } from "electron";
import { getProfiles } from "../profiles/instance";
import { SecretStore } from "./SecretStore";
import { ShieldService } from "./ShieldService";

let secrets: SecretStore | null = null;
let shield: ShieldService | null = null;

export function getSecrets(): SecretStore {
  return (secrets ??= new SecretStore(path.join(app.getPath("userData"), "secrets.json")));
}

/** One Shield engine for the whole app; created lazily after Electron is ready. */
export function getShield(): ShieldService {
  return (shield ??= new ShieldService(path.join(app.getPath("userData"), "shield"), getSecrets(), () => getProfiles().broadcast("shield")));
}
