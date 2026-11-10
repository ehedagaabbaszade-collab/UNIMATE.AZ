import type { Locale } from "./locales";
import { az } from "./messages/az";
import { en, type Messages } from "./messages/en";
import { ru } from "./messages/ru";
import { tr } from "./messages/tr";

export type { Messages };
/** English defines the `Messages` shape; every other catalog must `satisfies Messages`. */
export const catalogs: Readonly<Record<Locale, Messages>> = { az, tr, en, ru };
