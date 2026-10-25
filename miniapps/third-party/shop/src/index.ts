import type { MiniAppManifest, MiniAppSource } from "@shopong/miniapp";

// Demo products with a cart. Plain html and js on the host's CSS kit; it can reach nothing else.
const source: MiniAppSource = {
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

export const manifest: MiniAppManifest = {
  id: "shop",
  title: "Shop",
  icon: "storefront-outline",
  category: "Commerce",
  content: { kind: "web", source },
};
