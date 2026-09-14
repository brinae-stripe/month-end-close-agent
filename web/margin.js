/* Month-End Close Agent — Margin view: absorbed cost made visible. */

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

  const chartPoints = d.waiver_history.map((h) => ({ label: h.month.slice(5), value: h.count }));
  renderLineChart("waiver-trend-chart", chartPoints, { formatY: (v) => Math.round(v) });
}
