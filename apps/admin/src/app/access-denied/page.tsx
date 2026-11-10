import { ErrorState } from "@unimate/ui";
import Link from "next/link";
import { BackendNotConfigured } from "../../components/BackendNotConfigured";
import { AppLogo } from "../../components/brand";
import { SignOutButton } from "../../components/SignOutButton";
import { getT } from "../../i18n/server";
import { getStaffSession } from "../../lib/session";

/** Shows NO data: just the explanation, a way back (for staff with a narrower role) and sign-out. */
export default async function AccessDeniedPage() {
  const s = await getStaffSession();
  if (s.state === "unconfigured") return <BackendNotConfigured />;
  const { t } = await getT();
  return (
    <main className="center-page" id="main">
      <div className="brand-screen" style={{ maxWidth: 560 }}>
        <AppLogo kind="mark" height={72} />
        <ErrorState
          title={t("admin.denied.title")}
          description={t("admin.denied.body")}
          action={
            <div className="row" style={{ justifyContent: "center" }}>
              {s.state === "ok" ? (
                <Link className="um-btn" href="/">
                  {t("admin.denied.home")}
                </Link>
              ) : null}
              {s.state !== "anonymous" ? <SignOutButton /> : null}
            </div>
          }
        />
      </div>
    </main>
  );
}
