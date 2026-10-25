import { escapeHtml, type MiniAppSource } from "../lib/webui/document";

/** Shown for a mini app that has no content of its own yet. */
export const placeholderSource = (app: { title: string }): MiniAppSource => ({
  html: `<main class="ui-stack ui-center">
  <h1 class="ui-text ui-text-2xl ui-bold">${escapeHtml(app.title)}</h1>
  <p class="ui-text ui-muted">This mini app has no content yet.</p>
</main>`,
});

export const shopSource: MiniAppSource = {
  html: `<main class="ui-stack">
  <div>
    <h1 class="ui-text ui-text-3xl ui-bold">Shop</h1>
    <p class="ui-text ui-muted">Demo products, nothing is ordered.</p>
  </div>
  <ul class="ui-list" id="products"></ul>
  <div class="ui-card">
    <div class="ui-card-content ui-row">
      <span class="ui-text ui-medium ui-grow" id="summary"></span>
      <button class="ui-button ui-button--sm ui-button--outline" id="clear" type="button">Clear</button>
    </div>
  </div>
</main>`,
  js: `
const products = [
  { name: "Maize meal 5 kg", price: 6500 },
  { name: "Cooking oil 750 ml", price: 4500 },
  { name: "Bread", price: 1800 },
  { name: "Airtime R10", price: 1000 },
];
const quantities = products.map(() => 0);
const rand = (cents) => "R " + (cents / 100).toFixed(2);

const list = document.getElementById("products");
products.forEach((product, index) => {
  const item = document.createElement("li");
  item.className = "ui-item";
  item.innerHTML =
    '<div class="ui-grow"><p class="ui-text ui-medium"></p><p class="ui-text ui-text-sm ui-muted"></p></div>' +
    '<span class="ui-badge" hidden></span>' +
    '<button class="ui-button ui-button--sm ui-button--secondary" type="button">Add</button>';
  item.querySelector(".ui-medium").textContent = product.name;
  item.querySelector(".ui-muted").textContent = rand(product.price);
  item.querySelector("button").addEventListener("click", () => {
    quantities[index] += 1;
    render();
  });
  list.appendChild(item);
});

function render() {
  const badges = list.querySelectorAll(".ui-badge");
  quantities.forEach((quantity, index) => {
    badges[index].hidden = quantity === 0;
    badges[index].textContent = "x" + quantity;
  });
  const count = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const total = quantities.reduce((sum, quantity, index) => sum + quantity * products[index].price, 0);
  document.getElementById("summary").textContent =
    count === 0 ? "Cart is empty" : count + (count === 1 ? " item" : " items") + " · " + rand(total);
}
document.getElementById("clear").addEventListener("click", () => {
  quantities.fill(0);
  render();
});
render();
`,
};

export const walletSource: MiniAppSource = {
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
