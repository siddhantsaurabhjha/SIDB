import { ProfileManager } from "./ProfileManager";

let instance: ProfileManager | null = null;

/** Lazily created so nothing touches app paths before Electron is ready. */
export function getProfiles(): ProfileManager {
  return (instance ??= new ProfileManager());
}
