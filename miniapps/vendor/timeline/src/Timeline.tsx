// The payment timeline: this member's payments on the record, and for the one chosen, every step in plain sentences,
// with the event id a person can match, and whether the record and the pool books agree. The Node writes the words and
// decides who may read a timeline; this screen only shows them. A difference is shown, never hidden.
import { useCallback, useContext, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Button, Text } from "panelui-native";
import type { Timeline } from "@shopong/community";

import {
  TimelineHostContext,
  type TimelineAnswer,
  type TimelineHost,
  type TimelinePayment,
} from "./host";
import { agreementTone, paymentLabel, stepLines } from "./lines";

export default function Timeline() {
  const host = useContext(TimelineHostContext);
  if (host === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text muted>Make a community first, in Settings.</Text>
      </View>
    );
  }
  return <TimelineView host={host} />;
}

function TimelineView({ host }: { host: TimelineHost }) {
  const [payments, setPayments] = useState<readonly TimelinePayment[] | undefined>(undefined);
  const [listFailed, setListFailed] = useState(false);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<TimelineAnswer | undefined>(undefined);

  const loadList = useCallback(async () => {
    try {
      setPayments(await host.payments());
      setListFailed(false);
    } catch {
      setListFailed(true);
    }
  }, [host]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openPayment = useCallback(
    async (pledgeId: string) => {
      setOpen(pledgeId);
      setAnswer(undefined);
      try {
        setAnswer(await host.timelineOf(pledgeId));
      } catch {
        setAnswer({ ok: false, message: "The timeline could not be read. Try again." });
      }
    },
    [host],
  );

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4">
      <Text weight="bold">Payment timeline</Text>
      <Text muted>
        Every step of one of your payments, from the pledge to the pool books. Only you can see your
        own payments here.
      </Text>

      {listFailed ? (
        <View className="gap-2">
          <Text>Could not load your payments. Try again.</Text>
          <Button variant="outline" onPress={loadList}>
            Try again
          </Button>
        </View>
      ) : payments === undefined ? (
        <Text muted>Loading your payments...</Text>
      ) : payments.length === 0 ? (
        <Text muted>You have no payments yet. Pledge to an order first.</Text>
      ) : (
        payments.map((payment) => (
          <Button
            key={payment.pledgeId}
            variant="outline"
            disabled={open === payment.pledgeId}
            onPress={() => void openPayment(payment.pledgeId)}
          >
            {open === payment.pledgeId ? `Showing ${paymentLabel(payment)}` : paymentLabel(payment)}
          </Button>
        ))
      )}

      {open === undefined ? null : answer === undefined ? (
        <Text muted>Reading the timeline from the OCN Node...</Text>
      ) : answer.ok ? (
        <TimelineSteps timeline={answer.timeline} note={answer.note} />
      ) : (
        <Text>{answer.message}</Text>
      )}
    </ScrollView>
  );
}

function TimelineSteps({ timeline, note }: { timeline: Timeline; note?: string }) {
  const tone = agreementTone(timeline.agreement.state);
  return (
    <View className="gap-3">
      {note === undefined ? null : <Text muted>{note}</Text>}
      {stepLines(timeline).map((line) => (
        <View key={line.key} className="gap-1">
          <Text weight="bold">{line.label}</Text>
          <Text>{line.words}</Text>
          {line.ref === undefined ? null : <Text muted>{`Event ${line.ref}`}</Text>}
        </View>
      ))}
      <View className="gap-1">
        <Text weight="bold">
          {tone === "ok"
            ? "Record and books agree"
            : tone === "warn"
              ? "Record and books differ"
              : "Not compared yet"}
        </Text>
        <Text>{timeline.agreement.words}</Text>
      </View>
    </View>
  );
}
