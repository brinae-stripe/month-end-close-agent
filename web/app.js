/* Month-End Close Agent — shared app shell + state. Fully offline, static data only. */

const Fmt = {
  money(cents, opts) {
    opts = opts || {};
    const sign = cents < 0 && opts.sign !== false ? "-" : "";
    const abs = Math.abs(cents) / 100;
    const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}$${s}`;
  },
  moneyShort(cents) {
    const abs = Math.abs(cents) / 100;
    const sign = cents < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  },
  int(n) {
    return Number(n).toLocaleString("en-US");
  },
  pct(n, digits) {
    return `${n >= 0 ? "+" : ""}${n.toFixed(digits == null ? 1 : digits)}%`;
  },
  date(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  },
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const AppState = {
  data: null,
  exceptionStatus: {}, // exception id -> "open" | "approved" | "review"
  listeners: [],

  async load() {
    const res = await fetch("data/reconciliation.json");
    this.data = await res.json();
    this.data.exceptions.forEach((e) => {
      this.exceptionStatus[e.id] = "open";
    });
    return this.data;
  },

  onChange(fn) {
    this.listeners.push(fn);
  },

  notify() {
    this.listeners.forEach((fn) => fn());
  },

  setExceptionStatus(id, status) {
    this.exceptionStatus[id] = status;
    this.notify();
  },

  getOpenExceptions() {
    return this.data.exceptions
      .filter((e) => this.exceptionStatus[e.id] === "open")
      .slice()
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  },

  entityIsReconciled(entityId) {
    const entity = this.data.entities.find((e) => e.id === entityId);
    if (!entity || !entity.in_reconciliation_scope) return false;
    if (entity.exception_ids.length === 0) return true;
    return entity.exception_ids.every((id) => this.exceptionStatus[id] === "approved");
  },

  getActiveEntities() {
    return this.data.entities.filter((e) => e.in_reconciliation_scope);
  },

  getDormantEntities() {
    return this.data.entities.filter((e) => !e.in_reconciliation_scope);
  },

  getReconciledCount() {
    return this.getActiveEntities().filter((e) => this.entityIsReconciled(e.id)).length;
  },

  getEntity(id) {
    return this.data.entities.find((e) => e.id === id);
  },

  getEntityByName(name) {
    return this.data.entities.find((e) => e.name === name);
  },

  getCitation(id) {
    return this.data.citations[id];
  },
};

function renderAssumptionsPanel() {
  const root = document.getElementById("assumptions-panel");
  const assumptions = AppState.data.meta.assumptions || [];
  root.innerHTML = `
    <span class="assumptions-label">Assumptions on this screen:</span>
    ${assumptions.map((a) => `<span class="assumption-item">${a}</span>`).join("")}
  `;
}

function switchTab(view) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${view}`);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.view));
  });

  const data = await AppState.load();
  document.getElementById("model-month").textContent = `Reconciling ${data.meta.model_month_label} · ${data.meta.num_entities_active} active entities (${data.meta.num_entities_dormant} dormant) · as of ${Fmt.date(data.meta.today)}`;

  renderAssumptionsPanel();
  renderClose();
  renderAsk();
  renderMargin();
  renderResidents();

  AppState.onChange(() => {
    renderClose();
  });
});
