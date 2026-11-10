import * as Linking from "expo-linking";

/** Deep link Supabase redirects to after email confirmation / password reset (scheme `unimate`, see app.json). */
export const authRedirect = (next?: "reset-password"): string => Linking.createURL("auth/callback", next ? { queryParams: { next } } : {});
