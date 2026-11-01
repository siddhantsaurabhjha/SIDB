import { describe, expect, it } from "vitest";
import { detectImage, mimeForExt } from "../../electron/main/capture/imageTypes";

describe("image type detection", () => {
  it("recognizes PNG, JPEG and WebP by content", () => {
    expect(detectImage(Buffer.from("89504e470d0a1a0a00", "hex"))).toEqual({ ext: "png", mime: "image/png" });
    expect(detectImage(Buffer.from("ffd8ffe000104a46", "hex"))).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(detectImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toEqual({ ext: "webp", mime: "image/webp" });
  });

  it("rejects everything else, whatever the file name says", () => {
    expect(detectImage(Buffer.from("<svg onload=alert(1)></svg>"))).toBeNull();
    expect(detectImage(Buffer.from("GIF89a"))).toBeNull();
    expect(detectImage(Buffer.from("MZ\u0090\u0000"))).toBeNull(); // an .exe renamed to .png
    expect(detectImage(Buffer.alloc(0))).toBeNull();
    expect(mimeForExt("svg")).toBeNull();
  });
});
