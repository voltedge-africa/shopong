/**
 * Wallet: a person's cards and money on one screen, from PanelUI's Wallet block
 * (https://panelui.dev/docs/blocks/wallet, MIT). It keeps the block's design: the total rolls digit by
 * digit when it changes, the cards are a stack with one in front, the chart reads a running total and
 * the activity rows swipe open to split a payment or hide it.
 *
 * What we changed: Ionicons instead of Hugeicons (the app already ships them), imports from
 * `panelui-native` instead of a copied `@/components/ui`, rand and South African sample data, and the
 * state moved into `data.ts` so it can be tested. The host provides the header, so there is no back
 * button. The data is a demo: no money moves.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { LinearTransition, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AreaChart,
  Avatar,
  Button,
  Frame,
  Item,
  ReceiptIcon,
  Swipe,
  Tabs,
  Text,
  TextAnimation,
  XIcon,
  cn,
  type AreaChartDatum,
} from "panelui-native";
import { useCSSVariable } from "uniwind";

import {
  HOLDER,
  IN_THIS_MONTH,
  PAYEE,
  RANGES,
  SEND_AMOUNT,
  TOP_UP_AMOUNT,
  canSend,
  hideTransaction,
  initialWallet,
  money,
  moveMoney,
  spending,
  splitTransaction,
  totalBalance,
  type CardTone,
  type PaymentCard,
  type Range,
  type Transaction,
} from "./data";

/** A card's height, and how much of each card behind the front one shows. */
const CARD_HEIGHT = 208;
const STRIP_HEIGHT = 56;

