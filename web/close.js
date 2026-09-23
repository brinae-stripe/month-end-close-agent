/* Month-End Close Agent — Close view: month-end reconciliation board.

   Each exception already carries a computed `disposition` — the proposed
   resolution. The MCP action below is the other half of that: the specific
   Stripe call that would carry the disposition out. Approve/Send to review
   stay separate on purpose, so executing the mechanical fix and signing off
   on the reconciliation remain two decisions rather than one. */

let closeFilterText = "";

/* The Stripe-side fix for each exception type. Keyed off exc.type so a new
   exception type in the generator fails loudly here (no action rendered)
   rather than silently getting a generic button that claims to fix it. */
function exceptionMcpAction(exc) {
  const amount = Fmt.money(Math.abs(exc.impact_cents));
  switch (exc.type) {
    case "payout_failed":
      return exc.unrecoverable_by_deadline
        ? {
            label: "Escalate for manual funding",
            result: `Simulated: read the returned payout and its failure reason for ${exc.entity_name} out of Stripe and drafted a funding request for the operator's own treasury team. Reinitiating would not clear by the 10th, so this deliberately skips the retry path. Note that the Stripe call here is only the read &mdash; funding an investor off the payout path is a human decision.`,
          }
        : {
            label: "Reinitiate payout",
            result: `Simulated: re-created the returned payout for ${exc.entity_name} against verified bank details via the Stripe MCP server.`,
          };
    case "nsf_after_payout":
      return {
        label: "Retry debit + net",
        result: `Simulated: re-presented the returned ACH debit via the Stripe MCP server and scheduled the unrecovered ${amount} to net against ${exc.entity_name}'s next payout, rather than a manual journal entry.`,
      };
    case "stale_mapping":
      return {
        label: "Fix mapping",
        result: `Simulated: repointed the property to ${exc.entity_name}'s connected account via the Stripe MCP server and transferred the misrouted ${amount} across from ${exc.counterparty_entity_name}. This also stops the exception recurring next month.`,
      };
    case "app_fee_misroute":
      return {
        label: "Reverse app fee",
        result: `Simulated: reversed the misrouted application fee via the Stripe MCP server, returning ${amount} to ${exc.entity_name}.`,
      };
    case "short_payment":
      return {
        label: "Invoice shortfall",
        result: `Simulated: created a ${amount} balance-due invoice on the short-paid lease via the Stripe MCP server. ${exc.entity_name}'s statement is left unadjusted per the standard disposition.`,
      };
    case "duplicate_payment":
      return {
        label: "Refund duplicate",
        result: `Simulated: refunded the duplicate ${amount} charge via the Stripe MCP server, leaving the original payment to ${exc.entity_name} untouched.`,
      };
    default:
      return null;
  }
}

