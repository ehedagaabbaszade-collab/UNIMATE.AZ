/** Quota periods are UTC calendar days / months (assumption; Asia/Baku is UTC+4 with no DST). */
export const dayStart = (now: Date): string => now.toISOString().slice(0, 10);
export const monthStart = (now: Date): string => `${now.toISOString().slice(0, 7)}-01`;
