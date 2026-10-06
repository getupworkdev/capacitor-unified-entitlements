import { describe, expect, it } from "vitest";
import { appleAppSiteAssociation, assetLinks, parseAuthCallback } from "../src/index.js";

describe("parseAuthCallback", () => {
  it("reads a PKCE code", () => {
    expect(parseAuthCallback("https://example.app/auth/callback?code=abc123")).toEqual({ kind: "pkce", code: "abc123" });
  });

  it("reads implicit-flow tokens from the hash", () => {
    expect(parseAuthCallback("https://example.app/auth/callback#access_token=a&refresh_token=r&type=magiclink")).toEqual({
      kind: "tokens",
      accessToken: "a",
      refreshToken: "r",
    });
  });

  it("surfaces expired-link errors from query or hash", () => {
    expect(
      parseAuthCallback("https://example.app/auth/callback#error=access_denied&error_description=Email+link+is+invalid+or+has+expired"),
    ).toEqual({ kind: "error", error: "access_denied", description: "Email link is invalid or has expired" });
  });

  it("accepts a custom scheme and a trailing slash", () => {
    expect(parseAuthCallback("myapp://auth/callback?code=x")).toEqual({ kind: "pkce", code: "x" });
    expect(parseAuthCallback("https://example.app/auth/callback/?code=y")).toEqual({ kind: "pkce", code: "y" });
  });

  it("ignores other deep links and junk", () => {
    expect(parseAuthCallback("https://example.app/journal/42")).toEqual({ kind: "not_auth" });
    expect(parseAuthCallback("not a url")).toEqual({ kind: "not_auth" });
  });
});

describe("association files", () => {
  it("builds apple-app-site-association and assetlinks.json", () => {
    expect(appleAppSiteAssociation("ABCDE12345", "app.example.ios").applinks.details[0]).toEqual({
      appIDs: ["ABCDE12345.app.example.ios"],
      components: [{ "/": "/auth/callback*" }],
    });
    expect(assetLinks("app.example.android", ["AA:BB"])[0]!.target.sha256_cert_fingerprints).toEqual(["AA:BB"]);
  });
});
