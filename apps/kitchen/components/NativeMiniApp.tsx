import { Suspense, lazy, useMemo } from "react";
import { View } from "react-native";
import { Spinner } from "panelui-native";

import type { NativeMiniAppLoader } from "@shopong/miniapp";

export function NativeMiniApp({ load }: { load: NativeMiniAppLoader }) {
  const MiniApp = useMemo(() => lazy(load), [load]);

  return (
    <Suspense
      fallback={
        <View className="flex-1 items-center justify-center bg-background">
          <Spinner />
        </View>
      }
    >
      <MiniApp />
    </Suspense>
  );
}
