import { useLocalSearchParams } from "expo-router";
import { OpportunityDetailScreen } from "../../../src/features/career/OpportunityDetailScreen";

export default function OpportunityRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OpportunityDetailScreen id={String(id)} />;
}
