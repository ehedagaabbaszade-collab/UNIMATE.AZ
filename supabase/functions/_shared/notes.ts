// Adapters for the NOTES edge functions (Deno, UNTESTED; logic lives in packages/pipeline/src/import-resource.ts).
import { assertStoragePath, type ImportDeps } from "@unimate/pipeline";
import { executor, serviceClient } from "./runtime.ts";

export const RESOURCES_BUCKET = "resources";

/** Resource read as the CALLER (role authenticated + jwt sub): RLS decides visibility, exactly like the app. */
export const resourceReader: ImportDeps["resources"] = {
  getVisible: (userId, id) =>
    executor.user(userId, async (q) => {
      const r = await q.query(
        "select id, uploader_id, title, storage_path, mime_type, size_bytes, original_filename, course_id, status from public.resources where id = $1",
        [id],
      );
      const x = r.rows[0] as Record<string, unknown> | undefined;
      return x
        ? {
            id: x.id as string, uploaderId: x.uploader_id as string, title: x.title as string,
            storagePath: x.storage_path as string | null, mimeType: x.mime_type as string | null,
            sizeBytes: x.size_bytes === null ? null : Number(x.size_bytes), originalFilename: x.original_filename as string | null,
            courseId: x.course_id as string | null, status: x.status as "pending" | "published" | "removed",
          }
        : null;
    }),
};

export const importAdapters = (): Pick<ImportDeps, "documents" | "storage"> => {
  const sb = serviceClient();
  return {
    documents: {
      findByIdempotencyKey: (userId, key) =>
        executor.service(async (q) => {
          const r = await q.query("select id, status from public.documents where user_id = $1 and idempotency_key = $2", [userId, key]);
          return (r.rows[0] as { id: string; status: string } | undefined) ?? null;
        }),
      insertUploaded: (d) =>
        executor.service(async (q) => {
          const r = await q.query(
            `insert into public.documents (user_id, title, course_id, original_filename, storage_path, mime_type, size_bytes, idempotency_key, status)
             values ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded') returning id`,
            [d.userId, d.title, d.courseId, d.originalFilename, d.storagePath, d.mimeType, d.sizeBytes, d.idempotencyKey],
          );
          return r.rows[0] as { id: string };
        }),
      remove: (id) => executor.service(async (q) => void (await q.query("delete from public.documents where id = $1", [id]))),
    },
    storage: {
      async copyToDocuments(src, dest) {
        assertStoragePath(src);
        assertStoragePath(dest);
        const { error } = await sb.storage.from(RESOURCES_BUCKET).copy(src, dest, { destinationBucket: "documents" });
        if (error) throw new Error("storage copy failed");
      },
      async removeDocument(dest) {
        assertStoragePath(dest);
        await sb.storage.from("documents").remove([dest]);
      },
    },
  };
};
