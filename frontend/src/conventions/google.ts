/** The Google OAuth client id, injected at build time. Absent → dev/keyless stub sign-in (FE-02). */
export function googleClientId(): string | undefined {
  return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID || undefined;
}
