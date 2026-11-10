import { useLocalSearchParams } from "expo-router";
import { CvEditorScreen } from "../../../../src/features/career/CvEditorScreen";

export default function CvRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CvEditorScreen id={String(id)} />;
}
