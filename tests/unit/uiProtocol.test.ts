import path from "node:path";
import { describe, expect, it } from "vitest";
import { uiFileFor } from "../../electron/main/windows/uiPath";
import { isUiUrl, UI_URL } from "../../shared/uiUrl";

const root = path.resolve("/app/dist");

describe("sidb-app:// file mapping", () => {
  it("serves files inside the UI folder", () => {
    expect(uiFileFor("sidb-app://ui/index.html", root)).toBe(path.join(root, "index.html"));
    expect(uiFileFor("sidb-app://ui/", root)).toBe(path.join(root, "index.html"));
    expect(uiFileFor("sidb-app://ui/assets/index-abc.js?x=1#y", root)).toBe(path.join(root, "assets", "index-abc.js"));
  });

  it("never leaves the UI folder", () => {
    // The URL parser collapses "/../" and "/%2e%2e/" itself; whatever comes out must be null or inside the folder.
    const attempts = [
      "sidb-app://ui/../package.json",
      "sidb-app://ui/%2e%2e/package.json",
      "sidb-app://ui/assets/%2e%2e%2f%2e%2e%2fsecret",
      "sidb-app://ui/..%5c..%5cwindows%5cwin.ini",
      "sidb-app://ui/%2e%2e%5c%2e%2e%5cwin.ini",
    ];
    for (const a of attempts) {
      const f = uiFileFor(a, root);
      expect(f === null || f.startsWith(root + path.sep), `${a} -> ${f}`).toBe(true);
    }
    // Encoded separators and dots that would only become a path after decoding are refused outright.
    expect(uiFileFor("sidb-app://ui/assets/%2e%2e%2f%2e%2e%2fsecret", root)).toBeNull();
    expect(uiFileFor("sidb-app://ui/..%5c..%5cwindows%5cwin.ini", root)).toBeNull();
  });

  it("refuses other schemes, hosts and broken encoding", () => {
    for (const bad of ["sidb-app://ui/%00.js", "sidb-app://ui/%E0%A4%A", "sidb-app://other/index.html", "file:///C:/Windows/win.ini", "https://ui/index.html", "not a url"]) {
      expect(uiFileFor(bad, root), bad).toBeNull();
    }
  });
});

describe("UI url check", () => {
  it("accepts only the interface page", () => {
    expect(isUiUrl(UI_URL)).toBe(true);
    expect(isUiUrl("sidb-app://ui/index.html#x")).toBe(true);
    expect(isUiUrl("sidb-app://ui/other.html")).toBe(false);
    expect(isUiUrl("sidb-app://evil/index.html")).toBe(false);
    expect(isUiUrl("file:///C:/SIDB/dist/index.html")).toBe(false);
    expect(isUiUrl("http://localhost:5173/")).toBe(false);
    expect(isUiUrl("http://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(isUiUrl("http://localhost:5174/", "http://localhost:5173")).toBe(false);
  });
});
