// Orders: the quotes for one order, side by side. The treasurer types each supplier's prices and delivery
// terms and what the order needs; everyone can read them. The lowest total is shown by a simple rule, with
// the margin and the rule in plain words (story 6.9). Nothing is chosen here: a person chooses the supplier.
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { Alert, Button, Input, Text } from "panelui-native";
import type { Quote } from "@shopong/community";

import { OrdersHostContext, type OrdersHost } from "./host";
import { deliveryText, emptyLine, quoteInput, randText, type LineDraft } from "./form";
import { orderRanking, type WantDraft } from "./ranking";

const emptyWant = (): WantDraft => ({ item: "", quantity: "" });

export default function Orders() {
  const host = useContext(OrdersHostContext);
  if (host === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text muted>Make a community first, in Settings.</Text>
      </View>
    );
  }
  return <OrdersView host={host} />;
}

function OrdersView({ host }: { host: OrdersHost }) {
  const [order, setOrder] = useState("");
  const [quotes, setQuotes] = useState<readonly Quote[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped after this phone saves a quote, or on Try again, so the list is read again. */
  const [saves, setSaves] = useState(0);
  /** What the order needs, as typed. Kept on this phone only (S-6.9-2). */
  const [wants, setWants] = useState<WantDraft[]>([emptyWant()]);
  const name = order.trim();
  const reload = useCallback(() => setSaves((count) => count + 1), []);
  const ranking = useMemo(
    () => (name === "" ? undefined : orderRanking(quotes, wants, name)),
    [quotes, wants, name],
  );

  // Changing the order name clears the quotes at once, so another order's quotes never show under this name.
  useEffect(() => {
    setQuotes([]);
  }, [name]);

  useEffect(() => {
    // A reply for an order that is no longer the one on screen is dropped.
    let current = true;
    setLoadFailed(false);
    if (name !== "") {
      host.quotesFor(name).then(
        (found) => {
          if (current) setQuotes(found);
        },
        () => {
          if (current) setLoadFailed(true);
        },
      );
    }
    return () => {
      current = false;
    };
  }, [host, name, saves]);

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="gap-4 p-4">
        <Text weight="bold">Quotes for an order</Text>
        <Text muted>
          Each supplier's prices and delivery terms for the order. Everyone can read them here.
        </Text>
        <Input label="Which order?" value={order} onChangeText={setOrder} autoCorrect={false} />

        <WantsSection wants={wants} onChange={setWants} />

        {name === "" ? (
          <Text muted>Type the order's name to see its quotes.</Text>
        ) : loadFailed ? (
          <View className="gap-2">
            <Text>Could not load the quotes. Try again.</Text>
            <Button variant="outline" onPress={reload}>
              Try again
            </Button>
          </View>
        ) : quotes.length === 0 ? (
          <Text muted>No quotes for this order yet.</Text>
        ) : (
          quotes.map((quote) => <QuoteCard key={quote.supplier} quote={quote} />)
        )}

        {ranking !== undefined && !loadFailed ? <RankingCard ranking={ranking} /> : null}

        {host.canAdd ? (
          <AddQuote host={host} order={name} onSaved={reload} />
        ) : (
          <Text muted>Only the treasurer can add a quote.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <View className="gap-1 rounded-xl border border-border p-3">
      <Text weight="bold">{quote.supplier}</Text>
      {quote.lines.map((line, index) => (
        <Text key={index}>
          {`${line.item}, ${line.unit}: ${randText(line.pricePerPackCents)} for a pack of ${line.packSize}`}
        </Text>
      ))}
      <Text muted>{`Delivery: ${deliveryText(quote.delivery)}`}</Text>
    </View>
  );
}

/** The items the order needs and how many units of each. The ranking compares the quotes against these. */
function WantsSection({
  wants,
  onChange,
}: {
  wants: readonly WantDraft[];
  onChange: (next: WantDraft[]) => void;
}) {
  const changeWant = (index: number, change: Partial<WantDraft>) =>
    onChange(wants.map((want, i) => (i === index ? { ...want, ...change } : want)));

  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <Text weight="bold">What the order needs</Text>
      <Text muted>Type each item and how many units of it the order needs.</Text>
      {wants.map((want, index) => (
        <View key={index} className="gap-2 rounded-lg border border-border p-3">
          <Input
            label="Item"
            value={want.item}
            onChangeText={(item) => changeWant(index, { item })}
            autoCorrect={false}
          />
          <Input
            label="Units needed"
            value={want.quantity}
            onChangeText={(quantity) => changeWant(index, { quantity })}
            keyboardType="number-pad"
          />
          {wants.length > 1 ? (
            <Button variant="outline" onPress={() => onChange(wants.filter((_, i) => i !== index))}>
              Remove this item
            </Button>
          ) : null}
        </View>
      ))}
      <Button variant="outline" onPress={() => onChange([...wants, emptyWant()])}>
        Add another item the order needs
      </Button>
    </View>
  );
}

/** The lowest total, the margin to the next supplier, and the rule, in plain words. Nothing is chosen here. */
function RankingCard({ ranking }: { ranking: ReturnType<typeof orderRanking> }) {
  if (!ranking.ok) {
    return (
      <View className="gap-1 rounded-xl border border-border p-3">
        <Text weight="bold">Which quote is lowest?</Text>
        {ranking.problems.map((problem, index) => (
          <Text key={`${index}-${problem}`} muted>
            {problem}
          </Text>
        ))}
      </View>
    );
  }
  const { view } = ranking;
  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <Text weight="bold">Which quote is lowest?</Text>
      <Text muted>{`Ranked for: ${view.rankedFor}`}</Text>
      <Text muted>{view.rule}</Text>
      <Text weight="bold">{view.headline}</Text>
      {view.rows.map((row) => (
        <View key={row.supplier} className="gap-1 rounded-lg border border-border p-3">
          <Text weight="bold">{`${row.rank}. ${row.supplier}`}</Text>
          <Text>{`Total: ${row.total}`}</Text>
          <Text muted>{`Delivery: ${row.delivery}`}</Text>
          {row.next !== undefined ? <Text muted>{row.next}</Text> : null}
        </View>
      ))}
      {view.cannotCompare.map((sentence, index) => (
        <Text key={index} muted>
          {sentence}
        </Text>
      ))}
    </View>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** The treasurer's form. A refusal shows every plain reason and nothing is recorded. */
function AddQuote({
  host,
  order,
  onSaved,
}: {
  host: OrdersHost;
  order: string;
  onSaved: () => void;
}) {
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [feeText, setFeeText] = useState("");
  const [daysText, setDaysText] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const changeLine = (index: number, change: Partial<LineDraft>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...change } : line)));

  const save = async () => {
    setBusy(true);
    setSaved(false);
    const reason = await host.addQuote(quoteInput({ order, supplier, lines, feeText, daysText }));
    setBusy(false);
    setProblem(reason);
    if (reason === undefined) {
      setSupplier("");
      setLines([emptyLine()]);
      setFeeText("");
      setDaysText("");
      setSaved(true);
      onSaved();
    }
  };

  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <Text weight="bold">Add a quote</Text>
      <Input label="Supplier" value={supplier} onChangeText={setSupplier} autoCorrect={false} />

      {lines.map((line, index) => (
        <View key={index} className="gap-2 rounded-lg border border-border p-3">
          <Text weight="bold">{`Item ${index + 1}`}</Text>
          <Input
            label="Item"
            value={line.item}
            onChangeText={(item) => changeLine(index, { item })}
            autoCorrect={false}
          />
          <Input
            label="Unit, for example bag or litre"
            value={line.unit}
            onChangeText={(unit) => changeLine(index, { unit })}
            autoCorrect={false}
          />
          <Input
            label="Units in one pack"
            value={line.packSize}
            onChangeText={(packSize) => changeLine(index, { packSize })}
            keyboardType="number-pad"
          />
          <Input
            label="Price of one pack (R)"
            value={line.price}
            onChangeText={(price) => changeLine(index, { price })}
            keyboardType="decimal-pad"
          />
          {lines.length > 1 ? (
            <Button
              variant="outline"
              onPress={() => setLines((current) => current.filter((_, i) => i !== index))}
            >
              Remove this item
            </Button>
          ) : null}
        </View>
      ))}
      <Button variant="outline" onPress={() => setLines((current) => [...current, emptyLine()])}>
        Add another item
      </Button>

      <Input
        label="Delivery fee (R, 0 if free)"
        value={feeText}
        onChangeText={setFeeText}
        keyboardType="decimal-pad"
      />
      <Input
        label="Delivery days (0 if same day)"
        value={daysText}
        onChangeText={setDaysText}
        keyboardType="number-pad"
      />

      {problem !== undefined ? <ErrorNote message={problem} /> : null}
      {saved ? <Text>Quote saved.</Text> : null}
      <Button fullWidth disabled={busy} onPress={save}>
        Save quote
      </Button>
    </View>
  );
}
