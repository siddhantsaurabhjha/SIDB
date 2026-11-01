import { describe, expect, it } from "vitest";
import { refuseRemoteDebugging } from "../../electron/main/security/remoteDebugging";

const switches = (...names: string[]) => (s: string) => names.includes(s);

describe("remote debugging guard", () => {
  it("refuses a debugging port or pipe on the normal profile of an installed SIDB", () => {
    expect(refuseRemoteDebugging(true, switches("remote-debugging-port"))).toBe(true);
    expect(refuseRemoteDebugging(true, switches("remote-debugging-pipe"))).toBe(true);
  });

  it("allows it with a separate data folder, or when running from source", () => {
    expect(refuseRemoteDebugging(true, switches("remote-debugging-port", "user-data-dir"))).toBe(false);
    expect(refuseRemoteDebugging(false, switches("remote-debugging-port"))).toBe(false);
  });

  it("does nothing on a normal start", () => {
    expect(refuseRemoteDebugging(true, switches())).toBe(false);
  });
});
