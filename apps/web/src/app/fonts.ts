import { Geist, Inter_Tight } from "next/font/google";

// Closest free matches to the template's "Inter Display" / "Geist". Shared by landing, auth and portal.
export const head = Inter_Tight({ subsets: ["latin", "latin-ext", "cyrillic"], weight: ["400", "500"], display: "swap", variable: "--lp-head" });
export const body = Geist({ subsets: ["latin", "latin-ext", "cyrillic"], weight: ["400", "500"], display: "swap" });
