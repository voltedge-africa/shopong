import { useRouter } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";
import { Alert, Button, Input, Text } from "panelui-native";
import {
  ACTIONS,
  DEFAULT_ROLE_DAYS,
  ROLES,
  ROLE_DAYS,
  ROLE_NAMES,
  formatDay,
  formatRand,
  type RoleName,
  type RoleRecord,
} from "@shopong/community";
import { money } from "@shopong/ports";

import { useCommunity } from "../lib/CommunityProvider";
import { useIdentity } from "../lib/IdentityProvider";
import { shortDid } from "../lib/identitySeed";

const dateOf = (ms: number) => new Date(ms).toDateString();

/** "Your role": what I hold, with its end date, and whether it has ended. */
function RoleLine({ record, now }: { record: RoleRecord; now: number }) {
  const label = ROLES[record.role].label;
  const limit = record.grants.find((grant) => grant.limit !== undefined)?.limit;
  const ended = record.expiresAt <= now;
  return (
    <View className="gap-1">
      <Text weight="bold">{label}</Text>
      {limit !== undefined ? <Text muted>{`Up to ${formatRand(limit)}`}</Text> : null}
      <Text muted>
        {ended
          ? `Ended on ${formatDay(record.expiresAt)}`
          : `Good until ${formatDay(record.expiresAt)}`}
      </Text>
    </View>
  );
}

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

/** "Your community" on the Settings tab: make one, invite a person, give a role, check what I can do. */
export function CommunityCard() {
  const router = useRouter();
  const { status } = useIdentity();
  const {
    community,
    isCreator,
    members,
    invitations,
    roles,
    create,
    invite,
    grant,
    checkAction,
    refusals,
  } = useCommunity();
  const [name, setName] = useState("");
  const [invitee, setInvitee] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [grantee, setGrantee] = useState("");
  const [role, setRole] = useState<RoleName>("driver");
  const [limit, setLimit] = useState("");
  const [days, setDays] = useState<number>(DEFAULT_ROLE_DAYS);
  const [ability, setAbility] = useState(ACTIONS[0]?.ability ?? "payment/approve");
  const [amount, setAmount] = useState("");
  const [answer, setAnswer] = useState<string | undefined>();
  const chosen = ACTIONS.find((action) => action.ability === ability);

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
          {roles.length > 0 ? (
            <View className="gap-2 rounded-xl border border-border p-3">
              <Text weight="bold">Your role</Text>
              {roles.map((record) => (
                <RoleLine
                  key={`${record.role}-${record.expiresAt}`}
                  record={record}
                  now={Date.now()}
                />
              ))}
            </View>
          ) : null}
          {isCreator ? (
            <View className="gap-3 rounded-xl border border-border p-3">
              <Text weight="bold">Give a role</Text>
              <Text muted>Give a member a role for 7, 30 or 90 days.</Text>
              <Input
                label="Their identity"
                value={grantee}
                onChangeText={setGrantee}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View className="flex-row gap-2">
                {ROLE_NAMES.map((name) => (
                  <Button
                    key={name}
                    variant={role === name ? "primary" : "outline"}
                    onPress={() => setRole(name)}
                  >
                    {ROLES[name].label}
                  </Button>
                ))}
              </View>
              {ROLES[role].limited !== undefined ? (
                <Input
                  label="Limit for each payment (rand)"
                  value={limit}
                  onChangeText={setLimit}
                  keyboardType="number-pad"
                />
              ) : null}
              <View className="flex-row gap-2">
                {ROLE_DAYS.map((length) => (
                  <Button
                    key={length}
                    variant={days === length ? "primary" : "outline"}
                    onPress={() => setDays(length)}
                  >
                    {`${length} days`}
                  </Button>
                ))}
              </View>
              <Button
                fullWidth
                disabled={busy}
                onPress={() => {
                  const rands = Number(limit);
                  const minor = Math.round(rands * 100);
                  const options = {
                    days,
                    ...(ROLES[role].limited !== undefined && limit.trim() !== "" && minor > 0
                      ? { limit: money("ZAR", minor) }
                      : {}),
                  };
                  void run(
                    () => grant(grantee, role, options),
                    () => setGrantee(""),
                  );
                }}
              >
                Give this role
              </Button>
            </View>
          ) : null}
          <View className="gap-3 rounded-xl border border-border p-3">
            <Text weight="bold">What can I do?</Text>
            <View className="flex-row flex-wrap gap-2">
              {ACTIONS.map((action) => (
                <Button
                  key={action.ability}
                  variant={ability === action.ability ? "primary" : "outline"}
                  onPress={() => {
                    setAbility(action.ability);
                    setAnswer(undefined);
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </View>
            {chosen?.limited === true ? (
              <Input
                label="How much (rand)"
                value={amount}
                onChangeText={setAmount}
                keyboardType="number-pad"
              />
            ) : null}
            <Button
              fullWidth
              variant="outline"
              onPress={async () => {
                const minor = Math.round(Number(amount) * 100);
                const request =
                  chosen?.limited === true && minor > 0
                    ? { ability, amount: money("ZAR", minor) }
                    : { ability };
                const result = await checkAction(request);
                setAnswer(result.ok ? "Allowed." : result.error.message);
              }}
            >
              Check
            </Button>
            {answer !== undefined ? <Text weight="bold">{answer}</Text> : null}
          </View>
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
      {refusals.length > 0 ? (
        <View className="gap-2 rounded-xl border border-border p-3">
          <Text weight="bold">Recent refusals on this phone</Text>
          {refusals.map((refusal, index) => (
            <View key={`${refusal.at}-${String(index)}`} className="gap-1">
              <Text muted>{`${refusal.action}, ${dateOf(refusal.at)}`}</Text>
              <Text>{refusal.reason}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {error !== undefined ? <ErrorNote message={error} /> : null}
    </View>
  );
}
