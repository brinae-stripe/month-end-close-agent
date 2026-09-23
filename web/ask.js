/* Month-End Close Agent — Ask view, and the landing surface for the whole app.
   Scripted, not generative: answers are computed at render time from the same
   JSON the other views use, so numbers always agree.

   This view opens with a proactive briefing rather than an empty thread. The
   point of the demo is that once Stripe data lands in the warehouse (Data
   Pipeline) and Stripe is reachable as a tool (MCP server), the close stops
   being a hunt through dashboards: the agent arrives already knowing what is
   wrong and what it would do about it. The briefing is the "already knowing"
   half; the action buttons are the "what it would do" half. Both are
   deterministic and disclosed as such. */

const ASK_QUESTIONS = [
  "Which investor entities are at risk of missing the 10th?",
  "Why is Cedar Row Assets 3 short this month?",
  "How much did we absorb in waived card fees this period?",
  "Show me every NSF return that landed after payout.",
  "How does collection this month compare to last month?",
  "What changed on the properties that moved between entities?",
];

const FALLBACK_ANSWER = {
  lede: "I don't have a scripted answer for that one. This panel is rule-based rather than generative, so it only covers the questions it was built for &mdash; try one of the prompts on the left, which span settlement risk, a single entity's shortfall, absorbed card fees, NSF returns, month-over-month collection, and properties that changed entity ownership.",
  tableHtml: "",
  sources: [],
  actions: [],
};

/* ---------------------------------------------------------------------------
   Proactive briefing
   ------------------------------------------------------------------------ */

const URGENCY_PILL = { critical: "critical", high: "high", medium: "medium", low: "low" };

/* Every recommendation is derived from the same data the other views render,
   ranked so that anything which becomes unfixable at the settlement cutoff
   outranks anything that is merely expensive. Dollar impact breaks ties
   within a tier. */
