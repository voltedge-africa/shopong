// The delivery of one order (story 7.6): whether it arrived, the driver's button to confirm the arrival with a photo, each
// member's own "I have collected", the progress, and a dispute. The words come from proof.ts; the host does the rest.

import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Input, Text } from "panelui-native";

import type { ProofHost, ProofView } from "./host";
import { ARRIVAL_HELP, arrivalWords, collectionWords, disputeWords, progressWords } from "./proof";

export function ProofPanel({ host, order }: { host: ProofHost; order: string }) {
  const [view, setView] = useState<ProofView | undefined>();
  const [note, setNote] = useState("");
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
    const next = await host.progressOf(order);
    if (mounted.current) setView(next);
  }, [host, order]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one action: a plain reason is shown, and the view is read again either way. */
  const act = async (run: () => Promise<string | undefined>) => {
    setBusy(true);
    setProblem(undefined);
    let reason: string | undefined;
    try {
      reason = await run();
    } catch {
      reason = "That didn't work. Try again.";
    }
    if (!mounted.current) return;
    setBusy(false);
    if (reason !== undefined) setProblem(reason);
    await refresh();
  };

  if (view === undefined) return null;
  const arrival = arrivalWords(view, host.me);
  const collect = collectionWords(view, host.me);
  const mine = view.shares.find((share) => share.member === host.me);

  return (
    <View className="gap-2">
      <Text weight="bold">Delivery for this order</Text>
      <Text>{arrival.words}</Text>
      {arrival.state === "driver_to_confirm" ? (
        <View className="gap-2">
          <Text muted>{ARRIVAL_HELP}</Text>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => act(() => host.confirmArrival(order))}
          >
            Confirm arrival with a photo
          </Button>
        </View>
      ) : null}
      {view.arrived ? (
        <View className="gap-2">
          <Text>
            {progressWords(view.shares.filter((s) => s.collected).length, view.shares.length)}
          </Text>
          {collect !== undefined ? <Text muted>{collect}</Text> : null}
          {mine !== undefined && !mine.collected ? (
            <Button
              variant="outline"
              disabled={busy}
              onPress={() => act(() => host.collect(order))}
            >
              I have collected my share
            </Button>
          ) : null}
          {disputeWords(view).map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
          <Input
            label="What did not arrive? (optional)"
            value={note}
            onChangeText={setNote}
            autoCorrect={false}
          />
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => act(() => host.dispute(order, note.trim()))}
          >
            Say a share did not arrive
          </Button>
        </View>
      ) : null}
      {problem === undefined ? null : <Text>{problem}</Text>}
    </View>
  );
}
