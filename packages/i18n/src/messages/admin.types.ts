import type { adminEn } from "./admin.en";

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
/** Shape of the admin catalog: every locale must provide exactly the keys of admin.en.ts. */
export type AdminMessages = DeepString<typeof adminEn>;
