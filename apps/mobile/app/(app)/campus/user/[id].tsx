import { useLocalSearchParams } from "expo-router";
import { UserScreen } from "../../../../src/features/campus/UserScreen";

export default function UserScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <UserScreen id={String(id)} />;
}
