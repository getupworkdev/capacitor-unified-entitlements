import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAuthCallback } from "../core/deeplink.js";

/**
 * Finish a magic-link sign-in inside the native app.
 *
 * Send the link with:
 *   supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: "https://example.app/auth/callback" } })
 * and add that URL to Supabase > Auth > URL Configuration > Redirect URLs.
 * With Universal Links / App Links configured, tapping the link opens the app
 * and lands here instead of in the browser.
 */
export function listenForAuthLinks(supabase: SupabaseClient, onError: (message: string) => void) {
  if (!Capacitor.isNativePlatform()) return;

  App.addListener("appUrlOpen", async ({ url }) => {
    const cb = parseAuthCallback(url);
    switch (cb.kind) {
      case "pkce": {
        const { error } = await supabase.auth.exchangeCodeForSession(cb.code);
        if (error) onError(error.message);
        break;
      }
      case "tokens": {
        const { error } = await supabase.auth.setSession({ access_token: cb.accessToken, refresh_token: cb.refreshToken });
        if (error) onError(error.message);
        break;
      }
      case "error":
        onError(cb.description || cb.error); // most often an expired or already-used link
        break;
      case "not_auth":
        break;
    }
  });
}
