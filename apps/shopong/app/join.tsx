import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { Alert, Button, Input, Text } from "panelui-native";

import { useCommunity } from "../lib/CommunityProvider";

/**
 * Check an invitation. It runs on this phone with no network and gives the plain reason when the
 * invitation can't be used. Joining for real between two phones waits for the shared record (epic 3).
 */
export default function Join() {
  const params = useLocalSearchParams<{ space?: string; creator?: string; invitation?: string }>();
  const { check } = useCommunity();
  const fromLink =
    params.space !== undefined && params.creator !== undefined && params.invitation !== undefined
      ? `shopong://join?space=${params.space}&creator=${encodeURIComponent(params.creator)}&invitation=${encodeURIComponent(params.invitation)}`
      : "";
  const [text, setText] = useState(fromLink);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | undefined>();
  const [busy, setBusy] = useState(false);

  const onCheck = async () => {
    if (busy) return;
    setBusy(true);
    const result = await check(text);
    setBusy(false);
    setOutcome(
      result.ok
        ? {
            ok: true,
            message: "This invitation is good. Joining between phones is coming soon.",
          }
        : { ok: false, message: result.error.message },
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-6"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Join a community" }} />
      <Text muted>Paste the invitation you were sent.</Text>
      <Input
        label="Invitation"
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <Button fullWidth disabled={busy} onPress={onCheck}>
        Check the invitation
      </Button>
      {outcome !== undefined ? (
        <Alert variant={outcome.ok ? "info" : "destructive"}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{outcome.message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
    </ScrollView>
  );
}
