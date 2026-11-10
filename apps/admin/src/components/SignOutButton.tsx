"use client";

import { Button } from "@unimate/ui";
import { useT } from "@unimate/i18n/react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "../lib/supabase/browser";

export function SignOutButton() {
  const t = useT();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await getBrowserClient().auth.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      {t("admin.denied.signOut")}
    </Button>
  );
}
