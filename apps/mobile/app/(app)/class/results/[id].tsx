import { useLocalSearchParams } from "expo-router";
import { ExamResultsScreen } from "../../../../src/features/classes/ExamResultsScreen";

export default function ExamResultsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExamResultsScreen id={id} />;
}
