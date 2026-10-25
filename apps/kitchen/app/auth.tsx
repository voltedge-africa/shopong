import { Stack } from "expo-router";
import { useState } from "react";
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

// The only reachable screen until the PIN is entered, so it has no header, back button or swipe back.
export default function Auth() {
  const { status, create, unlock } = useAuth();
  const [firstEntry, setFirstEntry] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const setup = status === "setup";
  const unavailable = status === "unavailable";

  const [title, hint] = unavailable
    ? ["PIN unavailable", "Kitchen can't read the PIN stored on this device."]
    : setup
      ? firstEntry === null
        ? ["Create a PIN", `Choose ${PIN_LENGTH} digits to protect Kitchen.`]
        : ["Confirm your PIN", "Enter the same PIN again."]
      : ["Enter your PIN", `Enter your ${PIN_LENGTH}-digit PIN to open Kitchen.`];

  const onComplete = async (pin: string) => {
    if (busy || unavailable) return;
    setError(undefined);

    if (setup && firstEntry === null) {
      setFirstEntry(pin);
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
          key={firstEntry === null ? "first" : "confirm"}
          length={PIN_LENGTH}
          type="numeric"
          mask
          autoFocus
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
