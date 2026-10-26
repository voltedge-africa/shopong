// Pay a supplier from the pool (story 4.7), on the Orders screen. The treasurer sends the payment for the supplier chosen in
// the comparison (story 8.3) for approval, then pays once enough people have approved. Each approver reads what they are approving and confirms it before
// their approval is signed; the treasurer confirms before the payment is sent (AGENTS rule 8). Every figure and refusal
// comes from the record or the Node; nothing here decides them.
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Input, Text } from "panelui-native";
import type { Selection } from "@shopong/community";

import type { BankForm, PayoutHost } from "./host";
import { createSingleFlight } from "./pay";
import { randText } from "./form";
import {
  approvalPrompt,
  payConfirmationOf,
  payoutCardsOf,
  PAYOUT_SIMULATED_NOTE,
  type PayoutCard,
} from "./payouts";

interface Props {
  readonly host: PayoutHost;
  readonly order: string;
  /** The treasurer's chosen supplier for this order, with its total (story 8.3). Undefined until one is chosen. */
  readonly selection: Selection | undefined;
  /** The ranking's recommendation kind, recorded with the payment (clear, too_close, only_one or none). */
  readonly recommendation: string;
  /** Whether this person is the treasurer (may send a payment for approval, pay, and keep bank details). */
  readonly treasurer: boolean;
}

const emptyBank = (): BankForm & { readonly supplierText: string } => ({
  supplierText: "",
  name: "",
  bankId: "",
  accountNumber: "",
  accountType: "current",
});

