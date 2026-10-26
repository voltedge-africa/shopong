import { useRouter } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";
import { Alert, Button, Input, Text } from "panelui-native";

import { useCommunity } from "../lib/CommunityProvider";
import { useIdentity } from "../lib/IdentityProvider";
import { shortDid } from "../lib/identitySeed";

const dateOf = (ms: number) => new Date(ms).toDateString();

function ErrorNote({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** "Your community" on the Settings tab: make one, invite a person by their identity, see who joined. */
export function CommunityCard() {
  const router = useRouter();
  const { status } = useIdentity();
  const { community, members, invitations, create, invite } = useCommunity();
  const [name, setName] = useState("");
  const [invitee, setInvitee] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<string | undefined>, done?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const problem = await action();
      if (problem === undefined) done?.();
      else setError(problem);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <Text accessibilityRole="header" size="xl" weight="bold">
        Your community
      </Text>
      {status !== "ready" ? <Text muted>Make your identity first.</Text> : null}
      {status === "ready" && community === null ? (
        <>
          <Text muted>Start a community, or join one you were invited to.</Text>
          <Input label="Community name" value={name} onChangeText={setName} />
          <Button fullWidth disabled={busy} onPress={() => run(() => create(name))}>
            Create a community
          </Button>
          <Button fullWidth variant="outline" onPress={() => router.push("/join")}>
            Join a community
          </Button>
        </>
      ) : null}
      {status === "ready" && community !== null ? (
        <>
          <Text weight="bold">{community.name}</Text>
          <Text muted>Members</Text>
          {members.map((member) => (
            <Text key={member.did} selectable>
              {shortDid(member.did)}
            </Text>
          ))}
          <Text muted>
            To invite someone, ask them to send you their full identity from their Settings, then
            paste it here.
          </Text>
          <Input
            label="Their identity"
            value={invitee}
            onChangeText={setInvitee}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            fullWidth
            disabled={busy}
            onPress={() =>
              run(
                () => invite(invitee),
                () => setInvitee(""),
              )
            }
          >
            Invite
          </Button>
          {invitations.map((invitation) => (
            <View key={invitation.id} className="gap-2 rounded-xl border border-border p-3">
              <Text weight="bold">{`For ${shortDid(invitation.invitee)}`}</Text>
              <Text muted>{`Good until ${dateOf(invitation.expiresAt)}`}</Text>
              <Text selectable size="sm">
                {invitation.code}
              </Text>
              <Button
                fullWidth
                variant="outline"
                onPress={() => Share.share({ message: invitation.code }).catch(() => undefined)}
              >
                Share the invitation
              </Button>
            </View>
          ))}
        </>
      ) : null}
      {error !== undefined ? <ErrorNote message={error} /> : null}
    </View>
  );
}
