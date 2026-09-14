# Demo Script — Month-End Close Agent (~4 minutes)

Numbers below are from the current seeded run. If you regenerate the data,
re-check them (`python3 generate_data.py` prints a summary at the end).

## 1. Open on Close (0:00–1:15)

Land on the **Close** tab. It opens here by default.

- Point to the countdown card: **"6 days until the 10th"** and the
  **"last day to initiate: October 8"** line underneath it — call out that
  this is a T+2 settlement cutoff, not an arbitrary buffer.
- Point to the reconciliation status card: **"46 of 64 entities
  reconciled."** Note the denominator is 64, not 81 — the other 17 are
  dormant accounts carried for history only and are out of scope for this
  month's close.
- Say the three headline numbers out loud: **$92.0M collected**,
  **$88.6M settled to investors**, **$3.4M still in flight**.

## 2. Walk the exception queue (1:15–2:15)

- Scroll to the exception queue. Point out it's sorted by severity —
  5 critical exceptions at the top.
- Open the **Copper Bend Residential Assets 2, LLC** payout-failed card —
  the single most urgent item, at **$2,581,113.00 blocked**. Point out the
  distinct **"unrecoverable by deadline"** badge: this isn't just late,
  it's a computed flag meaning even fixing it today won't clear it by the
  10th. Read the explanation and disposition aloud, then point at the
  "Sources" line: a real payout ID, not a made-up number.
- Click **Approve** on one lower-severity card (pick a short-payment or
  app-fee-misroute card). Narrate while it animates out: **"The agent
  proposed a disposition, cited the transaction, and a person just
  decided — that's the whole interaction."** Point out the reconciled
  counter ticks up.
- Scroll to the entity table. Point out the **Fee** column between
  Collected and Settled — every entity rollup shows gross, fee, and net,
  not just a single total. Scroll to the dormant-accounts section below
  and note it's visually separated, with a "dormant · out of scope" pill
  instead of a reconciliation status.

## 3. Jump to Ask (2:15–3:00)

Switch to the **Ask** tab.

- Click the chip: **"Why is Cedar Row Assets 3 short this month?"**
  The answer should name the exact resident shortfall
  (**$950.61** against Cedar Row Assets 3, LLC's $12,003,013.00 collected)
  and cite the underlying charge ID.
- Click a second chip: **"Which investor entities are at risk of missing
  the 10th?"** Point out the answer distinguishes entities that are
  merely at risk (can still clear if reinitiated before the 8th) from
  the one flagged unrecoverable by deadline — same distinction visible on
  Close, just phrased as an answer instead of a badge.
- If asked, mention: no LLM call happens here. The six questions and the
  free-text fallback are scripted; the numbers are computed from the
  loaded JSON at click time.

## 4. Close on Margin (3:00–4:00)

Switch to the **Margin** tab.

- Headline: **"$105,654.37 absorbed in waived card fees this
  period"** — across 2,000 waivers. Say: **"Nobody had a running total of
  this before."**
- Point at the annualized figure (**~$1.27M, at current run-rate** — not
  a flat trailing-year average, because the trend is climbing) and the
  12-month chart showing waiver count trending up.
- Point at the subordinate **ceiling card** just below the headline:
  **~$517K/mo, ~$6.2M/yr** if every card fee were absorbed instead of
  passed through (~$604K/mo, ~$7.2M/yr including wallets). Say: **"The
  actual number sits somewhere between zero and this ceiling — right now,
  nobody's tracking exactly where."**
- Land on the callout: **632 of 2,000 waivers this period went to
  residents with no prior payment failure** — say: **"Nearly a third of
  these waivers weren't fixing a failed payment. They were used as a
  shortcut."**
- Close by pointing at the assumptions panel fixed at the bottom of the
  screen: **"This is the operator's actual negotiated Connect pricing,
  not sticker rates — and every unverified number, like the ACH rate and
  the international card share, is flagged right here, all the time."**

## If there's time for questions

- **"Is this real data?"** No — fully synthetic, seeded, regenerable.
  Every ID is `DEMO`-marked.
- **"Does Approve actually change anything?"** It's in-memory for this
  session only; reloading the page resets it. In a real build this would
  write back to the ledger.
- **"Is the chat generative?"** No — scripted questions, computed
  answers, no model call, offline by design.
- **"Why are there 81 entities but the close only covers 64?"** The other
  17 are dormant connected accounts — no current-month activity, kept
  only for lifetime-volume history. They're shown separately on the Close
  view rather than folded into the reconciliation count.
