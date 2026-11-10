import { useLocalSearchParams } from "expo-router";
import { CollegeScreen } from "../../../src/features/colleges/CollegesScreen";

export default function CollegeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CollegeScreen id={String(id)} />;
}
