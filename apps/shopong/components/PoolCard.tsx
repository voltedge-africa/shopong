// The pool card on the community screen (story 4.6). It shows what the OCN Node sent, in the Node's words: the pool's
// total, the target, the caller's own amount, each member's status, and any flag where the books and the shared record
// differ. Nothing here is computed. If the Node cannot be reached, no total is shown as current.
import { Alert, Button, Text } from "panelui-native";
import { View } from "react-native";
import { useEffect, useState } from "react";

import { useCommunity } from "../lib/CommunityProvider";
import { freshnessOf, poolSections } from "../lib/pool";

/** The clock the card reads, redrawn every 5 seconds so a figure goes "may be out of date" without a new answer. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** How far the pool has got towards the order's price: the Node's percent, drawn as a bar (story 8.4). */
function FundingBar({ funding }: { funding: { percent: number; text: string } }) {
  return (
    <View className="gap-1">
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: funding.percent }}
        className="h-3 w-full overflow-hidden rounded-full bg-muted"
      >
        <View className="h-full rounded-full bg-primary" style={{ width: `${funding.percent}%` }} />
      </View>
      <Text muted>{funding.text}</Text>
    </View>
  );
}

export function PoolCard() {
  const { pool, refreshPool } = useCommunity();
  const now = useClock();
  if (pool === null) return null;
  const sections = poolSections(pool);
  const fresh = pool.state === "shown" ? freshnessOf(pool.checkedAt, now) : undefined;
  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <Text weight="bold">The pool</Text>
      {pool.state === "shown" ? (
        <>
          {fresh !== undefined ? <Text muted>{fresh.checkedText}</Text> : null}
          {fresh?.stale ? <Text muted>These figures may be out of date.</Text> : null}
          {sections.notice.map((line) => (
            <Alert key={line} variant="info">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{line}</Alert.Description>
              </Alert.Content>
            </Alert>
          ))}
          {sections.supplierPaid.length > 0 ? (
            <Alert variant="info">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Supplier paid</Alert.Title>
                {sections.supplierPaid.map((line) => (
                  <Alert.Description key={line}>{line}</Alert.Description>
                ))}
              </Alert.Content>
            </Alert>
          ) : null}
          {sections.figures.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
          {sections.funding !== null ? <FundingBar funding={sections.funding} /> : null}
          {sections.people.map((line) => (
            <Text key={line} muted>
              {line}
            </Text>
          ))}
          {sections.flags.map((line) => (
            <Alert key={line} variant="destructive">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{line}</Alert.Description>
              </Alert.Content>
            </Alert>
          ))}
        </>
      ) : null}
      {pool.state === "loading" ? <Text muted>{sections.figures[0]}</Text> : null}
      {pool.state === "unreachable" || pool.state === "unavailable" || pool.state === "refused" ? (
        <Alert variant={pool.state === "refused" ? "info" : "destructive"}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{pool.message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {pool.state !== "loading" ? (
        <Button variant="outline" onPress={() => void refreshPool()}>
          {pool.state === "unreachable" ? "Try again" : "Refresh the pool"}
        </Button>
      ) : null}
    </View>
  );
}
