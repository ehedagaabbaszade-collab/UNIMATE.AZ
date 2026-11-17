import { useLocalSearchParams } from "expo-router";
import { AssignmentScreen } from "../../../../src/features/classes/AssignmentScreen";

export default function AssignmentRoute() {
  const { id, cls } = useLocalSearchParams<{ id: string; cls: string }>();
  return <AssignmentScreen id={id} cls={cls} />;
}
