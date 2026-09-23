/* Month-End Close Agent — Residents view: tenant/lease stats.
   Every figure here is computed from fields that map to a real Stripe/Sigma
   table (see generate_data.py header for the mapping): subscriptions,
   customers, invoices, charges, refunds, invoice_items,
   subscription_item_change_events, and disputes.

   The "Rule-Based Risk Flags" panel is a small rule-based scoring pass over
   that same data, run in the browser at render time. Like the Ask view, it
   is explicitly NOT a language model and makes no network call — it is a
   deterministic point-scoring function over payment history, disclosed here
   so nothing on screen implies more intelligence than it has. The
   "recommended action" per flag is likewise scripted, not generated — it
   exists to sketch what a Stripe-connected agent could do next (send a
   reminder, retry a debit, escalate a dispute) via the Stripe MCP server,
   the same way the Investor view's agent actions do. Clicking a button here
   only simulates that outcome; no real Stripe call is made. */

const METHOD_LABEL = { ach: "ACH", card: "CC", wallet: "digital wallet" };

/* Reduce a resident's payment history to the small set of boolean conditions
   the flags and the recommended actions both read from. Deriving both from
   one place is what keeps them from contradicting each other — an earlier
   version scored "failed payment" and "has a credit balance" independently
   and then recommended retrying a debit for money the operator was already
   holding. */
function residentConditions(r) {
  const history = r.payment_history;
  const months = history.length;
  const lateCount = history.filter((h) => h.status === "late").length;
  const failedCount = history.filter((h) => h.status === "failed").length;

  // Arrears is about the most recent month only. A return five months ago
  // that was later cured is history; a return last month is money owed now.
  const inArrears = history[months - 1].status === "failed";

  return {
    months,
    lateCount,
    failedCount,
    inArrears,
    curedFailures: inArrears ? failedCount - 1 : failedCount,
    chronicLate: lateCount >= 3,
    hasCredit: r.overpayment_cents > 0,
    absorbedFee: r.payment_method_type === "card" || r.payment_method_type === "wallet",
    isCurrent: r.lease_status !== "vacated",
    disputed: r.disputed,
  };
}

/* Risk score counts only things that actually put rent at risk. A credit
   balance and an absorbed card fee are surfaced as separate, non-scoring
   observations — they are operator-side cleanup and margin items, not
   evidence that this resident is a collection risk. */
function scoreResident(r) {
  const c = residentConditions(r);

  let score = 0;
  const flags = [];

  if (c.inArrears) {
    score += 6;
    flags.push("failed/NSF payment last month (in arrears)");
  }
  if (c.curedFailures > 0) {
    score += 2 * c.curedFailures;
    flags.push(`${c.curedFailures} earlier failed/NSF payment${c.curedFailures === 1 ? "" : "s"} (since cured)`);
  }
  if (c.lateCount > 0) {
    score += 2 * c.lateCount;
    flags.push(`${c.lateCount} late payment${c.lateCount === 1 ? "" : "s"} over last ${c.months} mos`);
  }
  if (c.disputed) {
    score += 3;
    flags.push("open dispute on a rent charge");
  }

  const notes = [];
  if (c.hasCredit) notes.push(`has overpaid (${Fmt.money(r.overpayment_cents)} credit unapplied)`);
  if (c.absorbedFee) notes.push(`pays with ${METHOD_LABEL[r.payment_method_type]} (fees absorbed)`);

  const tier = score >= 8 ? "high" : score >= 4 ? "medium" : "low";
  return { score, tier, flags, notes, c };
}

/* One action per condition that fires, ordered by what an operator would
   actually do first. The ordering matters: collect what is owed, then clear
   unapplied credit, then fix the underlying payment behavior, then address
   the fee rail. */
