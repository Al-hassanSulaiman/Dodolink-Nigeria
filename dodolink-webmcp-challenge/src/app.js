import {
  preparePurchasePlan,
  productReviewUrl,
  storeReviewUrl,
} from "./api.js";
import { PLAN_EVENT, registerWebMcpTools } from "./webmcp.js";

const status = document.querySelector("#protocol-status");
const statusText = status.querySelector("span:last-child");
const requestInput = document.querySelector("#request");
const form = document.querySelector("#search-form");
const planContent = document.querySelector("#plan-content");
const planTitle = document.querySelector("#plan-title");
const resultCount = document.querySelector("#result-count");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));
}

function money(value) {
  return `₦${Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

function setStatus(value) {
  status.classList.toggle("active", value === "active");
  status.classList.toggle("unavailable", value === "unavailable");
  statusText.textContent = value === "active"
    ? "WebMCP Protocol: Active"
    : value === "unavailable"
      ? "WebMCP Protocol: Browser fallback"
      : "WebMCP Protocol: Connecting…";
}

function renderPlan(plan) {
  planTitle.textContent = "Proposed purchase plan";
  resultCount.textContent = `${plan.products.length} product${plan.products.length === 1 ? "" : "s"}`;
  const productCards = plan.products.map((product) => `
    <a class="result-card" href="${productReviewUrl(product.id)}">
      <strong>${escapeHtml(product.name)}</strong>
      <span class="result-meta">${escapeHtml(product.storeName)} · ${escapeHtml(product.category)}</span>
      <div class="price">${money(product.price)}</div>
      <span class="review-link">Review product ↗</span>
    </a>
  `).join("");
  const storeCards = plan.stores?.map((store) => `
    <a class="result-card" href="${storeReviewUrl(store.id)}">
      <strong>${escapeHtml(store.name)}</strong>
      <span class="result-meta">${escapeHtml(store.location)} · ${escapeHtml(store.category)}</span>
      <div class="price">${store.avgRating ? `${Number(store.avgRating).toFixed(1)} / 5` : "Seller profile"}</div>
      <span class="review-link">Review store ↗</span>
    </a>
  `).join("") || "";
  planContent.innerHTML = `
    <div class="plan-summary">${escapeHtml(plan.explanation)}</div>
    ${productCards ? `<p class="section-label">Product shortlist</p><div class="result-grid">${productCards}</div>` : ""}
    ${storeCards ? `<p class="section-label">Recommended suppliers</p><div class="result-grid">${storeCards}</div>` : ""}
    ${!productCards && !storeCards ? `<div class="empty-state"><div class="empty-mark">⌁</div><h3>No direct matches</h3><p>Try broader product terms or a different budget.</p></div>` : ""}
    <div class="handoff">
      <div class="handoff-mark">◇</div>
      <div><strong>Human approval required</strong><span>${escapeHtml(plan.humanNextStep)}</span></div>
    </div>
  `;
}

async function runPlan(query) {
  const trimmed = query.trim();
  if (trimmed.length < 3) return;
  requestInput.value = trimmed;
  planTitle.textContent = "Analyzing marketplace";
  resultCount.textContent = "Loading";
  planContent.innerHTML = '<div class="loading">Checking live DodoLink listings…</div>';
  try {
    const plan = await preparePurchasePlan({ query: trimmed, limit: 5 });
    renderPlan(plan);
  } catch (error) {
    resultCount.textContent = "Unavailable";
    planContent.innerHTML = `<div class="error">${escapeHtml(error.message || "The public marketplace could not be reached.")}</div>`;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void runPlan(requestInput.value);
});

document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => void runPlan(button.dataset.query || ""));
});

window.addEventListener(PLAN_EVENT, (event) => renderPlan(event.detail));

void registerWebMcpTools()
  .then(({ status: nextStatus }) => setStatus(nextStatus))
  .catch((error) => {
    console.error("WebMCP registration failed", error);
    setStatus("unavailable");
  });