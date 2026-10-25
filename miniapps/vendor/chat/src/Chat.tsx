import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AIInput, Message, MessageScroller, Text } from "panelui-native";

import { useKeyboardHeight } from "./useKeyboardHeight";
import { seedMessages, sendMessage } from "./messages";

export default function Chat() {
  const [messages, setMessages] = useState(seedMessages);
  const [draft, setDraft] = useState("");
  const keyboardLift = useKeyboardHeight();
  const { bottom } = useSafeAreaInsets();

  const send = (text: string) => {
    setMessages((current) => sendMessage(current, text));
    setDraft("");
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingBottom: Math.max(keyboardLift, bottom) }}
    >
      <Text size="sm" muted className="px-4 pt-3 text-center">
        Demo conversation: messages stay on this device.
      </Text>
      <MessageScroller autoScroll className="flex-1">
        <MessageScroller.Viewport>
          <MessageScroller.Content className="gap-3 p-4">
            {messages.map((message) => (
              <MessageScroller.Item
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.from === "me"}
              >
                <Message align={message.from === "me" ? "end" : "start"}>
                  <Message.Content>
                    <Message.Bubble>
                      <Message.BubbleContent>{message.text}</Message.BubbleContent>
                    </Message.Bubble>
                  </Message.Content>
                </Message>
              </MessageScroller.Item>
            ))}
          </MessageScroller.Content>
        </MessageScroller.Viewport>
        <MessageScroller.Button />
      </MessageScroller>
      <View className="p-3">
        <AIInput value={draft} onValueChange={setDraft} onSubmit={send} avoidKeyboard={false}>
          <AIInput.Field placeholder="Message" />
          <AIInput.Toolbar>
            <AIInput.Spacer />
            <AIInput.Submit />
          </AIInput.Toolbar>
        </AIInput>
      </View>
    </View>
  );
}
