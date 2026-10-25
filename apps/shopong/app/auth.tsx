import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { OtpInput, Text } from "panelui-native";

import { useAuth, type PinOutcome } from "../lib/auth";
import { PIN_LENGTH } from "../lib/pin";

const ERRORS: Record<Exclude<PinOutcome, "ok">, string> = {
  invalid: `Enter ${PIN_LENGTH} digits.`,
  mismatch: "The PINs didn't match. Choose a PIN again.",
  wrong: "Wrong PIN. Try again.",
  error: "Couldn't use the PIN store on this device.",
};

type Focusable = { focus: () => void };

// The only reachable screen until the PIN is entered, so it has no header, back button or swipe back.
export default function Auth() {
  const { status, create, unlock } = useAuth();
  const [firstEntry, setFirstEntry] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const input = useRef<Focusable | null>(null);

  const setup = status === "setup";
  const unavailable = status === "unavailable";

  // `autoFocus` does not raise the keyboard on Android when this is the first screen shown: the
  // field takes focus before the window can show a keyboard. Ask again once the screen has settled.
  // The field then stays mounted and focused through the steps, so the keyboard stays up.
  useEffect(() => {
    if (unavailable) return;
    const timer = setTimeout(() => input.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [unavailable]);

  const [title, hint] = unavailable
    ? ["PIN unavailable", "Shopong can't read the PIN stored on this device."]
    : setup
      ? firstEntry === null
        ? ["Create a PIN", `Choose ${PIN_LENGTH} digits to protect Shopong.`]
        : ["Confirm your PIN", "Enter the same PIN again."]
      : ["Enter your PIN", `Enter your ${PIN_LENGTH}-digit PIN to open Shopong.`];

  const onComplete = async (pin: string) => {
    if (busy || unavailable) return;
    setError(undefined);

    if (setup && firstEntry === null) {
      setFirstEntry(pin);
      // Clear on the next tick, not in this batch: the field fires `onComplete` once per fill and
      // only re-arms when it has rendered the full code, so clearing here would swallow the next one.
      await new Promise((resolve) => setTimeout(resolve, 0));
      setValue("");
      return;
    }

    setBusy(true);
    const outcome = setup ? await create(firstEntry ?? "", pin) : await unlock(pin);
    setBusy(false);
    if (outcome === "ok") return; // the root layout swaps this screen for the app
    if (outcome === "mismatch") setFirstEntry(null);
    setError(ERRORS[outcome]);
    setValue("");
  };

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background p-6">
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View className="items-center gap-2">
        <Text accessibilityRole="header" size="2xl" weight="bold">
          {title}
        </Text>
        <Text muted className="text-center">
          {hint}
        </Text>
      </View>
      {unavailable ? null : (
        <OtpInput
          // PanelUI types this ref as the older TextInput class; at runtime it is a plain TextInput.
          ref={(node) => {
            input.current = node as unknown as Focusable | null;
          }}
          length={PIN_LENGTH}
          type="numeric"
          mask
          value={value}
          onChangeText={setValue}
          onComplete={onComplete}
          isInvalid={error !== undefined}
          errorMessage={error}
          accessibilityLabel={title}
        />
      )}
    </View>
  );
}
