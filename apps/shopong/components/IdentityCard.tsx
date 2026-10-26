import { useState } from "react";
import { Share, View } from "react-native";
import { Alert, Button, Text } from "panelui-native";

import { useIdentity } from "../lib/IdentityProvider";
import { shortDid } from "../lib/identitySeed";

/** "Your identity" on the Settings tab: make it, or see the short form of the one on this device. */
export function IdentityCard() {
  const { status, did, create } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [recoverNote, setRecoverNote] = useState(false);

  const onCreate = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const outcome = await create();
    setBusy(false);
    if (outcome === "error") setError("Couldn't save your identity on this device.");
  };

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <Text accessibilityRole="header" size="xl" weight="bold">
        Your identity
      </Text>
      {status === "loading" ? <Text muted>Checking this device...</Text> : null}
      {status === "ready" && did !== null ? (
        <>
          <Text muted>Your identity is on this device.</Text>
          <Text selectable weight="bold">
            {shortDid(did)}
          </Text>
          <Button
            fullWidth
            variant="outline"
            onPress={() => Share.share({ message: did }).catch(() => undefined)}
          >
            Share my identity
          </Button>
          <Text muted>
            Send your identity to the person who runs a community. They use it to invite you.
          </Text>
          <Text selectable size="sm">
            {did}
          </Text>
        </>
      ) : null}
      {status === "unreadable" || status === "unavailable" ? (
        <Text>Couldn't read your identity.</Text>
      ) : null}
      {status === "none" ? (
        <>
          <Text muted>
            Make an identity that lives only on this phone. Nobody else holds its key.
          </Text>
          <Button fullWidth disabled={busy} onPress={onCreate}>
            Create my identity
          </Button>
          <Button fullWidth variant="outline" onPress={() => setRecoverNote(true)}>
            Recover my identity
          </Button>
          {recoverNote ? (
            <Alert variant="info">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>Recovery is coming soon.</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </>
      ) : null}
      {error !== undefined ? (
        <Alert variant="destructive">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
    </View>
  );
}
