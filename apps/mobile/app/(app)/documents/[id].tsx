import { useLocalSearchParams } from "expo-router";
import { DocumentDetail } from "../../../src/features/documents/DocumentDetail";

export default function DocumentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentDetail documentId={String(id)} />;
}
