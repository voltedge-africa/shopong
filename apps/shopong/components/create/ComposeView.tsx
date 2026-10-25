import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AIInput, Text } from "panelui-native";

import { byRecent, type Conversation } from "../../lib/conversations";
import { RefusalNotice, type Refusal } from "./RefusalNotice";
import { timeAgo } from "../../lib/notifications";
import { IDEA_MS, PROMPT_IDEAS, nextIdea } from "../../lib/promptIdeas";

type Props = {
  conversations: readonly Conversation[];
  now: number;
  /** Returns false when the app refuses the request: the text is kept so it can be edited. */
  onSubmit: (prompt: string) => boolean;
  refusal: Refusal | undefined;
  onDismissRefusal: () => void;
  onOpen: (id: string) => void;
};

/** The empty state: what do you want to create, and what you were doing before. */
export function ComposeView({
  conversations,
  now,
  onSubmit,
  refusal,
  onDismissRefusal,
  onOpen,
}: Props) {
  const [value, setValue] = useState("");
  const [idea, setIdea] = useState(0);

  // Show a different request now and then, until the person starts typing their own.
  useEffect(() => {
    if (value !== "") return;
    const id = setInterval(() => setIdea(nextIdea), IDEA_MS);
    return () => clearInterval(id);
  }, [value]);
  const recent = byRecent(conversations).slice(0, 5);

  return (
    <ScrollView
      contentContainerClassName="gap-8 px-6 pb-10 pt-12"
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" size="3xl" weight="bold" className="text-center">
        What do you want to create?
      </Text>
      <AIInput
        value={value}
        onValueChange={(next) => {
          if (refusal) onDismissRefusal();
          setValue(next);
        }}
        onSubmit={(prompt) => {
          if (prompt.trim() === "") return;
          if (onSubmit(prompt)) setValue("");
        }}
        avoidKeyboard={false}
      >
        <AIInput.Field placeholder={PROMPT_IDEAS[idea]} />
        <AIInput.Toolbar>
          <AIInput.Spacer />
          <AIInput.Submit />
        </AIInput.Toolbar>
      </AIInput>
      {refusal ? <RefusalNotice refusal={refusal} /> : null}
      {recent.length > 0 ? (
        <View className="gap-2">
          <Text size="sm" weight="medium" muted>
            Recent projects
          </Text>
          {recent.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${timeAgo(item.updatedAt, now)}`}
              onPress={() => onOpen(item.id)}
              className="flex-row items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3"
            >
              <Text className="flex-1" numberOfLines={1}>
                {item.title}
              </Text>
              <Text size="sm" muted>
                {timeAgo(item.updatedAt, now)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