export function PayoutsSection({ host, order, selection, recommendation, treasurer }: Props) {
  const [cards, setCards] = useState<readonly PayoutCard[]>([]);
  const [proposalNotices, setProposalNotices] = useState<readonly string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [confirming, setConfirming] = useState<string | undefined>();
  const [paying, setPaying] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState(emptyBank);
  /** Synchronous guard: a second tap while a request is on its way sends nothing (AGENTS rule 8). */
  const payFlight = useRef(createSingleFlight()).current;
  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    // A reply for an order that is no longer on screen is dropped.
    let current = true;
    setLoadFailed(false);
    host.paymentsOf(order).then(
      (reading) => {
        if (!current) return;
        setCards(payoutCardsOf(reading, order));
        setProposalNotices(reading.proposalNotices ?? []);
      },
      () => {
        if (current) setLoadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [host, order, reloads]);

  /** Runs one action. Its refusal is shown; a success re-reads the record and the Node's answers. */
  const act = async (action: () => Promise<string | undefined>, done?: () => void) => {
    setMessage(undefined);
    try {
      const problem = await action();
      if (problem === undefined) done?.();
      else setMessage(problem);
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      reload();
    }
  };

  /** Pays after the treasurer confirmed; a tap while a payment is on its way does nothing. */
  const payNow = (payout: string) =>
    payFlight.run(async () => {
      setBusy(true);
      try {
        await act(
          () => host.pay(payout),
          () => setPaying(undefined),
        );
      } finally {
        setBusy(false);
      }
    });

  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <Text weight="bold">Pay a supplier</Text>
      <Text muted>{PAYOUT_SIMULATED_NOTE}</Text>

      {selection !== undefined ? (
        <View className="gap-2">
          <Text>{`Chosen in the comparison: ${selection.supplier}, ${randText(selection.totalMinor)}.`}</Text>
          {treasurer ? (
            <Button
              disabled={busy}
              onPress={() =>
                act(() =>
                  host.propose(order, selection.supplier, selection.totalMinor, recommendation),
                )
              }
            >
              {`Send ${selection.supplier} ${randText(selection.totalMinor)} for approval`}
            </Button>
          ) : null}
        </View>
      ) : treasurer ? (
        <Text muted>Choose a supplier in the comparison above first.</Text>
      ) : null}

      {proposalNotices.map((notice, index) => (
        <Text key={`proposal-${index}`}>{notice}</Text>
      ))}

      {loadFailed ? <Text>The payments could not be read. Try again.</Text> : null}
      {!loadFailed && cards.length === 0 ? (
        <Text muted>No payment is recorded for this order yet.</Text>
      ) : null}

      {cards.map((card) => (
        <View key={card.payout} className="gap-2 rounded-lg border border-border p-3">
          <Text weight="bold">{card.title}</Text>
          {card.paid ? <Text weight="bold">Supplier paid</Text> : null}
          <Text muted>{card.approvalsText}</Text>
          <Text>{card.statusText}</Text>
          {card.notice !== undefined ? (
            <Text>{`Your approval did not count: ${card.notice}`}</Text>
          ) : null}

          {confirming === card.payout ? (
            <View className="gap-2">
              {approvalPrompt({
                required: card.required,
                position: card.count + 1,
                amountMinor: card.amountMinor,
                supplier: card.supplier,
              }).map((line) => (
                <Text key={line}>{line}</Text>
              ))}
              <Button
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  void act(
                    () => host.approve(card.payout),
                    () => setConfirming(undefined),
                  ).finally(() => setBusy(false));
                }}
              >
                Confirm and sign my approval
              </Button>
              <Button variant="outline" disabled={busy} onPress={() => setConfirming(undefined)}>
                Cancel
              </Button>
            </View>
          ) : card.canApprove ? (
            <Button variant="outline" disabled={busy} onPress={() => setConfirming(card.payout)}>
              Approve this payment
            </Button>
          ) : card.approvedByMe && card.sentText === undefined ? (
            <Text muted>You have approved this payment.</Text>
          ) : null}

          {card.canPay && paying === card.payout ? (
            <View className="gap-2">
              {payConfirmationOf(card).map((line) => (
                <Text key={line}>{line}</Text>
              ))}
              <Button disabled={busy} onPress={() => void payNow(card.payout)}>
                Confirm and pay the supplier (simulated)
              </Button>
              <Button variant="outline" disabled={busy} onPress={() => setPaying(undefined)}>
                Cancel
              </Button>
            </View>
          ) : card.canPay ? (
            <Button disabled={busy} onPress={() => setPaying(card.payout)}>
              Pay the supplier (simulated)
            </Button>
          ) : null}
        </View>
      ))}

      {treasurer ? (
        <View className="gap-2">
          <Text weight="bold">Supplier bank details</Text>
          <Text muted>
            Kept on the OCN Node only. They are never written to the community's record.
          </Text>
          <Input
            label="Supplier, as on the quote"
            value={bank.supplierText}
            onChangeText={(v) => setBank({ ...bank, supplierText: v })}
            autoCorrect={false}
          />
          <Input
            label="Account holder name"
            value={bank.name}
            onChangeText={(v) => setBank({ ...bank, name: v })}
            autoCorrect={false}
          />
          <Input
            label="Bank"
            value={bank.bankId}
            onChangeText={(v) => setBank({ ...bank, bankId: v })}
            autoCorrect={false}
          />
          <Input
            label="Account number (6 to 16 digits)"
            value={bank.accountNumber}
            onChangeText={(v) => setBank({ ...bank, accountNumber: v })}
            keyboardType="number-pad"
          />
          <View className="flex-row gap-2">
            <Button
              variant={bank.accountType === "current" ? "primary" : "outline"}
              onPress={() => setBank({ ...bank, accountType: "current" })}
            >
              Current
            </Button>
            <Button
              variant={bank.accountType === "savings" ? "primary" : "outline"}
              onPress={() => setBank({ ...bank, accountType: "savings" })}
            >
              Savings
            </Button>
          </View>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() =>
              act(
                () =>
                  host.saveBank(bank.supplierText.trim(), {
                    name: bank.name.trim(),
                    bankId: bank.bankId.trim(),
                    accountNumber: bank.accountNumber.trim(),
                    accountType: bank.accountType,
                  }),
                () => setBank(emptyBank),
              )
            }
          >
            Save bank details on the Node
          </Button>
        </View>
      ) : null}

      {message !== undefined ? <Text>{message}</Text> : null}
    </View>
  );
}