function recommendResidentActions(r, s) {
  const c = s.c;
  const actions = [];

  if (c.disputed) {
    actions.push({
      label: "Escalate dispute via Stripe MCP",
      result: `Simulated: pulled the disputed charge and its evidence for lease ${r.lease_id} via the Stripe MCP server and opened a review task for a human to submit a response.`,
    });
  }

  if (c.inArrears) {
    // By construction a resident in arrears holds no credit balance, so
    // retrying is never competing with money already on hand.
    actions.push(
      r.payment_method_type === "ach"
        ? {
            label: "Retry ACH debit via Stripe MCP",
            result: `Simulated: re-presented the returned ACH debit for lease ${r.lease_id} through the Stripe MCP server and queued a notice to the resident that the payment is being retried.`,
          }
        : {
            label: "Retry card charge via Stripe MCP",
            result: `Simulated: retried the declined card charge for lease ${r.lease_id} through the Stripe MCP server and queued a notice to the resident.`,
          }
    );
  }

  if (c.hasCredit) {
    actions.push(
      c.isCurrent
        ? {
            label: "Apply credit to next invoice via Stripe MCP",
            result: `Simulated: applied the ${Fmt.money(r.overpayment_cents)} credit on lease ${r.lease_id} to next month's rent invoice via the Stripe MCP server, so it stops sitting unapplied on the resident's balance.`,
          }
        : {
            label: "Refund credit with deposit via Stripe MCP",
            result: `Simulated: added the ${Fmt.money(r.overpayment_cents)} unapplied credit on lease ${r.lease_id} to the move-out deposit refund via the Stripe MCP server, rather than leaving it stranded after the lease ended.`,
          }
    );
  }

  // Chronic lateness is a behavior problem, so the fix is autopay rather
  // than another one-off reminder. A single late month just gets a nudge.
  if (c.chronicLate && !c.inArrears) {
    actions.push({
      label: "Offer autopay enrollment via Stripe MCP",
      result: `Simulated: sent an autopay enrollment link for lease ${r.lease_id} via the Stripe MCP server, targeting the recurring lateness rather than chasing each month individually.`,
    });
  } else if (c.lateCount > 0 && !c.inArrears) {
    actions.push({
      label: "Send payment reminder via Stripe MCP",
      result: `Simulated: sent a rent-due reminder ahead of next month's invoice for lease ${r.lease_id} via the Stripe MCP server.`,
    });
  }

  // Only worth proposing for a resident who is still in place.
  if (c.absorbedFee && c.isCurrent) {
    actions.push({
      label: "Offer ACH enrollment via Stripe MCP",
      result: `Simulated: sent an ACH enrollment link for lease ${r.lease_id} via the Stripe MCP server, moving ${Fmt.money(r.monthly_rent_cents)}/mo off the absorbed card fee.`,
    });
  }

  return actions;
}

