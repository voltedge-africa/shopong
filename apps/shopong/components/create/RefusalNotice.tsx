import { Alert } from "panelui-native";

import type { Verdict } from "../../lib/classify";

export type Refusal = Extract<Verdict, { ok: false }>;

/** The app's own refusal of a request: no project is made and no agent is started. */
export function RefusalNotice({ refusal }: { refusal: Refusal }) {
  return (
    <Alert variant="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{refusal.title}</Alert.Title>
        <Alert.Description>{refusal.message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
