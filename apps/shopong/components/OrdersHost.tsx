// Gives the Orders mini app what it needs from this phone's community: whether I am the treasurer, the quotes for an
// order, recording a quote, and the member's own pledge and bank payment (story 4.3). The rules are in
// `@shopong/community` and on the Node; the mini app only shows the answers. Mounted only around the Orders app
// (see app/miniapp/[id].tsx).
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import {
  OrdersHostContext,
  READ_FAILED,
  type AttachmentHost,
  type OrdersHost,
  type PaymentHost,
} from "@shopong/miniapp-orders";

import { useCommunity } from "../lib/CommunityProvider";
import type { PickedFile } from "../lib/attachments";
import { discardPickedCopy, readPickedBytes } from "../lib/pickedCopy";

/**
 * Asks the person for one image from the library. Undefined when they choose nothing. The picker is asked not to read
 * EXIF, and the bytes come back as the file holds them: the metadata is removed on the phone, before anything is sent.
 * `discard` removes the picker's own cached copy once the Node has the bytes (review item 10).
 */
async function pickImage(): Promise<PickedFile | undefined> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
  });
  if (result.canceled) return undefined;
  const asset = result.assets[0];
  if (asset === undefined) return undefined;
  const uri = asset.uri;
  const bytes = await readPickedBytes(uri, {
    isWeb: Platform.OS === "web",
    fetchBytes: async (target) => new Uint8Array(await (await fetch(target)).arrayBuffer()),
    readFile: async (target) => {
      const { File } = await import("expo-file-system");
      return new Uint8Array(await new File(target).arrayBuffer());
    },
  });
  return {
    name: asset.fileName ?? "photo",
    bytes,
    // Native only: on web the file system is never touched (expo-file-system is not supported there). The module is loaded
    // when the copy is removed, never when this file is imported. Cleanup never fails the attach.
    discard: () =>
      discardPickedCopy(uri, {
        isWeb: Platform.OS === "web",
        cacheUri: async () => (await import("expo-file-system")).Paths.cache.uri,
        removeFile: async (target) => {
          const { File } = await import("expo-file-system");
          const copy = new File(target);
          if (copy.exists) copy.delete();
        },
      }).then(() => undefined),
  };
}

export function OrdersHostProvider({ children }: { children: ReactNode }) {
  const { canAddQuotes, addQuote, quotesFor, pledgeOrder, paymentOf, payOrder, files } =
    useCommunity();
  const host = useMemo<OrdersHost>(() => {
    const payments: PaymentHost = {
      paymentOf,
      pledge: pledgeOrder,
      pay: async (order) => {
        const asked = await payOrder(order);
        if (!asked.ok) return asked.message;
        // The bank page opens in an in-app browser tab (AD-15). Closing it says nothing about the payment: the screen
        // asks the Node afterwards, and only the Node's record decides what is shown.
        try {
          await WebBrowser.openBrowserAsync(asked.url);
          return undefined;
        } catch {
          return "The bank page could not be opened. Try Pay again.";
        }
      },
    };
    const attachments: AttachmentHost | undefined =
      files === null
        ? undefined
        : {
            canAttachPriceList: canAddQuotes,
            canAttachPhoto: files.canAttachPhoto,
            filesFor: files.filesFor,
            // Never rejects: any error becomes a plain sentence the panel shows (web regression, review patch 2).
            attach: async (order, purpose, supplier) => {
              try {
                const picked = await pickImage();
                // Choosing nothing is not a refusal: the screen just shows what is there.
                if (picked === undefined) return undefined;
                return await files.attach(order, purpose, supplier, picked);
              } catch {
                return READ_FAILED;
              }
            },
            check: files.check,
            retry: files.retry,
          };
    return { canAdd: canAddQuotes, addQuote, quotesFor, payments, attachments };
  }, [canAddQuotes, addQuote, quotesFor, pledgeOrder, paymentOf, payOrder, files]);
  return <OrdersHostContext.Provider value={host}>{children}</OrdersHostContext.Provider>;
}
