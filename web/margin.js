/* Month-End Close Agent — Margin view: absorbed cost made visible, and
   actionable. Making a cost visible is only half the job; every figure on
   this page previously ended in a number with nothing attached to it. The
   recommendations block turns each one into a specific Stripe-side change,
   which is the whole argument for having the data in the warehouse and
   Stripe reachable as a tool. */

/* Ranked largest-saving-first. Each entry names the lever, not just the
   number, and carries the one Stripe call that would pull it. */
function buildMarginRecommendations(ctx) {
  const d = AppState.data;
  const recs = [];
  const mig = achMigrationOpportunity();

  if (mig) {
    recs.push({
      savingsLabel: `~${Fmt.moneyShort(mig.monthlySavingsCents)}/mo`,
      title: "Migrate card-paying residents to ACH",
      why: `${Fmt.int(mig.cardCharges)} rent payments a month arrive on card, averaging ${Fmt.money(mig.avgChargeCents)}. At the negotiated card rate that is ${Fmt.money(mig.cardFeePerChargeCents)} of fee per payment; the same payment on ACH costs ${Fmt.money(mig.achFeePerChargeCents)}, because the ACH cap binds far below rent-sized amounts. Rent is the rare category where ACH economics are overwhelming, which makes this the largest controllable line on the platform &mdash; but the ACH rate here is the unverified placeholder flagged in the assumptions panel, so treat the size as directional.`,
      action: {
        label: "Send ACH enrollment links",
        result: `Simulated: generated ACH enrollment links for the ${Fmt.int(mig.cardCharges)} card-paying leases via the Stripe MCP server and queued them behind the operator's existing resident-communication approval step.`,
      },
    });
  }

  const wcp = d.waiver_current_period;
  if (wcp.no_prior_failure_count) {
    const pct = (wcp.no_prior_failure_count / wcp.count) * 100;
    const attributable = Math.round(wcp.total_cents * (wcp.no_prior_failure_count / wcp.count));
    recs.push({
      savingsLabel: `~${Fmt.moneyShort(attributable)}/mo`,
      title: "Require a prior failed payment before a fee waiver",
      why: `${pct.toFixed(0)}% of this period's waivers went to residents who had never had a payment fail, so the waiver was doing convenience work rather than the recovery work it was designed for. That share, not the headline total, is the genuinely addressable part &mdash; the rest is arguably buying back a relationship.`,
      action: {
        label: "Draft eligibility rule",
        result: `Simulated: pulled the ${Fmt.int(wcp.no_prior_failure_count)} no-prior-failure waivers via the Stripe MCP server and drafted an eligibility rule gating waivers on a prior failed payment, routed to the fee-policy owner for approval.`,
      },
    });
  }

  const top = ctx.top5Entities[0];
  if (top) {
    recs.push({
      savingsLabel: `${Fmt.money(top.cents)}/mo`,
      title: `Review fee pass-through with ${top.name}`,
      why: `This single entity accounts for ${Fmt.money(top.cents)} of absorbed fees this period, the most of any in the portfolio. Concentration that high usually means one entity's residents pay by card far more than the portfolio average, which is an entity-level conversation rather than a platform-wide policy change.`,
      action: {
        label: "Pull entity fee breakdown",
        result: `Simulated: assembled a per-charge fee breakdown for ${top.name} via the Stripe MCP server and drafted a pass-through proposal for the entity's next statement review.`,
      },
    });
  }

  // Directly answers the "nobody currently tracks where" line on the ceiling
  // card, which previously had no follow-through at all.
  recs.push({
    savingsLabel: "measurement",
    title: "Instrument absorbed cost so it stops being an estimate",
    why: `The ceiling above is a bound, not a measurement: today's true absorbed cost sits somewhere between zero and it, and nothing currently records where. A recurring warehouse query on fee detail, joined to the waiver ledger, converts this page from an estimate into a tracked figure &mdash; which is also what makes the three items above measurable after the fact.`,
    action: {
      label: "Schedule a recurring fee query",
      result: `Simulated: scheduled a recurring query over the balance-transaction fee detail that Data Pipeline already lands in the warehouse, writing absorbed-fee totals per entity per month so this page reads a measured number instead of a modeled one. This one is a Data Pipeline job rather than an MCP call &mdash; the agent is scheduling a query, not touching the Stripe account.`,
    },
  });

  return recs;
}

