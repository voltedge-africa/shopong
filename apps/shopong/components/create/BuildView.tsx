import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Alert, Badge, Button, Task, Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import {
  CI_STAGES,
  canPublish,
  duration,
  type Artifact,
  type CiRun,
  type CiStatus,
} from "../../lib/ci";

type Offer = "publish" | "update" | "open";

type Props = {
  title: string;
  /** The run so far: which steps have passed, failed or are still to come. */
  run: CiRun;
  /** How many times the build has been changed, so this is run number `changes + 1`. */
  changes: number;
  /** The file the run makes. */
  artifact: Artifact;
  offer: Offer;
  onPublish: () => void;
  onOpen: () => void;
};

const TASK_STATUS = {
  pending: "pending",
  skipped: "pending",
  running: "running",
  passed: "complete",
  failed: "error",
} as const satisfies Record<CiStatus, "pending" | "running" | "complete" | "error">;

const STATE = {
  running: { label: "Running", variant: "info" },
  passed: { label: "Passed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
} as const;

const OFFER_LABEL: Record<Offer, string> = {
  publish: "Publish",
  update: "Publish update",
  open: "Open",
};

/**
 * The run that makes the app file: build, test, package, one step at a time. A failure is
 * flagged where it happens and stays on screen even when the next step puts it right. Nothing is
 * deployed. When every step has passed you publish the app it made: that opens a screen to name it
 * and check its details first.
 */
export function BuildView({ title, run, changes, artifact, offer, onPublish, onOpen }: Props) {
  const muted = useCSSVariable("--color-muted-foreground") as string;
  /** Steps the person has opened or closed. Failed and running steps open by themselves. */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const total = run.steps.length;
  const state = STATE[run.state];
  const unfixed = run.failed - run.fixed;
  const failure = run.steps.find((step) => step.status === "failed" && step.problem);

  return (
    <ScrollView contentContainerClassName="gap-5 p-4">
      <View className="gap-2 rounded-2xl border border-border bg-card p-4">
        <View className="flex-row items-center justify-between gap-3">
          <Text weight="semibold" className="flex-1" numberOfLines={1}>
            {title}
          </Text>
          <Badge variant={state.variant}>{state.label}</Badge>
        </View>
        <Text size="sm" muted>
          {`Run ${changes + 1} · ${run.finished} of ${total} steps · ${duration(run.ms)}`}
        </Text>
        {run.fixed > 0 ? (
          <Text size="sm" className="text-warning-foreground">
            {run.fixed === 1
              ? "1 problem was found and fixed."
              : `${run.fixed} problems were found and fixed.`}
          </Text>
        ) : null}
      </View>

      {unfixed > 0 ? (
        <Alert variant="destructive">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>The build stopped</Alert.Title>
            <Alert.Description>
              {failure?.problem ?? "A step failed."} Nothing was made to publish.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {CI_STAGES.map((stage) => {
        const steps = run.steps.filter((step) => step.stage === stage);
        if (steps.length === 0) return null;
        const failedHere = steps.some((step) => step.status === "failed");
        return (
          <View key={stage} className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text weight="semibold">{stage}</Text>
              <Text size="sm" muted>
                {`${steps.filter((step) => step.status === "passed").length} of ${steps.length}`}
              </Text>
              {failedHere ? <Ionicons name="alert-circle" size={16} color="#dc2626" /> : null}
            </View>
            <View className="gap-1.5 rounded-xl border border-border bg-card p-3">
              {steps.map((step) => {
                const open =
                  opened[step.id] ?? (step.status === "failed" || step.status === "running");
                const done = step.status === "passed" || step.status === "failed";
                return (
                  <Task
                    key={step.id}
                    status={TASK_STATUS[step.status]}
                    open={open && (done || step.status === "running")}
                    onOpenChange={(next) =>
                      setOpened((current) => ({ ...current, [step.id]: next }))
                    }
                  >
                    <Task.Trigger title={step.title} />
                    <Task.Content>
                      {step.status === "failed" && step.problem ? (
                        <Text size="sm" className="text-destructive">
                          {step.problem}
                        </Text>
                      ) : null}
                      {step.status === "passed" || step.status === "failed"
                        ? step.log.map((line) => <Task.Item key={line}>{line}</Task.Item>)
                        : null}
                      {done ? <Task.Item>{`Took ${duration(step.ms)}`}</Task.Item> : null}
                    </Task.Content>
                  </Task>
                );
              })}
            </View>
          </View>
        );
      })}

      <View className="gap-3 rounded-2xl border border-border bg-card p-4">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Ionicons name="cube-outline" size={24} color={muted} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text weight="semibold">{`${artifact.name} ${artifact.version}`}</Text>
            <Text size="sm" muted>
              {canPublish(run)
                ? `${artifact.size} · ${artifact.file}`
                : "The app is made here once every step has passed"}
            </Text>
          </View>
        </View>
        {canPublish(run) ? (
          <Button fullWidth onPress={offer === "open" ? onOpen : onPublish}>
            {OFFER_LABEL[offer]}
          </Button>
        ) : (
          <Text size="sm" muted>
            {run.state === "failed"
              ? "There is nothing to publish because the build stopped."
              : "You can publish it when every step has passed."}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