function buildRecommendations() {
  const d = AppState.data;
  const recs = [];
  const byType = (t) => d.exceptions.filter((e) => e.type === t);
  const sumImpact = (list) => list.reduce((s, e) => s + Math.abs(e.impact_cents), 0);
  const active = AppState.getActiveEntities();

  const unrecoverable = active.filter((e) => e.funding_risk === "unrecoverable");
  if (unrecoverable.length) {
    recs.push({
      urgency: "critical",
      impact: unrecoverable.reduce((s, e) => s + Math.abs(e.variance_cents), 0),
      title: `Escalate ${unrecoverable.length} entit${unrecoverable.length === 1 ? "y" : "ies"} that can no longer clear by the 10th`,
      why: `${unrecoverable.map((e) => e.name).join(", ")} ${unrecoverable.length === 1 ? "is" : "are"} past the point where reinitiating a payout still lands by ${Fmt.date(d.meta.target_day)}. Fixing the bank details today does not recover the deadline, so this needs a funding decision outside the normal payout path rather than another retry.`,
      action: {
        label: "Escalate for manual funding",
        result: `Simulated: read each blocked payout and its failure reason out of Stripe, then drafted a funding request for the operator's own treasury team covering ${unrecoverable.map((e) => e.name).join(", ")}. Only the first half of that is a Stripe call &mdash; funding an investor outside the payout path is the operator's decision to make, not an action an agent should take on its own.`,
      },
    });
  }

  const recoverable = active.filter((e) => e.payout_status === "failed" && e.funding_risk !== "unrecoverable");
  if (recoverable.length) {
    recs.push({
      urgency: "critical",
      impact: recoverable.reduce((s, e) => s + Math.abs(e.variance_cents), 0),
      title: `Reinitiate ${recoverable.length} returned payout${recoverable.length === 1 ? "" : "s"} before the ${Fmt.date(d.meta.initiate_cutoff)} cutoff`,
      why: `${recoverable.map((e) => e.name).join(", ")} can still fund by the 10th, but only if the payout is reinitiated within ${d.meta.days_until_initiate_cutoff} day${d.meta.days_until_initiate_cutoff === 1 ? "" : "s"} to clear T+2. This is the one item on this list where waiting changes the outcome.`,
      action: {
        label: "Reinitiate payouts",
        result: `Simulated: re-created the returned payouts for ${recoverable.map((e) => e.name).join(", ")} against verified bank details via the Stripe MCP server. New settlement lands before the ${Fmt.date(d.meta.initiate_cutoff)} cutoff.`,
      },
    });
  }

  const nsf = byType("nsf_after_payout");
  if (nsf.length) {
    recs.push({
      urgency: "high",
      impact: sumImpact(nsf),
      title: `Resolve ${Fmt.money(sumImpact(nsf))} of over-funding from ${nsf.length} NSF return${nsf.length === 1 ? "" : "s"} after payout`,
      why: `These residents' rent payments were returned after the entity had already been paid out, so ${nsf.length === 1 ? "that entity is" : "those entities are"} holding money the portfolio never collected. Left alone it silently distorts next month's opening balance.`,
      action: {
        label: "Retry debits and net the shortfall",
        result: `Simulated: re-presented each returned ACH debit via the Stripe MCP server and scheduled the unrecovered balance to net against ${nsf.map((e) => e.entity_name).join(", ")}'s next payout instead of a manual journal entry.`,
      },
    });
  }

  const stale = byType("stale_mapping");
  if (stale.length) {
    recs.push({
      urgency: "high",
      impact: sumImpact(stale),
      title: `Correct ${stale.length} stale connected-account mapping${stale.length === 1 ? "" : "s"}`,
      why: `${Fmt.money(sumImpact(stale))} of rent routed to the prior owner's connected account after ${stale.length === 1 ? "a property" : "properties"} changed entities. Until the mapping is fixed this recurs every month, so correcting it prevents next month's exception rather than just clearing this one.`,
      action: {
        label: "Update account mapping",
        result: `Simulated: repointed the affected properties to the correct connected accounts via the Stripe MCP server and transferred the misrouted ${Fmt.money(sumImpact(stale))} to the receiving ${stale.length === 1 ? "entity" : "entities"}.`,
      },
    });
  }

  const dup = byType("duplicate_payment");
  if (dup.length) {
    recs.push({
      urgency: "medium",
      impact: sumImpact(dup),
      title: `Refund ${dup.length} duplicate rent payment${dup.length === 1 ? "" : "s"}`,
      why: `${Fmt.money(sumImpact(dup))} was charged twice on the same lease. Every day this sits is a day a resident is out of pocket for rent they already paid, which is the fastest of these items to become a support escalation.`,
      action: {
        label: "Refund duplicates",
        result: `Simulated: issued refunds for the duplicate charges via the Stripe MCP server, leaving the original payments and the entities' statements untouched.`,
      },
    });
  }

  const short = byType("short_payment");
  if (short.length) {
    recs.push({
      urgency: "medium",
      impact: sumImpact(short),
      title: `Collect ${Fmt.money(sumImpact(short))} in short-paid rent across ${short.length} lease${short.length === 1 ? "" : "s"}`,
      why: `${short.length === 1 ? "A resident" : "These residents"} paid less than the lease amount, so the entity's rent roll and its settlement disagree. The convention here is to pursue the resident rather than restate the entity's statement.`,
      action: {
        label: "Invoice the shortfall",
        result: `Simulated: created a balance-due invoice for each short-paid lease via the Stripe MCP server and left the affected entities' statements unadjusted per the standard disposition.`,
      },
    });
  }

  const appfee = byType("app_fee_misroute");
  if (appfee.length) {
    recs.push({
      urgency: "medium",
      impact: sumImpact(appfee),
      title: `Recover ${Fmt.money(sumImpact(appfee))} of rental application fees that landed on investor accounts`,
      why: `${appfee.length === 1 ? "A rental application fee" : `${appfee.length} rental application fees`} paid by prospective residents ${appfee.length === 1 ? "was" : "were"} routed to an investor's connected account instead of the property manager's own operating account. That is the manager's revenue sitting on someone else's books, and it shows up as ${appfee.length === 1 ? "that entity" : "those entities"} being over-funded. Note this is a rental application fee, not a Stripe application fee.`,
      action: {
        label: "Move fees to operating account",
        result: `Simulated: reversed the destination transfers via the Stripe MCP server so the ${Fmt.money(sumImpact(appfee))} lands in the property manager's operating account, clearing the same amount of over-funding on ${appfee.map((e) => e.entity_name).join(", ")}.`,
      },
    });
  }

  // Not an exception, but the largest recurring number on the screen.
  const mig = achMigrationOpportunity();
  if (mig) {
    recs.push({
      urgency: "medium",
      impact: mig.monthlySavingsCents,
      title: `Move card-paying residents to ACH to stop absorbing ~${Fmt.moneyShort(mig.monthlySavingsCents)}/mo`,
      why: `${Fmt.int(mig.cardCharges)} rent payments a month arrive on card at an average of ${Fmt.money(mig.avgChargeCents)}, costing ${Fmt.money(mig.cardFeePerChargeCents)} each in fees the operator absorbs. The same payment on ACH costs ${Fmt.money(mig.achFeePerChargeCents)} because the ${Fmt.money(d.meta.fee_assumptions.ach_cap_cents)} cap binds well below rent-sized amounts. This is the single largest controllable cost on the platform, and it rests on the unverified ACH rate flagged in the assumptions panel.`,
      action: {
        label: "Send ACH enrollment links",
        result: `Simulated: generated ACH enrollment links for the ${Fmt.int(mig.cardCharges)} card-paying leases via the Stripe MCP server and queued them behind the operator's existing resident communication approval step.`,
      },
    });
  }

  const wcp = d.waiver_current_period;
  if (wcp.no_prior_failure_count) {
    const pct = (wcp.no_prior_failure_count / wcp.count) * 100;
    recs.push({
      urgency: "low",
      impact: Math.round(wcp.total_cents * (wcp.no_prior_failure_count / wcp.count)),
      title: `Tighten waiver eligibility &mdash; ${pct.toFixed(0)}% of waivers went to residents with no prior failure`,
      why: `${Fmt.int(wcp.no_prior_failure_count)} of ${Fmt.int(wcp.count)} fee waivers this period went to residents who had never had a payment fail, so the waiver was used as a convenience rather than to recover a relationship. That pattern, not the headline total, is the part that is actually addressable by policy.`,
      action: {
        label: "Draft a waiver-eligibility rule",
        result: `Simulated: pulled the ${Fmt.int(wcp.no_prior_failure_count)} no-prior-failure waivers via the Stripe MCP server and drafted an eligibility rule requiring a prior failed payment, routed to the fee-policy owner for approval.`,
      },
    });
  }

  const arrears = (d.residents || []).filter(
    (r) => r.lease_status !== "vacated" && r.payment_history[r.payment_history.length - 1].status === "failed"
  );
  if (arrears.length) {
    const owed = arrears.reduce((s, r) => s + r.monthly_rent_cents, 0);
    recs.push({
      urgency: "high",
      impact: owed,
      title: `Chase ${arrears.length} leases in arrears right now (${Fmt.money(owed)} of rent)`,
      why: `These are leases whose most recent rent payment failed and has not been cured, sampled across the portfolio. Unlike the exception queue, nothing here is a reconciliation error &mdash; it is simply rent that has not arrived and is not being chased by anything automatic.`,
      action: {
        label: "Batch retry debits",
        result: `Simulated: re-presented the failed debit on all ${arrears.length} leases in arrears via the Stripe MCP server and queued a notice to each resident that a retry is scheduled.`,
      },
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return recs.sort((a, b) => order[a.urgency] - order[b.urgency] || b.impact - a.impact);
}

/* What the portfolio's card volume would cost on ACH instead. Derived from
   the documented payment mix and the operator's negotiated card rate; the
   ACH side depends on the unverified ACH placeholder, so callers must say so.
   Returns null rather than guessing if the inputs are missing. */
function achMigrationOpportunity() {
  const d = AppState.data;
  const fa = d.meta.fee_assumptions;
  const mix = d.meta.payment_mix;
  if (!fa || !mix || !d.totals.card_volume_cents) return null;

  const cardCharges = Math.round(d.meta.total_charges_modeled * mix.card);
  if (!cardCharges) return null;

  const avgChargeCents = d.totals.card_volume_cents / cardCharges;
  const cardFeePerChargeCents = (avgChargeCents * fa.card_domestic_bps) / 10000 + fa.card_domestic_fixed_cents;
  const achFeePerChargeCents = Math.min((avgChargeCents * fa.ach_bps) / 10000, fa.ach_cap_cents);
  const monthlySavingsCents = Math.round((cardFeePerChargeCents - achFeePerChargeCents) * cardCharges);

  return {
    cardCharges,
    avgChargeCents,
    cardFeePerChargeCents,
    achFeePerChargeCents,
    monthlySavingsCents,
    annualSavingsCents: monthlySavingsCents * 12,
  };
}

function renderBriefing(messages) {
  const d = AppState.data;
  const recs = buildRecommendations();
  const shown = recs.slice(0, 6);
  const hidden = recs.length - shown.length;

  const openExceptions = AppState.getOpenExceptions();
  const unrecoverable = AppState.getActiveEntities().filter((e) => e.funding_risk === "unrecoverable");

  const el = document.createElement("div");
  el.className = "msg-briefing";
  el.innerHTML = `
    <div class="briefing-head">
      <span class="briefing-kicker">Opening briefing &middot; ${d.meta.model_month_label} close</span>
      <h2 class="briefing-title">${d.meta.days_remaining} day${d.meta.days_remaining === 1 ? "" : "s"} to fund every entity, ${openExceptions.length} open exception${openExceptions.length === 1 ? "" : "s"}, ${Fmt.moneyShort(d.totals.total_in_flight_cents)} still in flight.</h2>
      <div class="briefing-sub">
        ${AppState.getReconciledCount()} of ${d.meta.num_entities_active} entities reconciled &middot;
        ${Fmt.moneyShort(d.totals.total_collected_cents)} collected &middot;
        ${Fmt.moneyShort(d.totals.total_settled_cents)} settled${unrecoverable.length ? ` &middot; <span class="text-blocked">${unrecoverable.length} unrecoverable by deadline</span>` : ""}
      </div>
    </div>

    <div class="briefing-recs">
      ${shown.map((r, i) => `
        <div class="rec-item">
          <div class="rec-top">
            <span class="pill pill-${URGENCY_PILL[r.urgency]}">${r.urgency}</span>
            <span class="rec-title">${r.title}</span>
          </div>
          <div class="rec-why">${r.why}</div>
          <div class="agent-actions">
            <button class="agent-action-btn" data-rec-idx="${i}">${r.action.label}</button>
          </div>
        </div>
      `).join("")}
    </div>

    ${hidden > 0 ? `<div class="briefing-more">${hidden} lower-priority recommendation${hidden === 1 ? "" : "s"} not shown here; the full exception queue is on the Close tab.</div>` : ""}

    <div class="briefing-disclosure">
      This briefing is <strong>computed</strong>, not generated. The ranking is a fixed rule &mdash; anything that becomes unfixable at the T+2 settlement cutoff outranks anything merely expensive, with dollar impact breaking ties &mdash; applied to the same JSON every other tab reads. There is no language model here and no network call. It stands in for the pattern the demo is about: Stripe data landing in the warehouse via <strong>Data Pipeline</strong>, and Stripe reachable as a tool via the <strong>MCP server</strong>, so an agent can arrive already knowing what is wrong and hand back a specific action instead of a chart. Not every button above is a Stripe call, and the ones that aren't say so in their result: refunding a duplicate or repointing a connected account is an MCP call, while drafting a fee policy, scheduling a warehouse query, or asking a human to fund an investor off the payout path is not. Every action below is <strong>simulated</strong>.
    </div>
  `;

  messages.appendChild(el);

  el.querySelectorAll("[data-rec-idx]").forEach((btn) => {
    const rec = shown[Number(btn.dataset.recIdx)];
    btn.addEventListener("click", () => runAgentAction(rec.action, btn, messages, btn.closest(".rec-item")));
  });
}

function renderAsk() {
  const root = document.getElementById("view-ask");
  root.innerHTML = `
    <div class="ask-layout">
      <div class="ask-chips" id="ask-chips"></div>
      <div class="ask-thread">
        <div class="ask-messages" id="ask-messages"></div>
        <div class="ask-input-row">
          <input type="text" id="ask-free-input" placeholder="Ask about settlement, exceptions, or absorbed cost&hellip;">
          <button id="ask-send-btn">Ask</button>
        </div>
      </div>
    </div>
  `;

  renderBriefing(document.getElementById("ask-messages"));

  const chipsEl = document.getElementById("ask-chips");
  ASK_QUESTIONS.forEach((q) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = q;
    chip.addEventListener("click", () => askQuestion(q));
    chipsEl.appendChild(chip);
  });

  const input = document.getElementById("ask-free-input");
  const sendBtn = document.getElementById("ask-send-btn");
  const submit = () => {
    const val = input.value.trim();
    if (!val) return;
    askQuestion(val);
    input.value = "";
  };
  sendBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

function askQuestion(text) {
  const messages = document.getElementById("ask-messages");

  const userBubble = document.createElement("div");
  userBubble.className = "msg-user";
  userBubble.textContent = text;
  messages.appendChild(userBubble);
  messages.scrollTop = messages.scrollHeight;

  const matched = matchQuestion(text);
  const answer = matched != null ? ANSWER_BUILDERS[matched]() : FALLBACK_ANSWER;

  const answerBubble = document.createElement("div");
  answerBubble.className = "msg-answer";
  answerBubble.style.opacity = "0";
  answerBubble.style.transform = "translateY(6px)";
  answerBubble.style.transition = "opacity 0.4s ease, transform 0.4s ease";
  const actions = answer.actions || [];
  answerBubble.innerHTML = `
    <div class="lede">${answer.lede}</div>
    ${answer.tableHtml || ""}
    ${answer.sources.length ? `<div class="sources">Sources: ${answer.sources.join(", ")}</div>` : ""}
    ${actions.length ? `<div class="agent-actions">${actions.map((a, i) => `<button class="agent-action-btn" data-idx="${i}">${a.label}</button>`).join("")}</div>` : ""}
  `;
  messages.appendChild(answerBubble);
  messages.scrollTop = messages.scrollHeight;

  answerBubble.querySelectorAll(".agent-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => runAgentAction(actions[Number(btn.dataset.idx)], btn, messages));
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      answerBubble.style.opacity = "1";
      answerBubble.style.transform = "translateY(0)";
    });
  });
}