function renderResidents() {
  const root = document.getElementById("view-residents");
  const d = AppState.data;
  if (!d) return;

  const residents = d.residents;
  const scored = residents.map((r) => ({ r, s: scoreResident(r) }));

  const allPayments = residents.flatMap((r) => r.payment_history);
  const totalPayments = allPayments.length;
  const onTimeCount = allPayments.filter((p) => p.status === "on_time").length;
  const lateCount = allPayments.filter((p) => p.status === "late").length;
  const failedCount = allPayments.filter((p) => p.status === "failed").length;
  const onTimeRate = (onTimeCount / totalPayments) * 100;
  const nsfRate = (failedCount / totalPayments) * 100;
  const lateDaysAvg = allPayments.filter((p) => p.status === "late").reduce((s, p) => s + p.days_late, 0) / Math.max(1, lateCount);

  const eligibleForRenewal = residents.filter((r) => r.tenure_months >= 12);
  const renewed = residents.filter((r) => r.lease_status === "renewed");
  const renewalRate = (renewed.length / Math.max(1, eligibleForRenewal.length)) * 100;
  const avgRentIncrease = renewed.length
    ? (renewed.reduce((s, r) => s + r.rent_increase_pct, 0) / renewed.length) * 100
    : 0;

  const vacated = residents.filter((r) => r.lease_status === "vacated");
  const turnoverRate = (vacated.length / residents.length) * 100;
  const depositsHeld = residents.filter((r) => r.security_deposit_refunded_cents == null);
  const depositsHeldTotal = depositsHeld.reduce((s, r) => s + r.security_deposit_cents, 0);
  const depositsRefundedTotal = vacated.reduce((s, r) => s + (r.security_deposit_refunded_cents || 0), 0);
  const depositsWithheldTotal = vacated.reduce((s, r) => s + (r.security_deposit_cents - (r.security_deposit_refunded_cents || 0)), 0);
  const avgRefundPct = vacated.length
    ? (vacated.reduce((s, r) => s + (r.security_deposit_refunded_cents || 0) / r.security_deposit_cents, 0) / vacated.length) * 100
    : 0;

  const disputedCount = residents.filter((r) => r.disputed).length;
  const disputeRate = (disputedCount / residents.length) * 100;

  const methods = ["ach", "card", "wallet"];
  const byMethod = methods.map((method) => {
    const subset = residents.filter((r) => r.payment_method_type === method);
    const pays = subset.flatMap((r) => r.payment_history);
    const onTime = pays.filter((p) => p.status === "on_time").length;
    const failed = pays.filter((p) => p.status === "failed").length;
    return {
      method,
      residentCount: subset.length,
      onTimeRate: pays.length ? (onTime / pays.length) * 100 : 0,
      nsfRate: pays.length ? (failed / pays.length) * 100 : 0,
    };
  });

  const monthMap = {};
  allPayments.forEach((p) => {
    monthMap[p.month] = monthMap[p.month] || { onTime: 0, total: 0 };
    monthMap[p.month].total += 1;
    if (p.status === "on_time") monthMap[p.month].onTime += 1;
  });
  const monthLabels = Object.keys(monthMap).sort();
  const chartPoints = monthLabels.map((m) => ({
    label: m.slice(5),
    value: (monthMap[m].onTime / monthMap[m].total) * 100,
  }));

  // The queue is scoped to leases still in place. A resident who has moved
  // out cannot be enrolled in autopay or reminded about next month's rent,
  // so listing them here would only produce actions nobody can take; their
  // loose ends are deposit and credit disposition, handled above.
  const flagged = scored
    .filter((x) => x.s.tier !== "low" && x.s.c.isCurrent)
    .sort((a, b) => b.s.score - a.s.score)
    .slice(0, 12);

  const arrearsCount = scored.filter((x) => x.s.c.inArrears && x.s.c.isCurrent).length;
  const creditResidents = residents.filter((r) => r.overpayment_cents > 0);
  const creditTotal = creditResidents.reduce((s, r) => s + r.overpayment_cents, 0);
  const moveOutCredits = creditResidents.filter((r) => r.lease_status === "vacated");
  const moveOutCreditTotal = moveOutCredits.reduce((s, r) => s + r.overpayment_cents, 0);

  root.innerHTML = `
    <div class="summary-strip">
      <div class="card">
        <div class="headline-label">On-time rent payment rate</div>
        <div class="headline-number">${onTimeRate.toFixed(1)}%</div>
        <div class="headline-sub">${Fmt.int(onTimeCount)} of ${Fmt.int(totalPayments)} sampled lease-months</div>
      </div>
      <div class="card">
        <div class="headline-label">Avg days late (when late)</div>
        <div class="headline-number">${lateDaysAvg.toFixed(1)}</div>
        <div class="headline-sub">${Fmt.int(lateCount)} late payments across the sample</div>
      </div>
      <div class="card">
        <div class="headline-label">NSF / failed rent rate</div>
        <div class="headline-number">${nsfRate.toFixed(1)}%</div>
        <div class="headline-sub">${Fmt.int(failedCount)} failed rent charges &middot; ${Fmt.int(arrearsCount)} leases in arrears right now</div>
      </div>
      <div class="card">
        <div class="headline-label">Lease renewal rate</div>
        <div class="headline-number">${renewalRate.toFixed(0)}%</div>
        <div class="headline-sub">Avg rent increase at renewal: ${avgRentIncrease.toFixed(1)}%</div>
      </div>
    </div>

    <div class="card chart-card">
      <div class="headline-label">Portfolio on-time payment rate, trailing months</div>
      <div id="ontime-trend-chart"></div>
    </div>

    <div class="margin-grid">
      <div class="card">
        <div class="section-title" style="margin-top:0;">Security deposits</div>
        <table>
          <thead><tr><th>Status</th><th class="num">Amount</th></tr></thead>
          <tbody>
            <tr><td>Currently held (leases in place)</td><td class="num">${Fmt.money(depositsHeldTotal)}</td></tr>
            <tr><td>Refunded at move-out</td><td class="num">${Fmt.money(depositsRefundedTotal)}</td></tr>
            <tr><td>Withheld for deductions</td><td class="num">${Fmt.money(depositsWithheldTotal)}</td></tr>
          </tbody>
        </table>
        <div class="headline-sub" style="margin-top:10px;">Avg refunded at move-out: ${avgRefundPct.toFixed(0)}% of deposit &middot; portfolio turnover: ${turnoverRate.toFixed(1)}%</div>
        <div class="headline-sub" style="margin-top:6px;">Separately, ${Fmt.money(creditTotal)} sits as unapplied resident credit across ${creditResidents.length} leases &mdash; resident money held, same as a deposit.</div>
        ${moveOutCredits.length ? `
        <div class="headline-sub" style="margin-top:10px;">
          ${moveOutCredits.length} ended lease${moveOutCredits.length === 1 ? "" : "s"} still carrying an unapplied credit balance totalling ${Fmt.money(moveOutCreditTotal)} &mdash; owed back, not withheld.
        </div>
        <div class="agent-actions">
          <button class="agent-action-btn" id="moveout-credit-action">Sweep ${moveOutCredits.length} move-out credit${moveOutCredits.length === 1 ? "" : "s"} via Stripe MCP</button>
        </div>` : ""}
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0;">Timeliness by payment method</div>
        <table>
          <thead><tr><th>Method</th><th class="num">Residents</th><th class="num">On-time rate</th><th class="num">NSF rate</th></tr></thead>
          <tbody>
            ${byMethod.map((m) => `<tr>
              <td>${m.method.toUpperCase()}</td>
              <td class="num">${Fmt.int(m.residentCount)}</td>
              <td class="num">${m.onTimeRate.toFixed(1)}%</td>
              <td class="num">${m.nsfRate.toFixed(1)}%</td>
            </tr>`).join("")}
          </tbody>
        </table>
        <div class="headline-sub" style="margin-top:10px;">Rent charge dispute rate: ${disputeRate.toFixed(1)}% of sampled leases</div>
      </div>
    </div>

    <div class="section-title">Rule-Based Risk Flags</div>
    <div class="callout" style="margin-top:0; margin-bottom:16px;">
      This panel is a deterministic point-scoring pass over the payment history above, run in your browser. It is <strong>not</strong> a language model and makes no network call; it flags patterns worth a human look, the same way the Ask view's answers are computed rather than generated. The subject of each card is the resident's lease, not the property-owner entity, which is shown only as context. Only <strong>arrears, lateness, and disputes score</strong>; a credit balance or an absorbed card fee is listed separately as an <em>also noted</em> observation, because those are operator-side cleanup and margin items rather than evidence the resident is a collection risk. Each action is <strong>simulated</strong> &mdash; it illustrates what a Stripe MCP-connected agent could trigger next, not a real Stripe call.
    </div>
    <div class="risk-flag-list" id="risk-flag-list">
      ${flagged.length ? flagged.map(({ r, s }, i) => {
        const actions = recommendResidentActions(r, s);
        return `
        <div class="risk-flag-card tier-${s.tier}">
          <div class="risk-flag-top">
            <span class="pill pill-${s.tier === "high" ? "critical" : s.tier === "medium" ? "medium" : "low"}">${s.tier} risk</span>
            <span class="risk-flag-entity">Resident ${r.resident_first_name} &middot; lease under ${r.entity_name}, ${r.market}</span>
            <span class="risk-flag-rent">${Fmt.money(r.monthly_rent_cents)}/mo &middot; ${r.payment_method_type.toUpperCase()}</span>
          </div>
          <div class="risk-flag-reasons">${s.flags.join(", ")}.</div>
          ${s.notes.length ? `<div class="risk-flag-notes">Also noted: ${s.notes.join(", ")}.</div>` : ""}
          <div class="agent-actions">
            ${actions.map((a, j) => `<button class="agent-action-btn" data-risk-index="${i}" data-action-index="${j}">${a.label}</button>`).join("")}
          </div>
        </div>
      `;
      }).join("") : `<div class="empty-queue">No leases in place scored above the low-risk threshold.</div>`}
    </div>
  `;

  root.querySelectorAll("[data-risk-index]").forEach((btn) => {
    const { r, s } = flagged[Number(btn.dataset.riskIndex)];
    const action = recommendResidentActions(r, s)[Number(btn.dataset.actionIndex)];
    btn.addEventListener("click", () => simulateAgentAction(btn, action.result, btn.closest(".risk-flag-card")));
  });

  const sweepBtn = document.getElementById("moveout-credit-action");
  if (sweepBtn) {
    sweepBtn.addEventListener("click", () => simulateAgentAction(
      sweepBtn,
      `Simulated: queued refunds for all ${moveOutCredits.length} unapplied move-out credit balances (${Fmt.money(moveOutCreditTotal)} total) via the Stripe MCP server, attaching each to its lease's deposit disposition.`,
      sweepBtn.closest(".card")
    ));
  }

  renderLineChart("ontime-trend-chart", chartPoints, { formatY: (v) => `${Math.round(v)}%` });
}
