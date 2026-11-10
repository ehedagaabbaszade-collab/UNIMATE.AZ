import type { BadgeTone } from "../components/badge-tone";
import type { DocStatus } from "./db";

export const DOC_COLUMNS = "id,title,original_filename,storage_path,mime_type,size_bytes,status,page_count,error,created_at";
export const STATUS_TONE: Record<DocStatus, BadgeTone> = { pending_upload: "neutral", uploaded: "info", processing: "primary", ready: "success", failed: "danger" };
/** Polled states. pending_upload is excluded: an abandoned upload never changes by itself. */
export const isInFlight = (s: DocStatus): boolean => s === "uploaded" || s === "processing";
export const POLL_MS = 4000;

/** Whether any document still needs status polling. */
export const anyInFlight = (docs: readonly { status: DocStatus }[] | undefined): boolean => docs?.some((d) => isInFlight(d.status)) ?? false;

export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
