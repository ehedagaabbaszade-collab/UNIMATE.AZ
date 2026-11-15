import { useT } from "@unimate/i18n/react";
import { ProfileScreen } from "../../src/features/profile/ProfileScreen";
import { ScreenHeader } from "../../src/components/ui";

/** Pushed stack route (back button + swipe back); reached from the Home header and the Settings tab. */
export default function Profile() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t("brand.module.profile")} />
      <ProfileScreen />
    </>
  );
}
