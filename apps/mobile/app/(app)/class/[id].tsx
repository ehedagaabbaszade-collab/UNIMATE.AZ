import { useLocalSearchParams } from "expo-router";
import { ClassScreen } from "../../../src/features/classes/ClassScreen";

export default function ClassRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClassScreen id={id} />;
}
