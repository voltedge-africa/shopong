import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { Alert, Button, Input, Text } from "panelui-native";

import { useCommunity } from "../lib/CommunityProvider";
import { shortDid } from "../lib/identitySeed";

/**
 * Check an invitation. It runs on this phone with no network and gives the plain reason when the
 * invitation can't be used. With an OCN Node set, "Join this community" admits this person on the Node and
 * queues the join on this phone (story 3.4).
 */
export default function Join() {
  const params = useLocalSearchParams<{ space?: string; creator?: string; invitation?: string }>();
  const { check, joinOnNode, nodeConnected } = useCommunity();
  const fromLink =
    params.space !== undefined && params.creator !== undefined && params.invitation !== undefined
      ? `shopong://join?space=${params.space}&creator=${encodeURIComponent(params.creator)}&invitation=${encodeURIComponent(params.invitation)}`
      : "";
  const [text, setText] = useState(fromLink);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  // A new link opened while this screen is already showing replaces the old text and result.
  useEffect(() => {
    if (fromLink === "") return;
    setText(fromLink);
    setOutcome(undefined);
  }, [fromLink]);

  const onJoin = async () => {
    if (busy) return;
    setBusy(true);
    const problem = await joinOnNode(text);
    setBusy(false);
    if (problem === undefined) {
      setJoined(true);
      setOutcome({
        ok: true,
        message: "You have joined. Your join is on your phone until the Node has it.",
      });
    } else {
      setOutcome({ ok: false, message: problem });
    }
  };

  const onCheck = async () => {
    if (busy) return;
    setBusy(true);
    const result = await check(text);
    setBusy(false);
    setOutcome(
      result.ok
        ? {
            ok: true,
            message: nodeConnected
              ? `This invitation is good. It comes from ${shortDid(result.value.creator)}.`
              : `This invitation is good. It comes from ${shortDid(result.value.creator)}. Joining between phones is coming soon.`,
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
      {nodeConnected && outcome?.ok === true && !joined ? (
        <Button fullWidth disabled={busy} onPress={onJoin}>
          Join this community
        </Button>
      ) : null}
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
