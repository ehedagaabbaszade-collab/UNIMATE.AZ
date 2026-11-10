import { useLocalSearchParams } from "expo-router";
import { CommunityScreen } from "../../../../src/features/campus/CommunityScreen";

export default function CommunityScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CommunityScreen id={String(id)} />;
}