/* `anchorEl`, when given, places the result immediately after that element
   instead of at the bottom of the thread — needed for the briefing, whose
   recommendations sit at the top and would otherwise report their outcome
   somewhere off-screen. */
function runAgentAction(action, btn, messages, anchorEl) {
  btn.disabled = true;
  btn.textContent = "Done";
  btn.classList.add("done");

  const resultBubble = document.createElement("div");
  resultBubble.className = "msg-agent-result";
  resultBubble.style.opacity = "0";
  resultBubble.innerHTML = `<span class="agent-result-icon">&#9889;</span> ${action.result}`;

  if (anchorEl) {
    anchorEl.appendChild(resultBubble);
  } else {
    messages.appendChild(resultBubble);
    messages.scrollTop = messages.scrollHeight;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resultBubble.style.transition = "opacity 0.3s ease";
      resultBubble.style.opacity = "1";
    });
  });
}

const STOPWORDS = new Set(["the", "is", "are", "of", "in", "a", "on", "to", "this", "that", "did", "we", "how", "what", "which", "every", "show", "me", "for", "against"]);

function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
}

function matchQuestion(freeText) {
  const freeTokens = new Set(tokenize(freeText));
  if (freeTokens.size === 0) return null;
  let bestIdx = null;
  let bestScore = 0;
  ASK_QUESTIONS.forEach((q, idx) => {
    const qTokens = tokenize(q);
    const overlap = qTokens.filter((t) => freeTokens.has(t)).length;
    const score = overlap / qTokens.length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestScore >= 0.25 ? bestIdx : null;
}

const ANSWER_BUILDERS = [
  answerAtRisk,
  answerCedarRow,
  answerWaivedFees,
  answerNsfReturns,
  answerCollectionComparison,
  answerEntityMoves,
];

function answerAtRisk() {
  const d = AppState.data;
  const blocked = AppState.getActiveEntities().filter((e) => e.payout_status === "failed");
  const unrecoverable = blocked.filter((e) => e.funding_risk === "unrecoverable");
  const atRisk = blocked.filter((e) => e.funding_risk !== "unrecoverable");
  const sources = [];
  const rowsFor = (list) => list.map((e) => {
    const excs = e.exception_ids.map((id) => d.exceptions.find((x) => x.id === id)).filter(Boolean);
    excs.forEach((x) => sources.push(...x.citations));
    return `<tr>
      <td>${e.name}</td>
      <td>Payout returned &mdash; stale bank details</td>
      <td class="num text-blocked">${Fmt.money(e.variance_cents)}</td>
      <td>${e.funding_risk === "unrecoverable" ? "unrecoverable by deadline" : Fmt.date(d.meta.initiate_cutoff)}</td>
    </tr>`;
  }).join("");

  const lede = blocked.length
    ? `${blocked.length} entit${blocked.length === 1 ? "y" : "ies"} ${blocked.length === 1 ? "is" : "are"} at real risk of missing the 10th, blocked by a returned payout.` +
      (unrecoverable.length ? ` ${unrecoverable.length} of those (${unrecoverable.map((e) => e.name).join(", ")}) can no longer clear in time even if fixed today &mdash; flagged unrecoverable by deadline.` : "") +
      (atRisk.length ? ` ${atRisk.length} more (${atRisk.map((e) => e.name).join(", ")}) can still clear if reinitiated before ${Fmt.date(d.meta.initiate_cutoff)}.` : "")
    : "No entities are currently blocked from funding by the 10th.";

  const tableHtml = blocked.length
    ? `<table><thead><tr><th>Entity</th><th>Reason</th><th class="num">Impact</th><th>Reinitiate by / status</th></tr></thead><tbody>${rowsFor(unrecoverable)}${rowsFor(atRisk)}</tbody></table>`
    : "";

  const actions = [];
  if (atRisk.length) {
    actions.push({
      label: `Reinitiate payout for ${atRisk.length === 1 ? atRisk[0].name : `${atRisk.length} at-risk entities`} via Stripe MCP`,
      result: `Simulated: reinitiated payout for ${atRisk.map((e) => e.name).join(", ")} via the Stripe MCP server. New settlement date lands before the ${Fmt.date(d.meta.initiate_cutoff)} cutoff.`,
    });
  }
  if (unrecoverable.length) {
    actions.push({
      label: `Escalate ${unrecoverable.length === 1 ? unrecoverable[0].name : `${unrecoverable.length} unrecoverable entities`} to Treasury`,
      result: `Simulated: pulled each blocked payout and its failure reason via the Stripe MCP server, then escalated ${unrecoverable.map((e) => e.name).join(", ")} to Treasury ops as unrecoverable by deadline &mdash; flagged for manual funding outside the normal payout path.`,
    });
  }

  return { lede, tableHtml, sources, actions };
}

function answerCedarRow() {
  const d = AppState.data;
  const entity = AppState.getEntityByName("Cedar Row Assets 3, LLC");
  if (!entity) return FALLBACK_ANSWER;
  const excs = entity.exception_ids.map((id) => d.exceptions.find((x) => x.id === id)).filter(Boolean);
  const sources = excs.flatMap((x) => x.citations);
  const lede = excs.length
    ? excs.map((x) => x.explanation).join(" ")
    : "Cedar Row Assets 3, LLC has no open exceptions this period.";
  const tableHtml = `
    <table>
      <thead><tr><th>Expected</th><th>Collected</th><th>Settled</th><th class="num">Variance</th></tr></thead>
      <tbody><tr>
        <td class="num">${Fmt.money(entity.expected_rent_cents)}</td>
        <td class="num">${Fmt.money(entity.collected_cents)}</td>
        <td class="num">${Fmt.money(entity.settled_cents)}</td>
        <td class="num text-under">${Fmt.money(entity.variance_cents)}</td>
      </tr></tbody>
    </table>
  `;
  const actions = excs.length
    ? [
        { label: "Send resident a payment reminder", result: `Simulated: queued a payment reminder to the resident on the delinquent lease at ${entity.name} via the Stripe MCP server.` },
        { label: "Move resident's account to collections", result: `Simulated: flagged the resident account for collections handoff at ${entity.name}. Status change logged for property ops; ${entity.name}'s statement is left unadjusted per the standard disposition.` },
      ]
    : [];
  return { lede, tableHtml, sources, actions };
}

function answerWaivedFees() {
  const d = AppState.data;
  const wcp = d.waiver_current_period;
  const avg = wcp.total_cents / wcp.count;
  const annualized = wcp.total_cents * 12;
  const lede = `We absorbed ${Fmt.money(wcp.total_cents)} in waived card processing fees this period, across ${Fmt.int(wcp.count)} waivers &mdash; averaging ${Fmt.money(avg)} per waiver. At the current run-rate that's ${Fmt.moneyShort(annualized)} annualized.`;
  const tableHtml = `
    <table>
      <thead><tr><th>Waivers</th><th class="num">Total absorbed</th><th class="num">Avg / waiver</th></tr></thead>
      <tbody><tr>
        <td>${Fmt.int(wcp.count)}</td>
        <td class="num">${Fmt.money(wcp.total_cents)}</td>
        <td class="num">${Fmt.money(avg)}</td>
      </tr></tbody>
    </table>
  `;
  const sources = d.waivers.slice(0, 5).map((w) => w.id);
  const noPriorPct = (wcp.no_prior_failure_count / wcp.count) * 100;
  const actions = [
    {
      label: "Flag no-prior-failure waivers",
      result: `Simulated: pulled ${Fmt.int(wcp.no_prior_failure_count)} waivers (${noPriorPct.toFixed(0)}% of this period's total) applied to residents with no prior payment failure via the Stripe MCP server, and sent them to the fee-policy owner for review as likely shortcut usage rather than recovery.`,
    },
  ];
  return { lede, tableHtml, sources, actions };
}

function answerNsfReturns() {
  const d = AppState.data;
  const nsfExcs = d.exceptions.filter((e) => e.type === "nsf_after_payout");
  const total = nsfExcs.reduce((sum, e) => sum + e.impact_cents, 0);
  const lede = `${nsfExcs.length} NSF returns landed after payout this period, leaving a combined ${Fmt.money(total)} over-funded across the affected entities.`;
  const rows = nsfExcs.map((e) => `
    <tr>
      <td>${e.entity_name}</td>
      <td class="num text-over">${Fmt.money(e.impact_cents)}</td>
      <td>${AppState.exceptionStatus[e.id]}</td>
    </tr>
  `).join("");
  const tableHtml = `<table><thead><tr><th>Entity</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  const sources = nsfExcs.flatMap((e) => e.citations);
  const actions = nsfExcs.length
    ? [
        { label: "Retry ACH debits", result: `Simulated: re-presented the returned ACH debits for the residents behind ${nsfExcs.map((e) => e.entity_name).join(", ")}'s payments via the Stripe MCP server.` },
        { label: "Send NSF notices", result: `Simulated: queued an NSF notice to the residents on ${nsfExcs.map((e) => e.entity_name).join(", ")} via the Stripe MCP server, explaining the returned payment and the next debit attempt.` },
      ]
    : [];
  return { lede, tableHtml, sources, actions };
}

function answerCollectionComparison() {
  const d = AppState.data;
  const hist = d.collection_history;
  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2];
  const pctChange = ((last.total_collected_cents - prev.total_collected_cents) / prev.total_collected_cents) * 100;
  const lede = `Collection this month (${last.month}) is ${Fmt.moneyShort(last.total_collected_cents)}, ${Fmt.pct(pctChange)} versus last month's ${Fmt.moneyShort(prev.total_collected_cents)}. ${Fmt.moneyShort(last.total_settled_cents)} has settled to investors so far, and the queue currently has ${last.exception_count} exception${last.exception_count === 1 ? "" : "s"} open.`;
  const rows = hist.slice(-6).map((h) => `
    <tr><td>${h.month}</td><td class="num">${Fmt.money(h.total_collected_cents)}</td><td class="num">${Fmt.money(h.total_settled_cents)}</td><td class="num">${Fmt.int(h.exception_count)}</td></tr>
  `).join("");
  const tableHtml = `<table><thead><tr><th>Month</th><th class="num">Total collected</th><th class="num">Total settled</th><th class="num">Exceptions</th></tr></thead><tbody>${rows}</tbody></table>`;
  const actions = [
    { label: "Export month-over-month report to Finance", result: `Simulated: assembled the collection trend for ${last.month} vs. ${prev.month} from the warehouse and sent it to Finance.` },
  ];
  return { lede, tableHtml, sources: ["monthly collection totals (aggregated)"], actions };
}

