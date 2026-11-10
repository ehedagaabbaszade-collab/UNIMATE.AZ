import { useLocalSearchParams } from "expo-router";
import { ProgramScreen } from "../../../../src/features/colleges/CollegesScreen";

export default function ProgramRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProgramScreen id={String(id)} />;
}
