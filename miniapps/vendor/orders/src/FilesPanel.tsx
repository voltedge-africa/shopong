// The files on one order (story 3.7): what is attached, whether each file matches the record, and the buttons to attach
// a price list (the treasurer) or a delivery photo (a driver). A photo warning is shown before anyone takes one.

import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Input, Text } from "panelui-native";

import type { AttachmentHost } from "./host";
import {
  checkWords,
  PURPOSE_HELP,
  stateWords,
  type FileCheck,
  type FilePurpose,
  type FileRowView,
} from "./files";

export function FilesPanel({ host, order }: { host: AttachmentHost; order: string }) {
  const [rows, setRows] = useState<readonly FileRowView[]>([]);
  const [checks, setChecks] = useState<Record<string, FileCheck>>({});
  const [supplier, setSupplier] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const checking = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (mounted.current) setRows(host.filesFor(order));
  }, [host, order]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Each saved file is checked once when it is shown: its bytes hashed against the recorded SHA-512.
  useEffect(() => {
    for (const file of rows) {
      if (file.state !== "saved" || checking.current.has(file.hash)) continue;
      checking.current.add(file.hash);
      void host.check(file.hash).then((check) => {
        if (mounted.current) setChecks((current) => ({ ...current, [file.hash]: check }));
      });
    }
  }, [rows, host]);

  const attach = async (purpose: FilePurpose) => {
    setBusy(true);
    setProblem(undefined);
    const reason = await host.attach(order, purpose, supplier);
    if (!mounted.current) return;
    setBusy(false);
    if (reason !== undefined) setProblem(reason);
    refresh();
  };

  return (
    <View className="gap-2">
      <Text weight="bold">Files for this order</Text>
      {host.canAttachPhoto ? <Text muted>Don't photograph people's faces.</Text> : null}
      {rows.length === 0 ? <Text muted>No photos or price lists for this order yet.</Text> : null}
      {rows.map((file) => (
        <View key={file.hash} className="gap-1">
          <Text weight="bold">
            {file.supplier === undefined ? file.name : `${file.name} (${file.supplier})`}
          </Text>
          <Text>{stateWords(file)}</Text>
          {file.state === "saved" ? (
            <Text muted>{checkWords(file.purpose, checks[file.hash])}</Text>
          ) : null}
        </View>
      ))}
      {problem === undefined ? null : <Text>{problem}</Text>}
      {host.canAttachPriceList ? (
        <View className="gap-2">
          <Input label="Supplier for the price list" value={supplier} onChangeText={setSupplier} />
          <Text muted>{PURPOSE_HELP["price-list"]}</Text>
          <Button
            variant="outline"
            disabled={busy || supplier.trim() === ""}
            onPress={() => attach("price-list")}
          >
            Attach price list
          </Button>
        </View>
      ) : null}
      {host.canAttachPhoto ? (
        <View className="gap-2">
          <Text muted>{PURPOSE_HELP["delivery-photo"]}</Text>
          <Button variant="outline" disabled={busy} onPress={() => attach("delivery-photo")}>
            Attach delivery photo
          </Button>
        </View>
      ) : null}
      {rows.some((file) => file.state === "waiting") ? (
        <Button variant="outline" onPress={() => void host.retry().then(refresh)}>
          Try again
        </Button>
      ) : null}
    </View>
  );
}
