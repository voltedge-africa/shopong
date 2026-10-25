import { Asset } from "expo-asset";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Spinner } from "panelui-native";

import { isReadyMessage } from "../lib/bundleMessages";

type Props = { asset: number; messages: readonly unknown[] };

// Without `allow-same-origin` the frame gets an opaque origin and cannot reach the app's storage.
export function BundleMiniApp({ asset, messages }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !isReadyMessage(event.data)) return;
      for (const message of messages)
        frame.current.contentWindow?.postMessage(JSON.stringify(message), "*");
      setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [messages]);

  return (
    <View className="flex-1 bg-background">
      <iframe
        ref={frame}
        title="Mini app"
        src={Asset.fromModule(asset).uri}
        sandbox="allow-scripts"
        style={{ flex: 1, width: "100%", border: 0, backgroundColor: "#0e1116" }}
      />
      {ready ? null : (
        <View className="absolute inset-0 items-center justify-center bg-background">
          <Spinner />
        </View>
      )}
    </View>
  );
}
