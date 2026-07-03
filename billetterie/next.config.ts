import type { NextConfig } from "next";

// En-têtes de sécurité de base — HSTS, TLS et le reste sont gérés en amont
// par Nginx Proxy Manager + Cloudflare.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera=(self) : la page de scan utilise la caméra du téléphone.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Ne pas divulguer "X-Powered-By: Next.js" (fingerprinting / reconnaissance)
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
