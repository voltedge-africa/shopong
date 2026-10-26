// Collecting and closing one order (story 8.7): the summary every member can read (their own line in full, the group's
// figures, who has collected, the timeline and the open items), and the treasurer's close, which asks for a confirmation
// on screen before anything is sent (AGENTS rule 8). The summary is read from the record and the pool; nothing is added up
// here, and no money moves.

import type { ClosingSummary } from "@shopong/community";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Text } from "panelui-native";

import type { ProofHost } from "./host";
import { CLOSED_WORDS, CONFIRM_CLOSE, collectedWords, timelineWords } from "./closing";

export function ClosePanel({
  host,
  order,
  treasurer,
}: {
  host: ProofHost;
  order: string;
  treasurer: boolean;
}) {
  const [summary, setSummary] = useState<ClosingSummary | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await host.closingOf(order);
    if (mounted.current) setSummary(next);
  }, [host, order]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (summary === undefined || !summary.delivered) return null;

  const close = async () => {
    setBusy(true);
    setProblem(undefined);
    let reason: string | undefined;
    try {
      reason = await host.close(order);
    } catch {
      reason = "That didn't work. Try again.";
    }
    if (!mounted.current) return;
    setBusy(false);
    setConfirming(false);
    if (reason !== undefined) setProblem(reason);
    await refresh();
  };

  return (
    <View className="gap-2">
      <Text weight="bold">Collect and close</Text>
      {summary.closed ? <Text>{CLOSED_WORDS}</Text> : null}
      {summary.group.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
      {summary.you !== undefined ? (
        <View className="gap-1">
          <Text weight="bold">Your share</Text>
          <Text>{summary.you.paidText}</Text>
          <Text>{summary.you.shareText}</Text>
          <Text>{summary.you.difference.words}</Text>
        </View>
      ) : null}
      {summary.notes.map((line) => (
        <Text key={line} muted>
          {line}
        </Text>
      ))}
      <Text weight="bold">Members</Text>
      {summary.members.map((member, index) => (
        <Text key={index}>{`${member.label}: ${collectedWords(member.collected)}`}</Text>
      ))}
      {summary.openItems.length > 0 ? (
        <View className="gap-1">
          <Text weight="bold">Still open</Text>
          {summary.openItems.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </View>
      ) : null}
      <Text weight="bold">What happened</Text>
      {summary.timeline.map((line, index) => (
        <Text key={index} muted>
          {timelineWords(line)}
        </Text>
      ))}
      {treasurer && !summary.closed ? (
        <View className="gap-2">
          {summary.blocker !== undefined ? <Text>{summary.blocker}</Text> : null}
          {confirming ? (
            <View className="gap-2">
              <Text>{CONFIRM_CLOSE}</Text>
              <Button disabled={busy} onPress={() => void close()}>
                Yes, close the order
              </Button>
              <Button variant="outline" disabled={busy} onPress={() => setConfirming(false)}>
                Not yet
              </Button>
            </View>
          ) : (
            <Button
              variant="outline"
              disabled={busy || summary.blocker !== undefined}
              onPress={() => setConfirming(true)}
            >
              Close this order
            </Button>
          )}
        </View>
      ) : null}
      <Button variant="outline" disabled={busy} onPress={() => void refresh()}>
        Refresh the summary
      </Button>
      {problem === undefined ? null : <Text>{problem}</Text>}
    </View>
  );
}
