// Orders: the quotes for one order, side by side. The treasurer types each supplier's prices and delivery
// terms and what the order needs; everyone can read them. The lowest total is shown by a simple rule, with
// the margin and the rule in plain words (story 6.9). Nothing is chosen here: a person chooses the supplier.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Alert, Button, Input, Text } from "panelui-native";
import { amountProblem, rankQuotes, tidy, type Quote, type StoredOrder } from "@shopong/community";

import { OrdersHostContext, type OrderList, type OrdersHost, type PaymentHost } from "./host";
import { FilesPanel } from "./FilesPanel";
import { ProofPanel } from "./ProofPanel";
import {
  deadlineText,
  deliveryText,
  emptyLine,
  parseRand,
  proposalInput,
  quoteInput,
  randText,
  type LineDraft,
} from "./form";
import {
  actionLabel,
  createSingleFlight,
  payCardOf,
  SIMULATED_NOTE,
  type PayAction,
  type PaymentView,
} from "./pay";
import { draftsFromWanted, orderRanking, wantedFromDrafts, type WantDraft } from "./ranking";
import { PayoutsSection } from "./PayoutsSection";

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
  /** The orders on the record and the members, as this phone's copy holds them. Undefined until the first read. */
  const [list, setList] = useState<OrderList | undefined>();
  const [listFailed, setListFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** Bumped when the list must be read again: on open, on pull-to-refresh, after a proposal or an approval (story 8.2). */
  const [listVersion, setListVersion] = useState(0);
  /** The order on screen, by its name. Empty until one is opened from the list. */
  const [selected, setSelected] = useState("");
  const [proposing, setProposing] = useState(false);
  const [quotes, setQuotes] = useState<readonly Quote[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped after this phone saves a quote, or on Try again, so the list is read again. */
  const [saves, setSaves] = useState(0);
  const reload = useCallback(() => setSaves((count) => count + 1), []);
  const refreshList = useCallback(() => setListVersion((count) => count + 1), []);

  useEffect(() => {
    // The record is read when the screen opens, and again on pull-to-refresh or after a change (Q6, story 8.2).
    let current = true;
    setListFailed(false);
    host.orders().then(
      (found) => {
        if (!current) return;
        setList(found);
        setRefreshing(false);
      },
      () => {
        if (!current) return;
        setListFailed(true);
        setRefreshing(false);
      },
    );
    return () => {
      current = false;
    };
  }, [host, listVersion]);

  const orders = list?.orders ?? [];
  const order = orders.find((candidate) => candidate.name === selected);
  const name = order?.name ?? "";
  /** What the order needs, as the proposal recorded it: every phone ranks against the same list (S-6.9-2). */
  const wants = useMemo(() => (order === undefined ? [] : draftsFromWanted(order.items)), [order]);
  const ranking = useMemo(
    () => (name === "" ? undefined : orderRanking(quotes, wants, name)),
    [quotes, wants, name],
  );
  // The same ranking as the card, with cents, for choosing the supplier to pay (story 4.7). Only when the needs are valid.
  const rawRanking = useMemo(() => {
    if (name === "" || ranking === undefined || !ranking.ok) return undefined;
    const checked = rankQuotes(
      quotes.filter((quote) => quote.order === tidy(name)),
      wantedFromDrafts(wants),
    );
    return checked.ok ? checked.value : undefined;
  }, [quotes, wants, name, ranking]);

  // Changing the order clears the quotes at once, so another order's quotes never show under this name.
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
    <ScrollView
      className="flex-1 bg-background"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            refreshList();
          }}
        />
      }
    >
      <View className="gap-4 p-4">
        <Text weight="bold">Orders</Text>
        <Text muted>
          Every order in your community. Tap one to see its quotes, pledges and payments.
        </Text>

        {listFailed ? (
          <View className="gap-2">
            <Text>Could not load the orders. Try again.</Text>
            <Button variant="outline" onPress={refreshList}>
              Try again
            </Button>
          </View>
        ) : list === undefined ? (
          <Text muted>Loading the orders...</Text>
        ) : orders.length === 0 ? (
          <Text muted>No orders yet. Propose one below.</Text>
        ) : (
          orders.map((listed) => (
            <OrderRow
              key={listed.id}
              order={listed}
              memberCount={list.memberCount}
              selected={listed.name === name}
              onOpen={() => setSelected(listed.name)}
            />
          ))
        )}

        {proposing ? (
          <ProposeOrder
            host={host}
            onProposed={() => {
              setProposing(false);
              refreshList();
            }}
            onCancel={() => setProposing(false)}
          />
        ) : (
          <Button variant="outline" onPress={() => setProposing(true)}>
            Propose an order
          </Button>
        )}

        {order !== undefined ? (
          <>
            <Text weight="bold">{`Order: ${order.name}`}</Text>
            <ApproveOrder host={host} order={order} onApproved={refreshList} />
            <View className="gap-1 rounded-xl border border-border p-3">
              <Text weight="bold">What the order needs</Text>
              {order.items.map((want) => (
                <Text key={want.item}>{`${want.item}: ${want.quantity} units`}</Text>
              ))}
            </View>

            <Text weight="bold">Quotes for this order</Text>
            <Text muted>
              Each supplier's prices and delivery terms for the order. Everyone can read them here.
            </Text>

            {loadFailed ? (
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

            {host.payments !== undefined ? (
              <PayPanel key={`pay-${name}`} payments={host.payments} order={name} />
            ) : null}

            {host.attachments !== undefined ? (
              <FilesPanel key={`files-${name}`} host={host.attachments} order={name} />
            ) : null}

            {host.proof !== undefined ? (
              <ProofPanel key={`proof-${name}`} host={host.proof} order={name} />
            ) : null}

            {host.payouts !== undefined ? (
              <PayoutsSection
                key={`payouts-${name}`}
                host={host.payouts}
                order={name}
                ranking={rawRanking}
                treasurer={host.canAdd}
              />
            ) : null}

            {host.canAdd ? (
              <AddQuote host={host} order={name} onSaved={reload} />
            ) : (
              <Text muted>Only the treasurer can add a quote.</Text>
            )}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** One order on the list: its name, whether it is open, the budget per member with the total, and the deadline. */
function OrderRow({
  order,
  memberCount,
  selected,
  onOpen,
}: {
  order: StoredOrder;
  memberCount: number;
  selected: boolean;
  onOpen: () => void;
}) {
  const total = order.budgetPerMemberMinor * memberCount;
  return (
    <View className="gap-1 rounded-xl border border-border p-3">
      <Text weight="bold">{order.name}</Text>
      <Text muted>
        {order.status === "open"
          ? "Open: quotes and pledges are allowed."
          : "Waiting for the treasurer to approve it."}
      </Text>
      <Text
        muted
      >{`Budget: ${randText(order.budgetPerMemberMinor)} each, ${randText(total)} in total for ${memberCount} ${memberCount === 1 ? "member" : "members"}`}</Text>
      <Text muted>{`Quotes and pledges until ${deadlineText(order.deadline)}`}</Text>
      <Button variant="outline" disabled={selected} onPress={onOpen}>
        {selected ? "Showing this order" : "Open this order"}
      </Button>
    </View>
  );
}

/** The treasurer's approval of a proposed order: it opens quotes and pledges. Nobody else sees the button. */
function ApproveOrder({
  host,
  order,
  onApproved,
}: {
  host: OrdersHost;
  order: StoredOrder;
  onApproved: () => void;
}) {
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!host.canAdd || order.status !== "proposed") return null;
  const approve = async () => {
    setBusy(true);
    const reason = await host.approve(order.id);
    setBusy(false);
    setProblem(reason);
    if (reason === undefined) onApproved();
  };
  return (
    <View className="gap-2 rounded-xl border border-border p-3">
      <Text weight="bold">Approve this order</Text>
      <Text muted>Approving opens quotes and pledges for it.</Text>
      {problem !== undefined ? <ErrorNote message={problem} /> : null}
      <Button fullWidth disabled={busy} onPress={approve}>
        Approve this order
      </Button>
    </View>
  );
}

/** A new bulk order: its name, the items it needs, a budget per member and a deadline. The record checks it. */
function ProposeOrder({
  host,
  onProposed,
  onCancel,
}: {
  host: OrdersHost;
  onProposed: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [wants, setWants] = useState<WantDraft[]>([emptyWant()]);
  const [budgetText, setBudgetText] = useState("");
  const [deadlineText, setDeadlineText] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const propose = async () => {
    setBusy(true);
    const reason = await host.propose(proposalInput({ name, wants, budgetText, deadlineText }));
    setBusy(false);
    setProblem(reason);
    if (reason === undefined) onProposed();
  };

  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <Text weight="bold">Propose an order</Text>
      <Text muted>
        Everyone in the community sees it once it is recorded. The treasurer then approves it.
      </Text>
      <Input label="Order name" value={name} onChangeText={setName} autoCorrect={false} />
      <WantsSection wants={wants} onChange={setWants} />
      <Input
        label="Budget per member (R)"
        value={budgetText}
        onChangeText={setBudgetText}
        keyboardType="decimal-pad"
      />
      <Input
        label="Deadline (a date, like 2026-11-30)"
        value={deadlineText}
        onChangeText={setDeadlineText}
        autoCorrect={false}
      />
      {problem !== undefined ? <ErrorNote message={problem} /> : null}
      <Button fullWidth disabled={busy} onPress={propose}>
        Propose this order
      </Button>
      <Button variant="outline" onPress={onCancel}>
        Cancel
      </Button>
    </View>
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

/**
 * The member's own pledge and its bank payment for this order. What it shows is `payCardOf`'s words for what the Node
 * says; nothing here is "paid" unless the Node's record says a test payment completed. A pledge is made here with an
 * amount in rand; the Node checks the amount again before it asks the bank.
 */
function PayPanel({ payments, order }: { payments: PaymentHost; order: string }) {
  const [view, setView] = useState<PaymentView | undefined>();
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setView(await payments.paymentOf(order));
  }, [payments, order]);

  useEffect(() => {
    let current = true;
    setView(undefined);
    payments.paymentOf(order).then(
      (found) => {
        if (current) setView(found);
      },
      () => {
        if (current) setView({ onNode: true, queued: false, status: "unreachable" });
      },
    );
    return () => {
      current = false;
    };
  }, [payments, order]);

  const pledge = async (minor: number | undefined): Promise<string | undefined> => {
    if (minor === undefined || Number.isNaN(minor))
      return "Type the amount in rand, like 150 or 150.50.";
    const problem = amountProblem(minor);
    if (problem !== undefined) return problem;
    return payments.pledge(order, minor);
  };

  // One action at a time: a second tap while one runs is ignored, so two taps open one bank tab (review item 12).
  const flight = useRef(createSingleFlight());
  const run = (action: PayAction) => flight.current.run(() => doRun(action)).then(() => undefined);

  const doRun = async (action: PayAction) => {
    setBusy(true);
    setNote(undefined);
    let reason: string | undefined;
    if (action === "pledge") {
      reason = await pledge(parseRand(amountText));
      if (reason === undefined) setAmountText("");
    } else if (action === "pay") {
      reason = await payments.pay(order);
    } else if (action === "pay_again") {
      // A new attempt is a new pledge event for the same amount. It must reach the Node's record before Pay can ask
      // the bank for it, so this only queues it; the card then shows it as saved until it has arrived.
      const minor = view?.pledgedMinor;
      reason = minor === undefined ? "Make a pledge first." : await pledge(minor);
    }
    setNote(reason);
    await load();
    setBusy(false);
  };

  const card = view === undefined ? undefined : payCardOf(view);
  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <Text weight="bold">Your pledge and payment</Text>
      {card === undefined ? (
        <Text muted>Checking your pledge...</Text>
      ) : (
        <>
          <Text weight="bold">{card.heading}</Text>
          {card.body.map((line) => (
            <Text key={line} muted>
              {line}
            </Text>
          ))}
          {card.actions.includes("pledge") ? (
            <Input
              label="How much will you pay (R)?"
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="decimal-pad"
            />
          ) : null}
          {note !== undefined ? <ErrorNote message={note} /> : null}
          {card.actions.map((action) => (
            <Button
              key={action}
              fullWidth={action === "pledge" || action === "pay"}
              variant={action === "pay" || action === "pledge" ? "primary" : "outline"}
              disabled={busy}
              onPress={() => void run(action)}
            >
              {actionLabel(action, card.amountText)}
            </Button>
          ))}
        </>
      )}
      <Text muted>{SIMULATED_NOTE}</Text>
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
