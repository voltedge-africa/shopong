import { Asset } from "expo-asset";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { Spinner } from "panelui-native";

import { isReadyMessage, themeMessage } from "../lib/bundleMessages";

type Props = { asset: number; messages: readonly unknown[] };

// Without `allow-same-origin` the frame gets an opaque origin and cannot reach the app's storage.
export function BundleMiniApp({ asset, messages }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  // The page dresses in the app's own theme: it hears the mode first, with its data, and then
  // again on every change while it stays open.
  const theme = useUniwind().theme === "light" ? "light" : "dark";
  const [background] = useCSSVariable(["--color-background"]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !isReadyMessage(event.data)) return;
      for (const message of [themeMessage(theme), ...messages])
        frame.current.contentWindow?.postMessage(JSON.stringify(message), "*");
      setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the hand-over runs once, per frame load
  }, []);

  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage(JSON.stringify(themeMessage(theme)), "*");
  }, [theme, ready]);

  return (
    <View className="flex-1 bg-background">
      <iframe
        ref={frame}
        title="Mini app"
        src={Asset.fromModule(asset).uri}
        sandbox="allow-scripts"
        style={{
          flex: 1,
          width: "100%",
          border: 0,
          backgroundColor: background as string,
        }}
      />
      {ready ? null : (
        <View className="absolute inset-0 items-center justify-center bg-background">
          <Spinner />
        </View>
      )}
    </View>
  );
}
