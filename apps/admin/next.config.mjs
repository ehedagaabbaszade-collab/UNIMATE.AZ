const dev = process.env.NODE_ENV !== "production";
let supabase = "https://*.supabase.co wss://*.supabase.co";
try {
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  supabase = `${u.origin} wss://${u.host}`;
} catch {
  // unset URL: keep the wildcard fallback
}
// shortcut: 'unsafe-inline' scripts (Next inline bootstrap) until nonce-based CSP is added.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://*.supabase.co",
  `connect-src 'self' ${supabase}${dev ? " ws://localhost:*" : ""}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@unimate/core", "@unimate/i18n", "@unimate/ui"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
