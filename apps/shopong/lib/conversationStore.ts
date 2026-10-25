import { useSyncExternalStore } from "react";

import { seedConversations, type Conversation } from "./conversations";

type Listener = () => void;

/**
 * Conversations for as long as the app runs. Nothing persists them yet, like the notifications.
 * A store outside React keeps them when the Create screen is closed and opened again.
 */
export function createConversationStore(initial: readonly Conversation[]) {
  let state: readonly Conversation[] = initial;
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    /** Replaces the conversation with the same id, or adds it. */
    put: (conversation: Conversation) => {
      const exists = state.some((item) => item.id === conversation.id);
      state = exists
        ? state.map((item) => (item.id === conversation.id ? conversation : item))
        : [...state, conversation];
      for (const listener of listeners) listener();
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const conversationStore = createConversationStore(seedConversations(Date.now()));

export const useConversations = (): readonly Conversation[] =>
  useSyncExternalStore(conversationStore.subscribe, conversationStore.get, conversationStore.get);
