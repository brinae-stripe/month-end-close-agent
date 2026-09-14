/* Month-End Close Agent — Ask view. Scripted, not generative: answers are computed at
   render time from the same JSON the other views use, so numbers always agree. */

const ASK_QUESTIONS = [
  "Which investor entities are at risk of missing the 10th?",
  "Why is Cedar Row Assets 3 short this month?",
  "How much did we absorb in waived card fees this period?",
  "Show me every NSF return that landed after payout.",
  "How does collection this month compare to last month?",
  "What changed on the properties that moved between entities?",
];

const FALLBACK_ANSWER = {
  lede: "I can answer questions about settlement, exceptions, and absorbed cost this period.",
  tableHtml: "",
  sources: [],
  actions: [],
};

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

function runAgentAction(action, btn, messages) {
  btn.disabled = true;
  btn.textContent = "Done";
  btn.classList.add("done");

  const resultBubble = document.createElement("div");
  resultBubble.className = "msg-agent-result";
  resultBubble.style.opacity = "0";
  resultBubble.innerHTML = `<span class="agent-result-icon">&#9889;</span> ${action.result}`;
  messages.appendChild(resultBubble);
  messages.scrollTop = messages.scrollHeight;

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
      label: `Reinitiate payout for ${atRisk.length === 1 ? atRisk[0].name : `${atRisk.length} at-risk entities`}`,
      result: `Reinitiated payout for ${atRisk.map((e) => e.name).join(", ")}. New settlement date lands before the ${Fmt.date(d.meta.initiate_cutoff)} cutoff.`,
    });
  }
  if (unrecoverable.length) {
    actions.push({
      label: `Escalate ${unrecoverable.length === 1 ? unrecoverable[0].name : `${unrecoverable.length} unrecoverable entities`} to Treasury`,
      result: `Escalated ${unrecoverable.map((e) => e.name).join(", ")} to Treasury ops as unrecoverable by deadline &mdash; flagged for manual funding outside the normal payout path.`,
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
        { label: "Send resident a payment reminder", result: `Payment reminder queued to the resident on the delinquent lease at ${entity.name} via the property's customer communication workflow.` },
        { label: "Move resident's account to collections", result: `Resident account flagged for collections handoff at ${entity.name}. Status change logged for property ops; ${entity.name}'s statement is left unadjusted per the standard disposition.` },
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
      label: "Flag no-prior-failure waivers for policy review",
      result: `Flagged ${Fmt.int(wcp.no_prior_failure_count)} waivers (${noPriorPct.toFixed(0)}% of this period's total) applied to residents with no prior payment failure. Sent to the fee-policy owner for review as likely shortcut usage rather than recovery.`,
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
        { label: "Retry ACH debit for affected residents", result: `ACH retry queued for the residents behind ${nsfExcs.map((e) => e.entity_name).join(", ")}'s returned payments.` },
        { label: "Send NSF notice to residents", result: `NSF notice queued to the residents on ${nsfExcs.map((e) => e.entity_name).join(", ")}, explaining the returned payment and next debit attempt.` },
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
    { label: "Export month-over-month report to Finance", result: `Collection trend report for ${last.month} vs. ${prev.month} exported and sent to Finance.` },
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
        { label: "Update connected-account mapping", result: `Connected-account mapping corrected for ${staleExcs.length} propert${staleExcs.length === 1 ? "y" : "ies"} &mdash; future charges route directly to ${staleExcs.length === 1 ? "the correct entity" : "the correct entities"}.` },
        { label: "Notify entity ops of the mapping fix", result: `Entity ops notified that the stale mapping on ${staleExcs.map((e) => e.entity_name).join(", ")} has been corrected.` },
      ]
    : [];
  return { lede, tableHtml, sources, actions };
}
