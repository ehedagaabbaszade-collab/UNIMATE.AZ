import { useLocalSearchParams } from "expo-router";
import { TakeExamScreen } from "../../../../src/features/classes/TakeExamScreen";

export default function TakeExamRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TakeExamScreen id={id} />;
}
