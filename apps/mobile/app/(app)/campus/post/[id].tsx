import { useLocalSearchParams } from "expo-router";
import { PostDetailScreen } from "../../../../src/features/campus/PostDetailScreen";

export default function PostDetailScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PostDetailScreen id={String(id)} />;
}