function answerEntityMoves() {
  const d = AppState.data;
  const staleExcs = d.exceptions.filter((e) => e.type === "stale_mapping");
  const lede = staleExcs.length
    ? `${staleExcs.length} propert${staleExcs.length === 1 ? "y" : "ies"} moved between entities this month and briefly followed the stale connected-account mapping. ${staleExcs.map((e) => e.explanation).join(" ")}`
    : "No properties changed entity ownership this month.";
  const rows = staleExcs.map((e) => {
    const citation = AppState.getCitation(e.citations[0]);
    const propertyId = citation ? citation.metadata.property_id : "&mdash;";
    const effectiveDate = citation && citation.metadata.ownership_effective_date
      ? Fmt.date(citation.metadata.ownership_effective_date)
      : "&mdash;";
    return `<tr>
      <td>${propertyId}</td>
      <td>${e.counterparty_entity_name}</td>
      <td>${e.entity_name}</td>
      <td>${effectiveDate}</td>
      <td class="num">${Fmt.money(e.impact_cents)}</td>
    </tr>`;
  }).join("");
  const tableHtml = staleExcs.length
    ? `<table><thead><tr><th>Property</th><th>Moved from</th><th>Moved to</th><th>Effective</th><th class="num">Amount misrouted</th></tr></thead><tbody>${rows}</tbody></table>`
    : "";
  const sources = staleExcs.flatMap((e) => e.citations);
  const actions = staleExcs.length
    ? [
        { label: "Update connected-account mapping", result: `Simulated: corrected the connected-account mapping for ${staleExcs.length} propert${staleExcs.length === 1 ? "y" : "ies"} via the Stripe MCP server &mdash; future charges route directly to ${staleExcs.length === 1 ? "the correct entity" : "the correct entities"}.` },
        { label: "Notify entity ops of the mapping fix", result: `Simulated: notified entity ops that the stale mapping on ${staleExcs.map((e) => e.entity_name).join(", ")} has been corrected.` },
      ]
    : [];
  return { lede, tableHtml, sources, actions };
}