/** A theme token, resolved for the drawing props that cannot take a class. */
function useToken(name: string, fallback: string) {
  const value = useCSSVariable(name);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** A glyph, tinted by the token it is given (the theme's foreground by default). */
function Glyph({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  const foreground = useToken("--color-foreground", "#262626");
  return <Ionicons name={name} size={size} color={color ?? foreground} />;
}

/**
 * Each tone is a surface and the ink that reads on it, both from the theme. `mark` paints in the ink
 * and `onMark` writes on top of that: the frozen pill is the card turned inside out.
 *
 * Every surface is opaque. The cards sit on top of one another in the deck, and a translucent fill
 * would show the card underneath through the one on top.
 */
const TONES: Record<CardTone, { surface: string; ink: string; mark: string; onMark: string }> = {
  primary: {
    surface: "bg-primary",
    ink: "text-primary-foreground",
    mark: "bg-primary-foreground",
    onMark: "text-primary",
  },
  raised: {
    surface: "bg-surface-tertiary",
    ink: "text-foreground",
    mark: "bg-foreground",
    onMark: "text-surface-tertiary",
  },
  outline: {
    surface: "border border-border bg-card",
    ink: "text-card-foreground",
    mark: "bg-card-foreground",
    onMark: "text-card",
  },
};

/** The same pairs as tokens, for the glyphs. */
const TONE_TOKENS: Record<CardTone, { ink: string; surface: string }> = {
  primary: { ink: "--color-primary-foreground", surface: "--color-primary" },
  raised: { ink: "--color-foreground", surface: "--color-surface-tertiary" },
  outline: { ink: "--color-card-foreground", surface: "--color-card" },
};

function CardFace({ card, frozen }: { card: PaymentCard; frozen: boolean }) {
  const tone = TONES[card.tone];
  const ink = useToken(TONE_TOKENS[card.tone].ink, "#fafafa");
  const surface = useToken(TONE_TOKENS[card.tone].surface, "#262626");

  return (
    <View
      accessible
      accessibilityLabel={`${card.name} card ending ${card.last4}, ${money(card.balance)}${frozen ? ", frozen" : ""}`}
      style={{ height: CARD_HEIGHT }}
      className={cn("w-full justify-between overflow-hidden rounded-3xl p-5", tone.surface)}
    >
      {/* Two faint rings in the corner: the card's pattern, drawn in its own ink. */}
      <View
        className={cn("absolute -right-16 -top-24 h-52 w-52 rounded-full opacity-10", tone.mark)}
      />
      <View
        className={cn("absolute -bottom-20 -left-10 h-40 w-40 rounded-full opacity-10", tone.mark)}
      />

      {/* Top row: what a strip shows when the card is behind another. */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text weight="semibold" className={tone.ink}>
            {card.name}
          </Text>
          {frozen ? (
            <View className={cn("flex-row items-center gap-1 rounded-full px-2 py-0.5", tone.mark)}>
              <Glyph name="snow-outline" size={12} color={surface} />
              <Text size="xs" weight="semibold" className={tone.onMark}>
                Frozen
              </Text>
            </View>
          ) : null}
        </View>
        <Text size="sm" weight="semibold" className={cn("tracking-widest tabular-nums", tone.ink)}>
          •••• {card.last4}
        </Text>
      </View>

      <View className="gap-0.5">
        <Text size="xs" className={cn("opacity-70", tone.ink)}>
          Balance
        </Text>
        <Text size="3xl" weight="bold" className={cn("tabular-nums", tone.ink)}>
          {money(card.balance)}
        </Text>
      </View>

      <View className="flex-row items-end justify-between">
        <View className="flex-row items-center gap-3">
          <View className="rotate-90">
            <Glyph name="wifi-outline" size={18} color={ink} />
          </View>
          <Text size="xs" className={cn("tabular-nums opacity-70", tone.ink)}>
            Expires {card.expiry}
          </Text>
        </View>
        {/* The network mark: two overlapping discs. */}
        <View className="flex-row">
          <View className={cn("h-7 w-7 rounded-full opacity-70", tone.mark)} />
          <View className={cn("-ml-3 h-7 w-7 rounded-full opacity-35", tone.mark)} />
        </View>
      </View>
    </View>
  );
}

/**
 * The cards, one in front and the rest as strips above it. The front card is rendered last, so it is
 * drawn over the strips and its top edge covers all but `STRIP_HEIGHT` of the card before it.
 * Reordering the children is the whole selection: each card is a layout-animated view, so the one
 * that moves to the end springs down to the front and the others close up behind it. Under reduced
 * motion the order simply changes.
 */
function CardStack({
  cards,
  selectedId,
  frozen,
  onSelect,
}: {
  cards: readonly PaymentCard[];
  selectedId: string;
  frozen: Record<string, boolean>;
  onSelect: (id: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const layout = reducedMotion
    ? undefined
    : LinearTransition.springify().damping(20).stiffness(160);
  const ordered = [
    ...cards.filter((card) => card.id !== selectedId),
    ...cards.filter((card) => card.id === selectedId),
  ];

  return (
    <View style={{ height: CARD_HEIGHT + STRIP_HEIGHT * (cards.length - 1) }}>
      {ordered.map((card, index) => {
        const selected = card.id === selectedId;
        return (
          <Animated.View
            key={card.id}
            layout={layout}
            style={{
              height: CARD_HEIGHT,
              marginTop: index === 0 ? 0 : STRIP_HEIGHT - CARD_HEIGHT,
            }}
          >
            <Pressable
              disabled={selected}
              onPress={() => onSelect(card.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityHint={selected ? undefined : "Brings this card to the front"}
            >
              <CardFace card={card} frozen={Boolean(frozen[card.id])} />
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** A round action with its name under it. */
function Action({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-1 items-center gap-2">
      <Button
        variant="secondary"
        size="icon"
        className="h-14 w-14 rounded-full"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={disabled}
      >
        <Glyph name={icon} size={22} />
      </Button>
      <Text size="xs" weight="medium" muted>
        {label}
      </Text>
    </View>
  );
}

function TransactionRow({
  transaction,
  onSplit,
  onHide,
}: {
  transaction: Transaction;
  onSplit: () => void;
  onHide: () => void;
}) {
  const incoming = transaction.amount > 0;
  const canSplit = !incoming && !transaction.split;

  return (
    <Swipe contentClassName="bg-background">
      <Swipe.End>
        {canSplit ? (
          <Swipe.Action icon={<ReceiptIcon />} label="Split" color="info" onPress={onSplit} />
        ) : null}
        <Swipe.Action icon={<XIcon />} label="Hide" color="destructive" onPress={onHide} />
      </Swipe.End>
      <Item size="sm" className="px-0">
        <Item.Media>
          {transaction.initials ? (
            <Avatar fallback={transaction.initials} />
          ) : (
            <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
              {transaction.icon ? <Glyph name={transaction.icon} size={18} /> : null}
            </View>
          )}
        </Item.Media>
        <Item.Content>
          <Item.Title>{transaction.title}</Item.Title>
          <Item.Description>
            {transaction.split ? `${transaction.detail} · split in two` : transaction.detail} ·{" "}
            {transaction.when}
          </Item.Description>
        </Item.Content>
        <Item.Actions>
          <Text weight="semibold" className={cn("tabular-nums", incoming && "text-success")}>
            {money(transaction.amount, true)}
          </Text>
        </Item.Actions>
      </Item>
    </Swipe>
  );
}

export default function Wallet() {
  const insets = useSafeAreaInsets();
  const [wallet, setWallet] = useState(initialWallet);
  const [selectedId, setSelectedId] = useState(wallet.cards[0]!.id);
  const [inspected, setInspected] = useState<AreaChartDatum | null>(null);
  const [frozen, setFrozen] = useState<Record<string, boolean>>({});
  const [range, setRange] = useState<Range>("month");

  const { cards, transactions } = wallet;
  const card = cards.find((item) => item.id === selectedId) ?? cards[0]!;
  const isFrozen = Boolean(frozen[card.id]);

  const data = useMemo(() => spending(card, range), [card, range]);
  const spent = data[data.length - 1]?.spent ?? 0;
  const shown = inspected ? Number(inspected.spent) : spent;
  const rangeLabel = RANGES.find((item) => item.id === range)!;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="px-5 pt-4"
      >
        <View className="w-full max-w-xl gap-7 self-center">
          {/* The total */}
          <View
            accessible
            accessibilityLabel={`Total balance ${money(totalBalance(cards))}`}
            className="gap-1"
          >
            <View className="flex-row items-center justify-between">
              <Text size="sm" muted>
                Total balance
              </Text>
              <Avatar fallback={HOLDER.initials} accessibilityLabel={HOLDER.name} />
            </View>
            <View className="flex-row items-baseline gap-1">
              <Text weight="bold" className="text-4xl">
                R
              </Text>
              <TextAnimation.Sliding
                value={totalBalance(cards)}
                decimals={2}
                thousandSeparator=" "
                textClassName="text-4xl font-bold"
              />
            </View>
            <Text size="sm" weight="medium" className="text-success">
              {money(IN_THIS_MONTH, true)} in this month
            </Text>
          </View>

          {/* The card in front is the one everything below acts on. */}
          <CardStack cards={cards} selectedId={card.id} frozen={frozen} onSelect={setSelectedId} />

          <View className="flex-row">
            <Action
              label="Top up"
              icon="add"
              disabled={isFrozen}
              onPress={() =>
                setWallet((current) =>
                  moveMoney(current, card.id, TOP_UP_AMOUNT, {
                    title: "Top-up",
                    detail: "From your bank",
                    when: "Just now",
                    icon: "business-outline",
                  }),
                )
              }
            />
            <Action
              label="Send"
              icon="arrow-up"
              disabled={!canSend(card, isFrozen)}
              onPress={() =>
                setWallet((current) =>
                  moveMoney(current, card.id, -SEND_AMOUNT, {
                    title: PAYEE.name,
                    detail: "Sent",
                    when: "Just now",
                    initials: PAYEE.initials,
                  }),
                )
              }
            />
            <Action
              label={isFrozen ? "Unfreeze" : "Freeze"}
              icon="snow-outline"
              onPress={() => setFrozen((current) => ({ ...current, [card.id]: !current[card.id] }))}
            />
          </View>

          {/* What the card in front has been spending, over the range picked above it */}
          <View className="gap-3">
            <Tabs
              defaultValue="month"
              value={range}
              onValueChange={(value) => {
                setInspected(null);
                setRange(value as Range);
              }}
            >
              <Tabs.List>
                {RANGES.map((item) => (
                  <Tabs.Trigger key={item.id} value={item.id}>
                    {item.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs>
            <Frame className="w-full">
              <Frame.Header>
                <Frame.Title>Spending · {card.name}</Frame.Title>
                <Frame.Action>Drag to inspect</Frame.Action>
              </Frame.Header>
              <Frame.Panel>
                <AreaChart
                  data={data}
                  xDataKey="label"
                  aspectRatio={1.9}
                  onActiveIndexChange={(_index, datum) => setInspected(datum)}
                >
                  <AreaChart.Header
                    className="px-4 pt-3.5"
                    value={money(shown)}
                    caption={inspected ? `${rangeLabel.by} ${inspected.label}` : rangeLabel.spent}
                  />
                  <AreaChart.Grid />
                  <AreaChart.Area dataKey="spent" />
                  <AreaChart.XAxis ticks={range === "month" ? 5 : undefined} />
                  <AreaChart.Tooltip />
                </AreaChart>
              </Frame.Panel>
            </Frame>
          </View>

          {/* Everything, newest first */}
          <View className="gap-1">
            <Text size="sm" weight="semibold" muted>
              Recent activity
            </Text>
            <Swipe.Group>
              {transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  onSplit={() => setWallet((current) => splitTransaction(current, transaction.id))}
                  onHide={() => setWallet((current) => hideTransaction(current, transaction.id))}
                />
              ))}
            </Swipe.Group>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
