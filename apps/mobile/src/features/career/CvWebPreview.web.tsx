import { View, useWindowDimensions } from "react-native";
import { Skeleton } from "../../components/ui";

const PAGE_PX = 794;
/** Web (dev inspection) twin of CvWebPreview: sandboxed iframe, no scripts. */
export function CvWebPreview({ html, height }: { html: string | null; height?: number }) {
  const { height: wh } = useWindowDimensions();
  const h = height ?? Math.round(wh * 0.7);
  if (html === null) return <Skeleton height={h} />;
  const shown = html.replace(/<meta name="viewport"[^>]*>/, `<meta name="viewport" content="width=${PAGE_PX}">`);
  return (
    <View style={{ height: h, borderRadius: 8, overflow: "hidden", backgroundColor: "#FFFFFF" }}>
      <iframe srcDoc={shown} sandbox="allow-same-origin" style={{ border: 0, width: "100%", height: "100%" }} />
    </View>
  );
}
