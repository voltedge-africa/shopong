import { Renderer } from "@openuidev/react-lang";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Alert } from "panelui-native";

import { loadPinnedScreen, type PinnedScreen } from "../lib/pinnedScreen";
import { previewNotice } from "../lib/preview";
import { SCREEN_LIBRARY } from "./ScreenParts";

type State = { status: "loading" } | { status: "ready" } | { status: "failed" };

/**
 * A pinned screen, drawn by the OpenUI renderer. The text is checked first (`loadPinnedScreen`); one
 * that does not pass is not drawn at all, and the person is told in plain words. The renderer reads the
 * pinned text and nothing else: it calls no model and makes no request. Buttons only preview what
 * they do.
 */
export function GeneratedScreen({ screen }: { screen: PinnedScreen }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    setNotice(undefined);
    void loadPinnedScreen(screen).then((result) => {
      if (current) setState({ status: result.ok ? "ready" : "failed" });
    });
    return () => {
      current = false;
    };
  }, [screen]);

  if (state.status === "loading") return <View className="h-40" />;
  if (state.status === "failed")
    return (
      <Alert variant="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>This screen could not be shown</Alert.Title>
          <Alert.Description>
            Something in it was not allowed, so it was left out.
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );

  return (
    <View className="gap-4">
      {notice ? (
        <Alert variant="info">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{notice}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Renderer
        response={screen.source}
        library={SCREEN_LIBRARY}
        onAction={(event) => setNotice(previewNotice(event))}
      />
    </View>
  );
}
