import type { MiniAppManifest, MiniAppSource } from "@shopong/miniapp";

// A demo balance and top-up form, local to the page: no money moves.
const source: MiniAppSource = {
  html: `<main class="ui-stack">
  <h1 class="ui-text ui-text-3xl ui-bold">Wallet</h1>
  <div class="ui-card">
    <div class="ui-card-header">
      <p class="ui-text ui-text-sm ui-muted">Balance</p>
      <p class="ui-text ui-text-3xl ui-bold" id="balance"></p>
    </div>
    <div class="ui-card-content ui-stack">
      <div class="ui-field">
        <label class="ui-label" for="amount">Amount</label>
        <input class="ui-input" id="amount" inputmode="decimal" placeholder="0.00" autocomplete="off">
        <p class="ui-error" id="error" hidden></p>
      </div>
      <button class="ui-button ui-button--full" id="topup" type="button">Top up</button>
      <p class="ui-description">Demo only: the balance is local to this screen and no money moves.</p>
    </div>
  </div>
</main>`,
  js: `
let cents = 125000;
const balance = document.getElementById("balance");
const error = document.getElementById("error");
const amount = document.getElementById("amount");
const rand = (value) => "R " + (value / 100).toFixed(2);
balance.textContent = rand(cents);

document.getElementById("topup").addEventListener("click", () => {
  const value = Math.round(parseFloat(amount.value.replace(",", ".")) * 100);
  if (!Number.isFinite(value) || value <= 0) {
    error.textContent = "Enter an amount greater than zero.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  cents += value;
  balance.textContent = rand(cents);
  amount.value = "";
});
`,
};

export const manifest: MiniAppManifest = {
  id: "wallet",
  title: "Wallet",
  icon: "wallet-outline",
  category: "Money",
  content: { kind: "web", source },
};
