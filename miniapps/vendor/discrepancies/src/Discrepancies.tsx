import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Card, Text } from "panelui-native";

import {
  reasonProblem,
  SIMULATED_NOTE,
  viewOf,
  type DiscrepancyResponse,
  type DiscrepancyRow,
} from "./data";

export interface DiscrepanciesProps {
  /**
   * The Node's answer for this community (`GET /communities/:key/discrepancies`), read by the host. Undefined until the
   * host connects the list, and then the screen says so instead of showing an empty, reassuring list.
   */
  readonly response?: DiscrepancyResponse;
  /** Records the reason with the Node. The host signs the request; this screen only asks. */
  readonly onResolve?: (id: string, reason: string) => Promise<void>;
}

function Row({
  row,
  onResolve,
}: {
  readonly row: DiscrepancyRow;
  readonly onResolve?: (id: string, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const problem = reasonProblem(reason);
  const canResolve = onResolve !== undefined && problem === undefined && !sending;

  return (
    <Card className="gap-3 p-4">
      <Text weight="semibold">{row.title}</Text>
      <Text muted>{row.text}</Text>
      <View className="gap-1">
        {row.sides.map((side) => (
          <Text key={side.label}>{`${side.label}: ${side.value}`}</Text>
        ))}
      </View>
      <Text muted accessibilityLabel={`Event id ${row.eventId}`}>
        {`Event id ${row.shortEventId} · ${row.openedText}`}
      </Text>
      {row.resolutionText === undefined ? (
        <View className="gap-2">
          <TextInput
            accessibilityLabel="Reason for resolving"
            placeholder="Why is this resolved?"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={500}
            className="rounded-lg border p-3"
          />
          {problem !== undefined && reason !== "" ? <Text muted>{problem}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canResolve }}
            disabled={!canResolve}
            onPress={async () => {
              if (onResolve === undefined) return;
              setSending(true);
              try {
                await onResolve(row.id, reason.trim());
              } finally {
                setSending(false);
              }
            }}
            className="items-center rounded-lg p-3"
          >
            <Text weight="semibold">Resolve with this reason</Text>
          </Pressable>
        </View>
      ) : (
        <Text muted>{row.resolutionText}</Text>
      )}
    </Card>
  );
}

const NOT_CONNECTED = "The list is not connected to the app yet, so no differences are shown here.";

export default function Discrepancies({ response, onResolve }: DiscrepanciesProps) {
  const view = response === undefined ? undefined : viewOf(response);
  return (
    <ScrollView contentContainerClassName="gap-6 p-6">
      <View className="gap-1">
        <Text accessibilityRole="header" size="3xl" weight="bold">
          Discrepancies
        </Text>
        <Text muted>{SIMULATED_NOTE}</Text>
        <Text>{view === undefined ? NOT_CONNECTED : view.summary}</Text>
      </View>
      <View className="gap-4">
        {view?.open.map((row) => (
          <Row key={row.id} row={row} onResolve={onResolve} />
        ))}
      </View>
      {view !== undefined && view.resolved.length > 0 ? (
        <View className="gap-4">
          <Text weight="semibold">Resolved</Text>
          {view.resolved.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
