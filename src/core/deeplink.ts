/**
 * Magic links inside a Capacitor app.
 *
 * Supabase sends the user to `redirectTo` after verifying the link. Point that
 * at an https URL on your own domain (for example https://example.app/auth/callback)
 * and register the domain for Universal Links (iOS) and App Links (Android).
 * The OS then opens the app instead of Safari or Chrome, and the app receives
 * the full URL through the appUrlOpen event.
 *
 * Two shapes arrive depending on the Supabase auth flow:
 *   PKCE:     https://example.app/auth/callback?code=...
 *   implicit: https://example.app/auth/callback#access_token=...&refresh_token=...
 * Errors come back as error / error_description in either place.
 */
export type AuthCallback =
  | { kind: "pkce"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "error"; error: string; description: string }
  | { kind: "not_auth" };

export function parseAuthCallback(url: string, callbackPath = "/auth/callback"): AuthCallback {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "not_auth" };
  }
  // Custom schemes (myapp://auth/callback) put the first segment in the host.
  const path = u.protocol === "https:" || u.protocol === "http:" ? u.pathname : `/${u.host}${u.pathname}`;
  if (path.replace(/\/+$/, "") !== callbackPath) return { kind: "not_auth" };

  const query = u.searchParams;
  const hash = new URLSearchParams(u.hash.startsWith("#") ? u.hash.slice(1) : u.hash);
  const pick = (k: string) => query.get(k) ?? hash.get(k);

  const error = pick("error");
  if (error) return { kind: "error", error, description: pick("error_description") ?? "" };

  const code = query.get("code");
  if (code) return { kind: "pkce", code };

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken };

  return { kind: "not_auth" };
}

/** apple-app-site-association body for Universal Links. teamId and bundleId come from App Store Connect. */
export function appleAppSiteAssociation(teamId: string, bundleId: string, paths = ["/auth/callback*"]) {
  return {
    applinks: {
      details: [{ appIDs: [`${teamId}.${bundleId}`], components: paths.map((p) => ({ "/": p })) }],
    },
  };
}

/** assetlinks.json body for Android App Links. Use the Play App Signing SHA-256, not only the upload key. */
export function assetLinks(packageName: string, sha256Fingerprints: string[]) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: sha256Fingerprints },
    },
  ];
}