function renderMargin() {
  const root = document.getElementById("view-margin");
  const d = AppState.data;
  if (!d) return;

  const wcp = d.waiver_current_period;
  const annualized = wcp.total_cents * 12;
  const fa = d.meta.fee_assumptions;
  const ceiling = d.margin_ceiling;

  const nsfExcs = d.exceptions.filter((e) => e.type === "nsf_after_payout");
  const nsfTotal = nsfExcs.reduce((s, e) => s + e.impact_cents, 0);
  const dupExcs = d.exceptions.filter((e) => e.type === "duplicate_payment");
  const dupTotal = dupExcs.reduce((s, e) => s + e.impact_cents, 0);
  const appfeeExcs = d.exceptions.filter((e) => e.type === "app_fee_misroute");
  const appfeeTotal = appfeeExcs.reduce((s, e) => s + e.impact_cents, 0);

  const byEntity = {};
  const byMarket = {};
  d.waivers.forEach((w) => {
    byEntity[w.entity_id] = (byEntity[w.entity_id] || 0) + w.fee_cents;
    byMarket[w.market] = (byMarket[w.market] || 0) + w.fee_cents;
  });
  const top5Entities = Object.entries(byEntity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, cents]) => ({ name: AppState.getEntity(id)?.name || id, cents }));
  const top5Markets = Object.entries(byMarket)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const noPriorPct = (wcp.no_prior_failure_count / wcp.count) * 100;

  const recs = buildMarginRecommendations({ top5Entities });

  root.innerHTML = `
    <div class="margin-top">
      <div class="card">
        <div class="headline-label">Card fees absorbed this period</div>
        <div class="headline-number">${Fmt.money(wcp.total_cents)}</div>
        <div class="headline-sub">${Fmt.int(wcp.count)} waivers, avg ${Fmt.money(wcp.total_cents / wcp.count)} each</div>
      </div>
      <div class="card">
        <div class="headline-label">Annualized (at current run-rate)</div>
        <div class="headline-number">${Fmt.moneyShort(annualized)}</div>
        <div class="headline-sub">Current month &times; 12, not a flat trailing-year average</div>
      </div>
    </div>

    <div class="card margin-ceiling-card">
      <div class="headline-label">Maximum exposure if all card fees were absorbed</div>
      <div class="margin-ceiling-figure">${Fmt.moneyShort(ceiling.ceiling_card_only_cents_month)}<span class="margin-ceiling-unit">/mo</span> &middot; ${Fmt.moneyShort(ceiling.ceiling_card_only_cents_year)}<span class="margin-ceiling-unit">/yr</span></div>
      <div class="headline-sub">Card fees only. Including wallets (priced as card): ${Fmt.moneyShort(ceiling.ceiling_with_wallet_cents_month)}/mo &middot; ${Fmt.moneyShort(ceiling.ceiling_with_wallet_cents_year)}/yr.</div>
      <div class="headline-sub">Today's actual absorbed cost sits between $0 and this ceiling &mdash; nobody currently tracks where.</div>
    </div>

    <div class="card rec-card">
      <div class="section-title" style="margin-top:0;">What to do about it</div>
      <div class="rec-card-sub">Every figure on this page has a lever behind it. These are ranked by how much they move, largest first.</div>
      <div class="briefing-recs">
        ${recs.map((r, i) => `
          <div class="rec-item" data-margin-rec="${i}">
            <div class="rec-top">
              <span class="rec-saving">${r.savingsLabel}</span>
              <span class="rec-title">${r.title}</span>
            </div>
            <div class="rec-why">${r.why}</div>
            <div class="agent-actions">
              <button class="agent-action-btn margin-rec-btn" data-margin-rec-index="${i}">${r.action.label}</button>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="briefing-disclosure">
        Each figure above is computed from this period's charge, fee, and waiver data &mdash; the kind of query <strong>Data Pipeline</strong> puts in a warehouse. The first three buttons are then work against the Stripe account, which is what the <strong>MCP server</strong> makes reachable; the fourth is a warehouse job rather than a Stripe call, and says so. Nothing here actually calls Stripe: the actions are simulated so the shape of the loop is visible without side effects.
      </div>
    </div>

    <div class="card chart-card">
      <div class="headline-label">Waivers per month, trailing 12 months</div>
      <div id="waiver-trend-chart"></div>
    </div>

    <div class="margin-grid">
      <div class="card">
        <div class="section-title" style="margin-top:0;">Secondary cost breakdown</div>
        <table>
          <thead><tr><th>Category</th><th class="num">Count</th><th class="num">Cost</th></tr></thead>
          <tbody>
            <tr><td>NSF returns after payout</td><td class="num">${nsfExcs.length}</td><td class="num">${Fmt.money(nsfTotal)}</td></tr>
            <tr><td>Duplicate payments</td><td class="num">${dupExcs.length}</td><td class="num">${Fmt.money(dupTotal)}</td></tr>
            <tr><td>Application fee misroutes</td><td class="num">${appfeeExcs.length}</td><td class="num">${Fmt.money(appfeeTotal)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0;">Top 5 entities by absorbed cost</div>
        <div class="top5-list">
          ${top5Entities.map((e) => `<div class="top5-row"><span>${e.name}</span><span>${Fmt.money(e.cents)}</span></div>`).join("")}
        </div>
      </div>
    </div>

    <div class="margin-grid" style="margin-top:20px;">
      <div class="card">
        <div class="section-title" style="margin-top:0;">Top 5 markets by absorbed cost</div>
        <div class="top5-list">
          ${top5Markets.map(([market, cents]) => `<div class="top5-row"><span>${market}</span><span>${Fmt.money(cents)}</span></div>`).join("")}
        </div>
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0;">Waiver usage pattern</div>
        <div class="headline-number" style="font-size:30px;">${Fmt.int(wcp.no_prior_failure_count)} <span style="font-size:16px; color:var(--text-faint);">of ${Fmt.int(wcp.count)}</span></div>
        <div class="callout">
          <strong>${noPriorPct.toFixed(0)}%</strong> of waivers this period were applied to residents with <strong>no prior payment failure</strong> &mdash; the waiver was likely used as a shortcut rather than a recovery tool.
        </div>
      </div>
    </div>

    <div class="margin-note">
      Fee assumptions: ${(fa.card_domestic_bps / 100).toFixed(2)}% + ${Fmt.money(fa.card_domestic_fixed_cents)} on domestic card, ${(fa.card_international_bps / 100).toFixed(2)}% + ${Fmt.money(fa.card_international_fixed_cents)} on international card (${(fa.card_international_share * 100).toFixed(0)}% of card volume, unverified), ${(fa.ach_bps / 100).toFixed(2)}% capped at ${Fmt.money(fa.ach_cap_cents)} on ACH (unverified). Wallets priced as card. Fee netted from the investor transfer before payout. ${fa.note}
    </div>
  `;

  root.querySelectorAll(".margin-rec-btn").forEach((btn) => {
    const rec = recs[Number(btn.dataset.marginRecIndex)];
    btn.addEventListener("click", () => simulateAgentAction(btn, rec.action.result, btn.closest(".rec-item")));
  });

  const chartPoints = d.waiver_history.map((h) => ({ label: h.month.slice(5), value: h.count }));
  renderLineChart("waiver-trend-chart", chartPoints, { formatY: (v) => Math.round(v) });
}
