import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { memoryIdentityStore, type IdentityStore } from "./identity";

const KEY = "shopong.identity.seed";

// iOS: the keychain survives an app delete, so a reinstall brings the old identity back. The product
// owner accepted this (decision 4, story 2.2).
const secureStore: IdentityStore = {
  read: () => SecureStore.getItemAsync(KEY),
  write: (seed) => SecureStore.setItemAsync(KEY, seed),
};

// The web has no keystore, and a key never touches browser storage, so there the identity lives only
// as long as the page (decision 1, story 2.2).
export const identityStore: IdentityStore =
  Platform.OS === "web" ? memoryIdentityStore() : secureStore;
