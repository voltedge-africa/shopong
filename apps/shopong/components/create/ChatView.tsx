import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  AIInput,
  Message,
  MessageScroller,
  Response,
  Task,
  useMessageScroller,
} from "panelui-native";

import { SEQUENCE_SRC, revealWords, wordCount, type Build } from "../../lib/builder";
import type { Conversation } from "../../lib/conversations";
import type { Stage } from "../../lib/pipeline";
import { RefusalNotice, type Refusal } from "./RefusalNotice";
import { UmlImage } from "./UmlImage";

/** Words revealed per tick, and how often, while a reply streams in. */
const WORDS_PER_TICK = 3;
const TICK_MS = 60;

type Props = {
  conversation: Conversation;
  /** The builder is working on an answer to the last message. */
  thinking: boolean;
  /** The stages shown while it works: classifying, initializing, starting the agent. */
  pipeline: readonly Stage[] | undefined;
  /** The app's refusal of the last request, if it refused one. */
  refusal: Refusal | undefined;
  onDismissRefusal: () => void;
  /** The assistant turn that should stream in; every other turn shows in full. */
  streamingTurnId: string | undefined;
  onStreamDone: () => void;
  /** Returns false when the app refuses the request: the text is kept so it can be edited. */
  onSubmit: (text: string) => boolean;
};

/** The reply, revealed a few words at a time as if it were arriving from a model. */
function StreamedResponse({
  text,
  animate,
  build,
  onDone,
}: {
  text: string;
  animate: boolean;
  /** The build whose sequence diagram the answer's image points at. */
  build: Build | undefined;
  onDone: () => void;
}) {
  const total = wordCount(text);
  const [count, setCount] = useState(animate ? 0 : total);

  useEffect(() => {
    if (!animate) return;
    const id = setInterval(
      () => setCount((current) => Math.min(total, current + WORDS_PER_TICK)),
      TICK_MS,
    );
    return () => clearInterval(id);
  }, [animate, total]);

  const done = count >= total;
  useEffect(() => {
    if (animate && done) onDone();
    // `onDone` changes with the parent's render; the stream finishing is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, done]);

  // The only image an answer has is the UML diagram of its capability calls; the app draws it.
  const components = useMemo(
    () => ({
      image: ({ src, alt }: { src: string; alt: string }) =>
        build && src === SEQUENCE_SRC ? <UmlImage diagram={build.sequence} label={alt} /> : null,
    }),
    [build],
  );

  return (
    <Response isStreaming={animate && !done} components={components}>
      {revealWords(text, count)}
    </Response>
  );
}

/** Scrolls to the newest content when `signal` changes: a new turn, or the pipeline starting. */
function ScrollToEndOn({ signal }: { signal: string }) {
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => {
    // After the new content has laid out.
    const id = setTimeout(() => scrollToEnd(true), 80);
    return () => clearTimeout(id);
  }, [signal, scrollToEnd]);
  return null;
}

/** The conversation, with the composer pinned to the bottom. */
export function ChatView({
  conversation,
  thinking,
  pipeline,
  refusal,
  onDismissRefusal,
  streamingTurnId,
  onStreamDone,
  onSubmit,
}: Props) {
  const [value, setValue] = useState("");

  return (
    <View className="flex-1">
      <MessageScroller autoScroll className="flex-1">
        <ScrollToEndOn signal={`${conversation.turns.length}:${pipeline ? "pipeline" : ""}`} />
        <MessageScroller.Viewport>
          <MessageScroller.Content className="gap-4 px-4 py-4">
            {conversation.turns.map((turn) => (
              <MessageScroller.Item
                key={turn.id}
                messageId={turn.id}
                scrollAnchor={turn.role === "user"}
              >
                {turn.role === "user" ? (
                  <Message align="end">
                    <Message.Content>
                      <Message.Bubble>
                        <Message.BubbleContent>{turn.text}</Message.BubbleContent>
                      </Message.Bubble>
                    </Message.Content>
                  </Message>
                ) : (
                  <StreamedResponse
                    text={turn.text}
                    animate={turn.id === streamingTurnId}
                    build={conversation.build}
                    onDone={onStreamDone}
                  />
                )}
              </MessageScroller.Item>
            ))}
            {pipeline ? (
              <MessageScroller.Item messageId="pipeline">
                <View
                  accessibilityLabel="Starting the agent"
                  className="gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  {pipeline.map((stage) => (
                    <Task key={stage.id} status={stage.status}>
                      <Task.Trigger title={stage.title} />
                      <Task.Content>
                        {stage.items.map((item) => (
                          <Task.Item key={item}>{item}</Task.Item>
                        ))}
                      </Task.Content>
                    </Task>
                  ))}
                </View>
              </MessageScroller.Item>
            ) : null}
          </MessageScroller.Content>
        </MessageScroller.Viewport>
        <MessageScroller.Button />
      </MessageScroller>
      <View className="gap-3 px-4 pb-4">
        {refusal ? <RefusalNotice refusal={refusal} /> : null}
        <AIInput
          value={value}
          onValueChange={(next) => {
            if (refusal) onDismissRefusal();
            setValue(next);
          }}
          status={thinking ? "submitted" : "ready"}
          onSubmit={(text) => {
            if (text.trim() === "" || thinking) return;
            if (onSubmit(text)) setValue("");
          }}
        >
          <AIInput.Field placeholder="Ask for a change" />
          <AIInput.Toolbar>
            <AIInput.Spacer />
            <AIInput.Submit />
          </AIInput.Toolbar>
        </AIInput>
      </View>
    </View>
  );
}
