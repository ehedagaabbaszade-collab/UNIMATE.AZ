import type { CSSProperties, SVGAttributes } from "react";
import { FILE_TYPES, ICON_PATHS, ICON_SIZES, ICON_STROKE, LANGUAGE_ACCENTS, MODULE_TILES, type FileKind, type IconName, type IconSize, type ModuleName, type StatusName } from "./paths";

const px = (size: number | IconSize) => (typeof size === "number" ? size : ICON_SIZES[size]);

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "name" | "children" | "width" | "height"> {
  name: IconName;
  /** Pixels, or a size token (xs 16, sm 20, md 24, lg 32, xl 48). Default md. */
  size?: number | IconSize;
  strokeWidth?: number;
  /** Accessible name (translated by the caller). Omit for decorative icons: they are aria-hidden. */
  label?: string;
}

/** The one icon component. Renders ICON_PATHS[name] as a stroke-only, currentColor SVG on the 24px grid. */
export function Icon({ name, size = "md", strokeWidth = ICON_STROKE, label, className, ...rest }: IconProps) {
  const data = ICON_PATHS[name];
  const s = px(size);
  return (
    <svg
      className={className ? `um-icon ${className}` : "um-icon"}
      width={s}
      height={s}
      viewBox={data.viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      {...rest}
    >
      {data.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** Module icon: white glyph on a rounded gradient tile (as on the brand board). */
export function ModuleIcon({ module, size = 48, label }: { module: ModuleName; size?: number; label?: string }) {
  const [from, to] = MODULE_TILES[module];
  return (
    <span
      className="um-tile"
      style={{ width: size, height: size, background: `linear-gradient(145deg, ${from}, ${to})` }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <Icon name={module} size={Math.round(size * 0.56)} />
    </span>
  );
}

/** File-type icon: accent tile with the extension label (PDF, DOCX, PPTX, XLSX, ZIP) or a glyph (image, video, audio). */
export function FileIcon({ kind, size = 40, label }: { kind: FileKind; size?: number; label?: string }) {
  const { color, label: text } = FILE_TYPES[kind];
  return (
    <span
      className="um-filetile"
      style={{ width: size, height: size, background: color, fontSize: Math.max(8, Math.round(size * 0.27)) }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {text ?? <Icon name={`file-${kind}` as IconName} size={Math.round(size * 0.56)} />}
    </span>
  );
}

const STATUS_VAR: Record<StatusName, string> = {
  success: "var(--accent)",
  info: "var(--info)",
  warning: "var(--warning)",
  error: "var(--danger)",
  pending: "var(--text-muted)",
  locked: "var(--text-muted)",
};

/** Status icon in its semantic (theme-aware) colour. */
export function StatusIcon({ status, size = "md", label }: { status: StatusName; size?: number | IconSize; label?: string }) {
  const style: CSSProperties = { color: STATUS_VAR[status] };
  return <Icon name={status} size={size} style={style} {...(label ? { label } : {})} />;
}

/** Language chip: the code in upper case (AZ, TR, EN, RU) with a small flat accent stripe. */
export function LanguageChip({ code, label }: { code: string; label?: string }) {
  const style = { "--chip-accent": LANGUAGE_ACCENTS[code] ?? "var(--um-indigo)" } as CSSProperties;
  return (
    <span className="um-langchip" style={style} {...(label ? { "aria-label": label } : {})}>
      {code.toUpperCase()}
    </span>
  );
}
