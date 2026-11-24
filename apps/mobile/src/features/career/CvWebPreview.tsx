import { View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import { Skeleton } from "../../components/ui";

const PAGE_PX = 794; // A4 at 96dpi: the viewport width the renderer lays out for; the WebView scales it to the screen
/** Read-only render of the renderer's HTML. No JavaScript, and nothing but the initial document may load (links are inert). */
export function CvWebPreview({ html, height }: { html: string | null; height?: number }) {
  const { height: wh } = useWindowDimensions();
  // Callers debounce; only the viewport is fixed up here.
  const shown = html === null ? null : html.replace(/<meta name="viewport"[^>]*>/, `<meta name="viewport" content="width=${PAGE_PX}">`);
  const h = height ?? Math.round(wh * 0.7);
  if (shown === null) return <Skeleton height={h} />;
  return (
    <View style={{ height: h, borderRadius: 8, overflow: "hidden", backgroundColor: "#FFFFFF" }}>
      <WebView
        source={{ html: shown }}
        originWhitelist={["about:*", "data:*"]}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url.startsWith("data:")}
        setSupportMultipleWindows={false}
        nestedScrollEnabled
      />
    </View>
  );
}
