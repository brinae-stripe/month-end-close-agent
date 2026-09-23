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

function recommendResidentAction(r, s) {
  if (r.disputed) {
    return {
      label: "Escalate dispute via Stripe MCP",
      result: `Simulated: opened a dispute-review task for lease ${r.lease_id} and pulled the underlying charge and evidence via the Stripe MCP server for a human to submit.`,
    };
  }
  if (s.recentFailed > 0 && r.payment_method_type === "ach") {
    return {
      label: "Retry ACH debit via Stripe MCP",
      result: `Simulated: queued a retry of the failed ACH debit for lease ${r.lease_id} through the Stripe MCP server and drafted a resident notification.`,
    };
  }
  if (s.recentFailed > 0) {
    return {
      label: "Retry payment via Stripe MCP",
      result: `Simulated: queued a retry of the failed charge for lease ${r.lease_id} through the Stripe MCP server.`,
    };
  }
  return {
    label: "Send payment reminder via Stripe MCP",
    result: `Simulated: sent a rent-due reminder to the resident on lease ${r.lease_id} via the Stripe MCP server, referencing their late-payment history.`,
  };
}

function scoreResident(r) {
  const recentLate = r.payment_history.filter((h) => h.status === "late").length;
  const recentFailed = r.payment_history.filter((h) => h.status === "failed").length;

  let score = 0;
  const reasons = [];

  if (recentLate > 0) {
    score += 2 * recentLate;
    reasons.push(`${recentLate} late rent payment${recentLate === 1 ? "" : "s"} in the trailing ${r.payment_history.length} months`);
  }
  if (recentFailed > 0) {
    score += 4 * recentFailed;
    reasons.push(`${recentFailed} failed/NSF rent payment${recentFailed === 1 ? "" : "s"}`);
  }
  if (r.disputed) {
    score += 3;
    reasons.push("an open dispute on a rent charge");
  }
  if (r.payment_method_type === "ach" && recentFailed > 0) {
    score += 2;
    reasons.push("ACH as the payment method, which correlates with return risk once a failure has occurred");
  }

  const tier = score >= 8 ? "high" : score >= 4 ? "medium" : "low";
  return { score, tier, reasons, recentLate, recentFailed };
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

  const flagged = scored
    .filter((x) => x.s.tier !== "low")
    .sort((a, b) => b.s.score - a.s.score)
    .slice(0, 12);

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
        <div class="headline-sub">${Fmt.int(failedCount)} failed rent charges</div>
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
            <tr><td>Currently held (active leases)</td><td class="num">${Fmt.money(depositsHeldTotal)}</td></tr>
            <tr><td>Refunded at move-out</td><td class="num">${Fmt.money(depositsRefundedTotal)}</td></tr>
            <tr><td>Withheld for deductions</td><td class="num">${Fmt.money(depositsWithheldTotal)}</td></tr>
          </tbody>
        </table>
        <div class="headline-sub" style="margin-top:10px;">Avg refunded at move-out: ${avgRefundPct.toFixed(0)}% of deposit &middot; portfolio turnover: ${turnoverRate.toFixed(1)}%</div>
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
      This panel is a deterministic point-scoring pass over the payment history above &mdash; late/failed payment counts, an open dispute flag, and payment method &mdash; run in your browser. It is <strong>not</strong> a language model and makes no network call; it flags patterns worth a human look, the same way the Ask view's answers are computed rather than generated. The subject of each card is the resident's lease, not the property-owner entity, which is shown only as context. Each card's action button is <strong>simulated</strong> &mdash; it illustrates what a Stripe MCP-connected agent could trigger next, not a real Stripe call.
    </div>
    <div class="risk-flag-list" id="risk-flag-list">
      ${flagged.length ? flagged.map(({ r, s }, i) => {
        const action = recommendResidentAction(r, s);
        return `
        <div class="risk-flag-card tier-${s.tier}">
          <div class="risk-flag-top">
            <span class="pill pill-${s.tier === "high" ? "critical" : s.tier === "medium" ? "medium" : "low"}">${s.tier} risk</span>
            <span class="risk-flag-entity">Resident ${r.resident_id} &middot; lease under ${r.entity_name}, ${r.market}</span>
            <span class="risk-flag-rent">${Fmt.money(r.monthly_rent_cents)}/mo &middot; ${r.payment_method_type.toUpperCase()}</span>
          </div>
          <div class="risk-flag-reasons">Flagged for: ${s.reasons.join("; ")}.</div>
          <div class="agent-actions">
            <button class="agent-action-btn" data-risk-action="${i}">${action.label}</button>
          </div>
        </div>
      `;
      }).join("") : `<div class="empty-queue">No residents in this sample scored above the low-risk threshold.</div>`}
    </div>
  `;

  root.querySelectorAll("[data-risk-action]").forEach((btn) => {
    const { r, s } = flagged[Number(btn.dataset.riskAction)];
    const action = recommendResidentAction(r, s);
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Done";
      btn.classList.add("done");

      const card = btn.closest(".risk-flag-card");
      const resultBubble = document.createElement("div");
      resultBubble.className = "msg-agent-result";
      resultBubble.style.marginTop = "8px";
      resultBubble.style.opacity = "0";
      resultBubble.innerHTML = `<span class="agent-result-icon">&#9889;</span> ${action.result}`;
      card.appendChild(resultBubble);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resultBubble.style.transition = "opacity 0.3s ease";
          resultBubble.style.opacity = "1";
        });
      });
    });
  });

  renderLineChart("ontime-trend-chart", chartPoints, { formatY: (v) => `${Math.round(v)}%` });
}
