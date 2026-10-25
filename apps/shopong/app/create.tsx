import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Panelside, Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import { BuildView } from "../components/create/BuildView";
import { ChatView } from "../components/create/ChatView";
import { ComposeView } from "../components/create/ComposeView";
import {
  BUILD_VIEWS,
  ConversationPanel,
  type BuildRoute,
} from "../components/create/ConversationPanel";
import { LogicView } from "../components/create/LogicView";
import { ScreensView } from "../components/create/ScreensView";
import type { Refusal } from "../components/create/RefusalNotice";
import { designBuild } from "../lib/builder";
import { artifactOf, ciPlan, ciRun } from "../lib/ci";
import { classifyRequest } from "../lib/classify";
import { addUserTurn, answer, awaitingAnswer, startConversation } from "../lib/conversations";
import { conversationStore, useConversations } from "../lib/conversationStore";
import { publishIdFor, publishOffer, usePublishedApps } from "../lib/publishedApps";
import { STAGE_MS, pipelineDone, pipelineStages } from "../lib/pipeline";

/** The pause between the last stage finishing and the agent answering. */
const ANSWER_PAUSE_MS = 500;
/** How long each step of the build run shows once the answer is in. */
const CI_STEP_MS = 650;

export default function Create() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foreground = useCSSVariable("--color-foreground") as string;
  const conversations = useConversations();
  const [now] = useState(() => Date.now());
  const [activeId, setActiveId] = useState<string | undefined>();
  /** The agent is starting up for the last message of the open project. */
  const [thinking, setThinking] = useState(false);
  /** Pipeline stages finished so far: classifying, initializing, starting the agent. */
  const [stage, setStage] = useState(0);
  /** The app's refusal of the last request, shown instead of starting anything. */
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const [streamingTurnId, setStreamingTurnId] = useState<string | undefined>();
  const [tab, setTab] = useState<BuildRoute>("thread");
  /** Build steps finished so far, for projects answered in this session. Others have finished. */
  const [progress, setProgress] = useState<Record<string, number>>({});
  const published = usePublishedApps();

  const active = conversations.find((item) => item.id === activeId);
  const build = active?.build;
  const ready = build !== undefined && !thinking && streamingTurnId === undefined;
  // The first answer shows the views once it has finished; after that they stay for follow-ups.
  const showTabs = build !== undefined && (ready || (active?.turns.length ?? 0) > 2);
  // The run that builds, tests and packages the build, from the first step to the app file.
  const plan = useMemo(() => (build ? ciPlan(build) : []), [build]);
  const done = active && build ? (progress[active.id] ?? plan.length) : 0;
  const run = useMemo(() => ciRun(plan, done), [plan, done]);
  const artifact = useMemo(() => (build ? artifactOf(build) : undefined), [build]);

  /** The agent answers the last message of `id`: the build is designed and the reply streams in. */
  const finish = useCallback((id: string) => {
    const latest = conversationStore.get().find((item) => item.id === id);
    if (!latest || !awaitingAnswer(latest)) return;
    const answered = answer(latest, Date.now());
    conversationStore.put(answered);
    // A new answer is a new run: the build is made and tested from the start.
    setProgress((current) => ({ ...current, [id]: 0 }));
    setStreamingTurnId(answered.turns.at(-1)!.id);
    setThinking(false);
  }, []);

  // Run the pipeline: one stage per STAGE_MS, then the agent answers.
  useEffect(() => {
    if (!thinking || !activeId) return;
    const id = setTimeout(
      () => (pipelineDone(stage) ? finish(activeId) : setStage(stage + 1)),
      pipelineDone(stage) ? ANSWER_PAUSE_MS : STAGE_MS,
    );
    return () => clearTimeout(id);
  }, [thinking, stage, activeId, finish]);

  // Run the build one step after another once the answer has finished streaming. It stops when the
  // run is over: every step has finished, or a failure nothing put right stopped it.
  useEffect(() => {
    if (!ready || !active || run.state !== "running") return;
    const id = setTimeout(
      () => setProgress((current) => ({ ...current, [active.id]: done + 1 })),
      CI_STEP_MS,
    );
    return () => clearTimeout(id);
  }, [ready, active, run.state, done]);

  /** Starts the pipeline for the last message of the open project. */
  const think = () => {
    setStage(0);
    setThinking(true);
  };

  /** Returns false when the app refuses the request: nothing is created and no agent starts. */
  const submit = (text: string): boolean => {
    const verdict = classifyRequest(text, { followUp: active?.build !== undefined });
    if (!verdict.ok) {
      setRefusal(verdict);
      return false;
    }
    setRefusal(undefined);
    const at = Date.now();
    const next = active ? addUserTurn(active, text, at) : startConversation(`c${at}`, text, at);
    conversationStore.put(next);
    setActiveId(next.id);
    setTab("thread");
    think();
    return true;
  };

  const open = (id: string | undefined) => {
    setThinking(false);
    setStreamingTurnId(undefined);
    setRefusal(undefined);
    setTab("thread");
    setActiveId(id);
    const target = conversationStore.get().find((item) => item.id === id);
    if (target && awaitingAnswer(target)) think();
  };

  // What the pipeline shows: the build the request will become, or the open project's own.
  const lastRequest = active?.turns.filter((turn) => turn.role === "user").at(-1)?.text;
  const pipeline =
    thinking && active
      ? pipelineStages(active.build ?? designBuild(lastRequest ?? ""), stage)
      : undefined;

  return (
    <Panelside route={tab} onRouteChange={(next) => setTab(next as BuildRoute)}>
      <Stack.Screen options={{ headerShown: false }} />
      <ConversationPanel
        conversations={conversations}
        showViews={showTabs}
        activeId={activeId}
        onOpen={open}
        onNew={() => open(undefined)}
      />
      <Panelside.Scene>
        <View
          className="flex-1 bg-background"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View className="flex-row items-center justify-between gap-2 px-3 py-2">
            <Panelside.Trigger label="Projects" />
            <View className="flex-1 items-center">
              <Text weight="semibold" numberOfLines={1}>
                {active?.title ?? "Create"}
              </Text>
              {showTabs ? (
                <Text size="xs" muted>
                  {BUILD_VIEWS.find((view) => view.to === tab)?.label}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => router.back()}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center"
            >
              <Ionicons name="close" size={24} color={foreground} />
            </Pressable>
          </View>

          {!active ? (
            <ComposeView
              conversations={conversations}
              now={now}
              onSubmit={submit}
              refusal={refusal}
              onDismissRefusal={() => setRefusal(undefined)}
              onOpen={open}
            />
          ) : (
            <View className="flex-1">
              {tab === "thread" || !showTabs || !build ? (
                <ChatView
                  key={active.id}
                  conversation={active}
                  thinking={thinking}
                  pipeline={pipeline}
                  refusal={refusal}
                  onDismissRefusal={() => setRefusal(undefined)}
                  streamingTurnId={streamingTurnId}
                  onStreamDone={() => setStreamingTurnId(undefined)}
                  onSubmit={submit}
                />
              ) : null}
              {showTabs && build && tab === "logic" ? <LogicView build={build} /> : null}
              {showTabs && build && tab === "screens" ? (
                <ScreensView screens={build.screens} />
              ) : null}
              {showTabs && build && tab === "build" ? (
                <BuildView
                  title={build.title}
                  run={run}
                  changes={build.changes.length}
                  artifact={artifact!}
                  offer={publishOffer(published, publishIdFor(active.id), artifact!.version)}
                  onPublish={() => router.push({ pathname: "/publish", params: { id: active.id } })}
                  onOpen={() =>
                    router.push({
                      pathname: "/miniapp/[id]",
                      params: { id: publishIdFor(active.id) },
                    })
                  }
                />
              ) : null}
            </View>
          )}
        </View>
      </Panelside.Scene>
    </Panelside>
  );
}
