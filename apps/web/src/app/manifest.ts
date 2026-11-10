import type { MetadataRoute } from "next";
import { createTranslator } from "@unimate/i18n";

// Brand colours (docs/BRAND_IDENTITY.md): theme = Indigo #4F46E5, background = Cloud #F1F5FF.
export default function manifest(): MetadataRoute.Manifest {
  const t = createTranslator("az"); // default language; the manifest is static per deployment
  return {
    name: "UNIMATE.AZ",
    short_name: "UNIMATE",
    description: t("meta.description"),
    lang: "az",
    dir: "ltr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#4f46e5",
    background_color: "#f1f5ff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
