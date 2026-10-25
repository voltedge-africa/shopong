import type { MiniAppSource } from "@shopong/miniapp";
import { useMiniAppDocument } from "./useMiniAppDocument";

// Without `allow-same-origin` the frame gets an opaque origin: it can run its own script but
// cannot reach the app's storage, cookies or DOM.
export function MiniAppView({ source }: { source: MiniAppSource }) {
  const { html, background } = useMiniAppDocument(source);

  return (
    <iframe
      title="Mini app"
      srcDoc={html}
      sandbox="allow-scripts"
      style={{ flex: 1, width: "100%", border: 0, backgroundColor: background }}
    />
  );
}
