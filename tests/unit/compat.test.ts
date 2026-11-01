import { describe, expect, it } from "vitest";
import { chromiumUserAgent, GOOGLE_SIGNIN_URL, googleSigninRejection } from "../../shared/compat";

describe("Google sign-in rejection page", () => {
  it("recognises the page SIDB actually received", () => {
    // Copied from a real run (account part replaced).
    const real =
      "https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fmyaccount.google.com%2F&dsh=S1%3A1&epd=Ae_x&flowEntry=ServiceLogin&flowName=GlifWebSignIn&idnf=someone%40gmail.com&rhlk=le&rrk=46";
    expect(googleSigninRejection(real)).toEqual({ continueUrl: "https://myaccount.google.com/", site: null });
  });

  it("for Sign in with Google on another site, opens that site (from a real OAuth rejection)", () => {
    const real =
      "https://accounts.google.com/v3/signin/rejected?access_type=offline&app_domain=https%3A%2F%2Fdevelopers.google.com&client_id=407408718192.apps.googleusercontent.com&continue=https%3A%2F%2Faccounts.google.com%2Fsignin%2Foauth%2Fv3%2Fconsent%3Fpart%3DAJi8x&flowName=GeneralOAuthFlow&redirect_uri=https%3A%2F%2Fdevelopers.google.com%2Foauthplayground&response_type=code&rrk=46&scope=email";
    expect(googleSigninRejection(real)).toEqual({ continueUrl: "https://developers.google.com/", site: "developers.google.com" });
  });

  it("falls back to the continue address when the OAuth redirect is not plain https", () => {
    const r = googleSigninRejection("https://accounts.google.com/v3/signin/rejected?client_id=x&redirect_uri=com.example.app%3A%2Fcb&continue=https%3A%2F%2Fmyaccount.google.com%2F");
    expect(r).toEqual({ continueUrl: "https://myaccount.google.com/", site: null });
  });

  it("recognises older paths", () => {
    expect(googleSigninRejection("https://accounts.google.com/signin/rejected?continue=https://mail.google.com/")).not.toBeNull();
    expect(googleSigninRejection("https://accounts.google.com/signin/v2/rejected")).not.toBeNull();
  });

  it("never hands anything but https to the operating system", () => {
    for (const bad of ["javascript:alert(1)", "file:///C:/x", "http://example.com/", "sidb://settings", "https://user:pw@example.com/"]) {
      expect(googleSigninRejection(`https://accounts.google.com/v3/signin/rejected?continue=${encodeURIComponent(bad)}`)?.continueUrl).toBe(GOOGLE_SIGNIN_URL);
    }
    expect(googleSigninRejection("https://accounts.google.com/v3/signin/rejected")?.continueUrl).toBe(GOOGLE_SIGNIN_URL);
  });

  it("ignores everything else", () => {
    for (const url of [
      "https://accounts.google.com/v3/signin/identifier?continue=x",
      "https://evil.example/v3/signin/rejected",
      "https://accounts.google.com.evil.example/v3/signin/rejected",
      "http://accounts.google.com/v3/signin/rejected",
      "https://www.google.com/",
      "not a url",
    ]) {
      expect(googleSigninRejection(url), url).toBeNull();
    }
  });
});

describe("user agent", () => {
  const electron = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SIDB/0.1.0 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36";
  it("is Chromium's own string: no Electron or app token, reduced version", () => {
    expect(chromiumUserAgent(electron)).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36");
  });
  it("adds nothing that claims to be another browser", () => {
    expect(chromiumUserAgent(electron)).not.toMatch(/Edg|Firefox|OPR|Brave|Electron|SIDB/i);
  });
});
