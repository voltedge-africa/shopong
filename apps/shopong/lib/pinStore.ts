import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { PinStore } from "./pin";

const KEY = "shopong.pin";

const secureStore: PinStore = {
  read: () => SecureStore.getItemAsync(KEY),
  write: (pin) => SecureStore.setItemAsync(KEY, pin),
};

// The web has no keystore, so there the PIN lives only as long as the page.
const memoryStore = (): PinStore => {
  let stored: string | null = null;
  return {
    read: async () => stored,
    write: async (pin) => {
      stored = pin;
    },
  };
};

export const pinStore: PinStore = Platform.OS === "web" ? memoryStore() : secureStore;
