import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * How far to lift a screen's bottom edge to clear the on-screen keyboard, 0 while it is hidden.
 * Android draws edge to edge, so the window no longer shrinks to make room for the keyboard; a
 * screen with an input at the bottom pads itself by this much instead. Android reports the
 * keyboard's height without the navigation bar under it, so that is added back.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  const { bottom } = useSafeAreaInsets();

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const shown = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setHeight(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height > 0 && Platform.OS === "android" ? height + bottom : height;
}
