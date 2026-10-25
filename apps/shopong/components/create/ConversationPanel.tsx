import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Panelside, usePanelside } from "panelui-native";
import { useCSSVariable } from "uniwind";

import { byRecent, filterConversations, type Conversation } from "../../lib/conversations";

/** The views of a build, in the order the panel lists them. `to` is the route the scene shows. */
export const BUILD_VIEWS = [
  { to: "thread", label: "Thread", icon: "chatbubble-outline" },
  { to: "logic", label: "Logic", icon: "git-network-outline" },
  { to: "screens", label: "Screens", icon: "phone-portrait-outline" },
  { to: "build", label: "Build", icon: "checkmark-done-outline" },
] as const;

export type BuildRoute = (typeof BUILD_VIEWS)[number]["to"];

type Props = {
  conversations: readonly Conversation[];
  /** Show the views of the open build above the recents: only once there is a build to look at. */
  showViews: boolean;
  activeId: string | undefined;
  onOpen: (id: string) => void;
  onNew: () => void;
};

/** The projects (conversations), behind the scene: swipe from the side or press the menu to open it. */
export function ConversationPanel({ conversations, showViews, activeId, onOpen, onNew }: Props) {
  const { setOpen } = usePanelside();
  const foreground = useCSSVariable("--color-foreground") as string;
  const [query, setQuery] = useState("");
  const shown = byRecent(filterConversations(conversations, query));

  return (
    <Panelside.Panel>
      <Panelside.Header title="Projects">
        <Panelside.Search value={query} onChangeText={setQuery} placeholder="Search" />
      </Panelside.Header>
      <Panelside.Content>
        {showViews ? (
          <Panelside.Group>
            <Panelside.GroupLabel>This build</Panelside.GroupLabel>
            {BUILD_VIEWS.map((view) => (
              <Panelside.Item
                key={view.to}
                to={view.to}
                label={view.label}
                icon={<Ionicons name={view.icon} size={18} color={foreground} />}
              />
            ))}
          </Panelside.Group>
        ) : null}
        <Panelside.Group>
          <Panelside.GroupLabel>Recents</Panelside.GroupLabel>
          {shown.map((item) => (
            <Panelside.Item
              key={item.id}
              label={item.title}
              active={item.id === activeId}
              onPress={() => {
                onOpen(item.id);
                setOpen(false);
              }}
            />
          ))}
        </Panelside.Group>
      </Panelside.Content>
      <Panelside.Footer>
        <Panelside.Cta
          label="New project"
          onPress={() => {
            onNew();
            setOpen(false);
          }}
        />
      </Panelside.Footer>
    </Panelside.Panel>
  );
}
