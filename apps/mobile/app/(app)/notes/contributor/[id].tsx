import { useLocalSearchParams } from "expo-router";
import { ContributorScreen } from "../../../../src/features/notes/ContributorScreen";

export default function ContributorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ContributorScreen userId={String(id)} />;
}
