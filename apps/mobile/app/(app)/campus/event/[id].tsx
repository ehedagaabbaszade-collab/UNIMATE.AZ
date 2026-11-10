import { useLocalSearchParams } from "expo-router";
import { EventDetailScreen } from "../../../../src/features/campus/EventDetailScreen";

export default function EventDetailScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EventDetailScreen id={String(id)} />;
}
