import type { CSSProperties, ReactNode } from "react";

/**
 * Official brand pack artwork (resized by `npm run brand:build`, served from apps/*\/public/brand).
 * Intrinsic sizes are read from the PNG headers; width/height are always set so the layout never shifts.
 */
export const BRAND_ASSETS = {
  logo: { src: "full-logo.png", w: 800, h: 678 }, // stacked, light backgrounds
  logoWhite: { src: "full-logo-white.png", w: 800, h: 678 }, // stacked, dark backgrounds
  mark: { src: "mark.png", w: 320, h: 375 }, // Icon_Only gradient, light backgrounds
  markWhite: { src: "mark-white.png", w: 320, h: 375 }, // Icon_Only white, dark backgrounds
  wordmark: { src: "wordmark.png", w: 640, h: 131 }, // gradient, light backgrounds
  wordmarkWhite: { src: "wordmark-white.png", w: 640, h: 131 }, // white, dark backgrounds
} as const;

export type BrandVariant = "auto" | "light" | "dark";
type Asset = (typeof BRAND_ASSETS)[keyof typeof BRAND_ASSETS];

interface BrandBase {
  /** Translated accessible name (t("brand.logo") / t("brand.mark")). */
  label: string;
  /** light = artwork for light backgrounds, dark = for dark backgrounds, auto = follows the theme (CSS only, no JS). */
  variant?: BrandVariant;
  /** Public path where /brand/* is served. */
  basePath?: string;
  className?: string;
}

function Img({ asset, h, base }: { asset: Asset; h: number; base: string }) {
  const height = Math.round(h);
  const width = Math.round((h * asset.w) / asset.h);
  return <img src={`${base}/${asset.src}`} width={width} height={height} alt="" decoding="async" draggable={false} />;
}

function Wrap({ label, variant, className, row, children }: { label: string; variant: BrandVariant; className: string | undefined; row?: boolean; children: ReactNode }) {
  const cls = ["um-brand", `um-brand--${variant}`, row && "um-brand--row", className].filter(Boolean).join(" ");
  return (
    <span className={cls} role="img" aria-label={label}>
      {children}
    </span>
  );
}

/**
 * BrandMark: the graduation-cap "U" only. Light = mark.png, dark = mark-white.png.
 * `height` is the rendered height in px.
 */
export function BrandMark({ label, variant = "auto", height = 32, basePath = "/brand", className }: BrandBase & { height?: number }) {
  return (
    <Wrap label={label} variant={variant} className={className}>
      {variant !== "dark" ? (
        <span className="um-brand__pair um-brand__light">
          <Img asset={BRAND_ASSETS.mark} h={height} base={basePath} />
        </span>
      ) : null}
      {variant !== "light" ? (
        <span className="um-brand__pair um-brand__dark">
          <Img asset={BRAND_ASSETS.markWhite} h={height} base={basePath} />
        </span>
      ) : null}
    </Wrap>
  );
}

/**
 * BrandLogo, from the official pack only (never recoloured; light/dark pairs are swapped, not filtered).
 * - layout "stacked" (default): light = full-logo.png, dark = full-logo-white.png.
 * - layout "row": light = mark + wordmark (gradient), dark = mark-white + wordmark-white, side by side.
 * `height` is the total rendered height in px.
 */
export function BrandLogo({ label, variant = "auto", layout = "stacked", height = 96, basePath = "/brand", className }: BrandBase & { layout?: "stacked" | "row"; height?: number }) {
  const row = layout === "row";
  const wordH = (height * 3.1 * BRAND_ASSETS.wordmark.h) / BRAND_ASSETS.wordmark.w;
  const gap: CSSProperties = { gap: Math.round(height * 0.22) };
  const pair = (mark: Asset, word: Asset, full: Asset) =>
    row ? (
      <>
        <Img asset={mark} h={height} base={basePath} />
        <Img asset={word} h={wordH} base={basePath} />
      </>
    ) : (
      <Img asset={full} h={height} base={basePath} />
    );
  return (
    <Wrap label={label} variant={variant} className={className} row={row}>
      {variant !== "dark" ? (
        <span className="um-brand__pair um-brand__light" style={row ? gap : undefined}>
          {pair(BRAND_ASSETS.mark, BRAND_ASSETS.wordmark, BRAND_ASSETS.logo)}
        </span>
      ) : null}
      {variant !== "light" ? (
        <span className="um-brand__pair um-brand__dark" style={row ? gap : undefined}>
          {pair(BRAND_ASSETS.markWhite, BRAND_ASSETS.wordmarkWhite, BRAND_ASSETS.logoWhite)}
        </span>
      ) : null}
    </Wrap>
  );
}
