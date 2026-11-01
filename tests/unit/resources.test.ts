import { describe, expect, it } from "vitest";
import { DEFAULT_GPU_STATE, GPU_CRASH_WINDOW_MS, nextPressure, parseGpuState, protectedReason, recordGpuCrash, sleepCandidates, type SleepCandidate } from "../../shared/resources";

describe("memory pressure", () => {
  it("rises with falling free memory", () => {
    expect(nextPressure("normal", 40)).toBe("normal");
    expect(nextPressure("normal", 14)).toBe("elevated");
    expect(nextPressure("normal", 5)).toBe("critical");
  });

  it("does not flicker near a threshold (hysteresis)", () => {
    let p = nextPressure("normal", 14); // elevated
    p = nextPressure(p, 16); // still elevated: must climb above 20 to leave
    expect(p).toBe("elevated");
    p = nextPressure(p, 21);
    expect(p).toBe("normal");
    p = nextPressure("critical", 10); // must climb above 12 to leave critical
    expect(p).toBe("critical");
    expect(nextPressure("critical", 13)).toBe("elevated");
    expect(nextPressure("critical", 30)).toBe("normal");
  });

  it("ignores broken readings", () => {
    expect(nextPressure("elevated", Number.NaN)).toBe("elevated");
  });
});

const tab = (over: Partial<SleepCandidate> & { id: string }): SleepCandidate => ({
  active: false,
  pinned: false,
  audible: false,
  loading: false,
  capturing: false,
  idle: false,
  lastActiveAt: 0,
  ...over,
});

describe("sleep candidates", () => {
  it("never offers protected tabs", () => {
    const tabs = [
      tab({ id: "active", active: true }),
      tab({ id: "music", audible: true }),
      tab({ id: "call", capturing: true }),
      tab({ id: "pinned", pinned: true }),
      tab({ id: "loading", loading: true }),
      tab({ id: "asleep", idle: true }),
      tab({ id: "ok" }),
    ];
    expect(sleepCandidates(tabs)).toEqual(["ok"]);
    expect(protectedReason(tabs[1])).toBe("playing sound");
    expect(protectedReason(tabs[2])).toMatch(/camera/);
  });

  it("orders least recently used first", () => {
    expect(sleepCandidates([tab({ id: "b", lastActiveAt: 20 }), tab({ id: "a", lastActiveAt: 10 }), tab({ id: "c", lastActiveAt: 30 })])).toEqual(["a", "b", "c"]);
  });
});

describe("GPU crash guard", () => {
  it("turns acceleration off after 3 crashes within 10 minutes", () => {
    let s = DEFAULT_GPU_STATE;
    s = recordGpuCrash(s, 1_000);
    s = recordGpuCrash(s, 2_000);
    expect(s.hardwareAcceleration).toBe(true);
    s = recordGpuCrash(s, 3_000);
    expect(s).toEqual({ hardwareAcceleration: false, autoDisabled: true, recentCrashes: [] });
  });

  it("forgets crashes older than the window", () => {
    let s = DEFAULT_GPU_STATE;
    s = recordGpuCrash(s, 0);
    s = recordGpuCrash(s, 1);
    s = recordGpuCrash(s, GPU_CRASH_WINDOW_MS + 10);
    expect(s.hardwareAcceleration).toBe(true);
    expect(s.recentCrashes).toEqual([GPU_CRASH_WINDOW_MS + 10]);
  });

  it("parses stored state defensively", () => {
    expect(parseGpuState(null)).toEqual(DEFAULT_GPU_STATE);
    expect(parseGpuState({ hardwareAcceleration: "no", recentCrashes: [1, "x", Infinity] })).toEqual({ hardwareAcceleration: true, autoDisabled: false, recentCrashes: [1] });
    expect(parseGpuState({ hardwareAcceleration: false, autoDisabled: true })).toEqual({ hardwareAcceleration: false, autoDisabled: true, recentCrashes: [] });
  });
});
