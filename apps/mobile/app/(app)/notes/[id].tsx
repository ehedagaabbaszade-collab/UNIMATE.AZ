import { useLocalSearchParams } from "expo-router";
import { NoteDetailScreen } from "../../../src/features/notes/NoteDetailScreen";

export default function NoteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <NoteDetailScreen id={String(id)} />;
}
