import { Asset } from "expo-asset";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useCSSVariable, useUniwind } from "uniwind";
import { Spinner, Text } from "panelui-native";

import { isReadyMessage, themeMessage } from "../lib/bundleMessages";

type Props = {
  /** The Metro asset id of the built page. */
  asset: number;
  /** Posted to the page, in order, once it reports that it is ready. */
  messages: readonly unknown[];
};

/**
 * A mini app that ships as one built web page. It is opened from disk, may not navigate anywhere,
 * and has no way to reach the app: it only receives the messages it is given.
 */
export function BundleMiniApp({ asset, messages }: Props) {
  const webView = useRef<ComponentRef<typeof WebView>>(null);
  const [uri, setUri] = useState<string>();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // The page dresses in the app's own theme: it hears the mode first, with its data, and then
  // again on every change while it stays open.
  const theme = useUniwind().theme === "light" ? "light" : "dark";
  const [background] = useCSSVariable(["--color-background"]);

  const onMessage = (event: WebViewMessageEvent) => {
    if (!isReadyMessage(event.nativeEvent.data)) return;
    for (const message of [themeMessage(theme), ...messages])
      webView.current?.postMessage(JSON.stringify(message));
    setReady(true);
  };

  useEffect(() => {
    if (!ready) return;
    webView.current?.postMessage(JSON.stringify(themeMessage(theme)));
  }, [theme, ready]);

  useEffect(() => {
    let current = true;
    Asset.fromModule(asset)
      .downloadAsync()
      .then(({ localUri }) => {
        if (!current) return;
        if (localUri === null) setFailed(true);
        else setUri(localUri);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [asset]);

  if (failed) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text muted>This mini app could not be opened.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {uri === undefined ? null : (
        <WebView
          ref={webView}
          source={{ uri }}
          style={{ flex: 1, backgroundColor: background as string }}
          originWhitelist={["file://*"]}
          onShouldStartLoadWithRequest={(request) => request.url === uri}
          onMessage={onMessage}
          onError={() => setFailed(true)}
          javaScriptEnabled
          domStorageEnabled={false}
          allowFileAccess
          allowingReadAccessToURL={uri}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          allowsLinkPreview={false}
          bounces={false}
          overScrollMode="never"
        />
      )}
      {ready ? null : (
        <View className="absolute inset-0 items-center justify-center bg-background">
          <Spinner />
        </View>
      )}
    </View>
  );
}
