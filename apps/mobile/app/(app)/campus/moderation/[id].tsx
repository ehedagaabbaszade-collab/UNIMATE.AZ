import { useLocalSearchParams } from "expo-router";
import { ModerationScreen } from "../../../../src/features/campus/ModerationScreen";

export default function ModerationScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ModerationScreen id={String(id)} />;
}
