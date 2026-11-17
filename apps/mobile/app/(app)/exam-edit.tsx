import { useLocalSearchParams } from "expo-router";
import { ExamEditor } from "../../src/features/teacher/ExamEditor";

export default function Route() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ExamEditor id={id ?? "new"} />;
}