function renderClose() {
  const root = document.getElementById("view-close");
  const d = AppState.data;
  if (!d) return;

  const openExceptions = AppState.getOpenExceptions();
  const reconciledCount = AppState.getReconciledCount();
  const totalEntities = d.meta.num_entities_active;
  const unrecoverable = AppState.getActiveEntities().filter((e) => e.funding_risk === "unrecoverable");

  root.innerHTML = `
    <div class="close-header">
      <div class="card countdown-card">
        <div class="headline-label">Countdown to the 10th</div>
        <div class="countdown-days">${d.meta.days_remaining} day${d.meta.days_remaining === 1 ? "" : "s"}</div>
        <div class="headline-sub">Every investor entity must be fully funded by ${Fmt.date(d.meta.target_day)}.</div>
        <div class="headline-sub">Last day to initiate a payout and still land by the 10th: <strong>${Fmt.date(d.meta.initiate_cutoff)}</strong> (T+2 settlement).</div>
        ${unrecoverable.length ? `<div class="headline-sub text-blocked">${unrecoverable.length} entit${unrecoverable.length === 1 ? "y" : "ies"} flagged unrecoverable by deadline &mdash; won't clear by the 10th even if fixed today.</div>` : ""}
      </div>
      <div class="card" style="flex:1;">
        <div class="headline-label">Reconciliation status</div>
        <div class="headline-number">${reconciledCount} <span style="color:var(--text-faint); font-weight:500; font-size:28px;">of ${totalEntities} entities reconciled</span></div>
        <div class="headline-sub">${openExceptions.length} open exception${openExceptions.length === 1 ? "" : "s"} remaining in the queue.</div>
      </div>
    </div>

    <div class="summary-strip">
      <div class="card">
        <div class="headline-label">Total collected</div>
        <div class="headline-number">${Fmt.moneyShort(d.totals.total_collected_cents)}</div>
      </div>
      <div class="card">
        <div class="headline-label">Settled to investors</div>
        <div class="headline-number">${Fmt.moneyShort(d.totals.total_settled_cents)}</div>
      </div>
      <div class="card">
        <div class="headline-label">Still in flight</div>
        <div class="headline-number">${Fmt.moneyShort(d.totals.total_in_flight_cents)}</div>
      </div>
      <div class="card">
        <div class="headline-label">Entities reconciled</div>
        <div class="headline-number">${reconciledCount} <span style="font-size:20px; color:var(--text-faint);">/ ${totalEntities}</span></div>
      </div>
    </div>

    <div class="section-title">Exception queue</div>
    <div class="callout" style="margin-top:0; margin-bottom:16px;">
      Each exception carries the specific fix for its type. Those are <strong>simulated</strong> Stripe calls &mdash; the kind the <strong>MCP server</strong> makes reachable to an agent &mdash; and they stay separate from Approve on purpose: carrying out the mechanical fix and signing off on the reconciliation are two different decisions.
    </div>
    <div class="exception-queue" id="exception-queue">
      ${openExceptions.length ? openExceptions.map(exceptionCardHtml).join("") : `<div class="empty-queue">All exceptions cleared.</div>`}
    </div>

    <div class="section-title">Entities</div>
    <div class="entity-filter">
      <input type="text" id="entity-filter-input" placeholder="Filter by entity or market&hellip;" value="${escapeHtml(closeFilterText)}">
    </div>
    <div id="entity-table-wrap"></div>
  `;

  root.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleExceptionAction(btn.dataset.excId, "approved"));
  });
  root.querySelectorAll(".review-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleExceptionAction(btn.dataset.excId, "review"));
  });
  root.querySelectorAll(".mcp-fix-btn").forEach((btn) => {
    const exc = d.exceptions.find((e) => e.id === btn.dataset.excId);
    const mcp = exceptionMcpAction(exc);
    btn.addEventListener("click", () => simulateAgentAction(
      btn,
      `${mcp.result} <em>Still needs your approval.</em>`,
      btn.closest(".exception-card").querySelector(".exception-body")
    ));
  });

  const filterInput = document.getElementById("entity-filter-input");
  filterInput.addEventListener("input", (e) => {
    closeFilterText = e.target.value;
    renderEntityTable();
  });

  renderEntityTable();
}

function exceptionCardHtml(exc) {
  const mcp = exceptionMcpAction(exc);
  const impactClass = exc.impact_direction === "blocked" ? "text-blocked" : `text-${exc.impact_direction}`;
  const impactLabel = exc.impact_direction === "blocked" ? "blocked" : exc.impact_direction === "over" ? "over-funded" : "under-funded";
  const entityLabel = exc.counterparty_entity_name
    ? `${exc.entity_name} &harr; ${exc.counterparty_entity_name}`
    : exc.entity_name;
  return `
    <div class="exception-card sev-${exc.severity}" data-exc-id="${exc.id}">
      <div class="exception-body">
        <div class="exception-top">
          <span class="pill pill-${exc.severity}">${exc.severity}</span>
          ${exc.unrecoverable_by_deadline ? `<span class="pill pill-unrecoverable">unrecoverable by deadline</span>` : ""}
          <span class="exception-entity">${entityLabel}</span>
          <span class="exception-impact ${impactClass}">${Fmt.money(exc.impact_cents)} ${impactLabel}</span>
        </div>
        <div class="exception-explain">${exc.explanation}</div>
        <div class="exception-disposition">Proposed: ${exc.disposition}</div>
        <div class="exception-citations">Sources: ${exc.citations.join(", ")}</div>
      </div>
      <div class="exception-actions">
        ${mcp ? `<button class="agent-action-btn mcp-fix-btn" data-exc-id="${exc.id}">${mcp.label}</button>` : ""}
        <button class="action-btn approve approve-btn" data-exc-id="${exc.id}">Approve</button>
        <button class="action-btn review-btn" data-exc-id="${exc.id}">Send to review</button>
      </div>
    </div>
  `;
}

function handleExceptionAction(excId, newStatus) {
  const cardEl = document.querySelector(`.exception-card[data-exc-id="${excId}"]`);
  if (cardEl) {
    cardEl.classList.add("removing");
  }
  setTimeout(() => {
    AppState.setExceptionStatus(excId, newStatus);
  }, 300);
}

function renderEntityTable() {
  const wrap = document.getElementById("entity-table-wrap");
  if (!wrap) return;
  const d = AppState.data;
  const filter = closeFilterText.trim().toLowerCase();

  const matches = (e) => !filter || e.name.toLowerCase().includes(filter) || e.market.toLowerCase().includes(filter);

  const activeRows = d.entities
    .filter((e) => e.in_reconciliation_scope && matches(e))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      const reconciled = AppState.entityIsReconciled(e.id);
      const flagged = !reconciled;
      const varianceClass = e.variance_cents === 0 ? "" : e.variance_cents < 0 ? "text-under" : "text-over";
      const statusPill = e.funding_risk === "unrecoverable"
        ? `<span class="pill pill-unrecoverable">unrecoverable</span>`
        : e.payout_status === "failed"
          ? `<span class="pill pill-critical">payout failed</span>`
          : reconciled
            ? `<span class="pill pill-good">reconciled</span>`
            : `<span class="pill pill-medium">exception open</span>`;
      return `
        <tr class="${flagged ? "row-flagged" : ""}">
          <td>${e.name}</td>
          <td>${e.market}</td>
          <td class="num">${Fmt.int(e.home_count)}</td>
          <td class="num">${Fmt.money(e.expected_rent_cents)}</td>
          <td class="num">${Fmt.money(e.collected_cents)}</td>
          <td class="num">${Fmt.money(e.fee_cents)}</td>
          <td class="num">${Fmt.money(e.settled_cents)}</td>
          <td class="num ${varianceClass}">${Fmt.money(e.variance_cents)}</td>
          <td>${statusPill}</td>
        </tr>
      `;
    })
    .join("");

  const dormantEntities = d.entities.filter((e) => !e.in_reconciliation_scope && matches(e));
  const dormantRows = dormantEntities
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `
      <tr class="row-dormant">
        <td>${e.name}</td>
        <td>${e.market}</td>
        <td class="num">${Fmt.int(e.home_count)}</td>
        <td class="num">&mdash;</td>
        <td class="num">&mdash;</td>
        <td class="num">&mdash;</td>
        <td class="num">&mdash;</td>
        <td class="num">&mdash;</td>
        <td><span class="pill pill-dormant">dormant &middot; out of scope</span></td>
      </tr>
    `)
    .join("");

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Entity</th>
          <th>Market</th>
          <th class="num">Homes</th>
          <th class="num">Expected</th>
          <th class="num">Collected</th>
          <th class="num">Fee</th>
          <th class="num">Settled</th>
          <th class="num">Variance</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${activeRows}</tbody>
    </table>
    ${dormantEntities.length ? `
      <div class="section-title" style="margin-top:24px;">Dormant accounts (${dormantEntities.length}, out of reconciliation scope)</div>
      <table>
        <thead>
          <tr>
            <th>Entity</th>
            <th>Market</th>
            <th class="num">Homes</th>
            <th class="num">Expected</th>
            <th class="num">Collected</th>
            <th class="num">Fee</th>
            <th class="num">Settled</th>
            <th class="num">Variance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${dormantRows}</tbody>
      </table>
    ` : ""}
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
