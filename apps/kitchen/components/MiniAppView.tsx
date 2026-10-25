import { WebView } from "react-native-webview";

import type { MiniAppSource } from "@shopong/miniapp";
import { useMiniAppDocument } from "./useMiniAppDocument";

// The document is loaded once; any later navigation (links, redirects, window.open) is refused.
const isInitialLoad = (url: string) => url === "about:blank";

export function MiniAppView({ source }: { source: MiniAppSource }) {
  const { html, background } = useMiniAppDocument(source);

  return (
    <WebView
      source={{ html }}
      style={{ flex: 1, backgroundColor: background }}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={(request) => isInitialLoad(request.url)}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      bounces={false}
      overScrollMode="never"
    />
  );
}
