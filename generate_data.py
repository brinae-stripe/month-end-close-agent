#!/usr/bin/env python3
"""
Month-End Close Agent - synthetic data generator.

Generates one fully-offline, deterministic month of reconciliation data for
a fictional single-family-rental operator on Stripe Connect, plus the six
seeded reconciliation exceptions the demo is built around.

Every dollar figure below is derived from validated production shape (scale,
volume curve, pricing, payment mix, exception counts) for the real customer
this demo is modeled on, but all IDs, names, and individual transactions are
synthetic. No real company names, people, banks, or account numbers appear.

IMPORTANT: everything here is synthetic. Entity names are invented. IDs carry
a DEMO marker.

Run: python3 generate_data.py
Output: web/data/reconciliation.json

Determinism: a single random.Random(SEED) instance drives every random
choice below, in a fixed call order, so the same command always produces
byte-identical output.
"""

import json
import math
import random
from datetime import date, timedelta

# ---------------------------------------------------------------------------
# Configuration - edit these to change the demo's "today"
# ---------------------------------------------------------------------------

SEED = 20260910

MODEL_YEAR = 2026
MODEL_MONTH = 9  # September 2026 - the month that "just ended"
MODEL_MONTH_LABEL = "September 2026"

TODAY = date(2026, 10, 4)            # 4th of the following month
TARGET_DAY = date(2026, 10, 10)      # every entity must be fully funded by this date
INITIATE_CUTOFF = date(2026, 10, 8)  # T+2 before the 10th - last day to kick off a payout
BANK_DETAIL_VERIFICATION_DAYS = 5   # realistic turnaround to confirm updated bank details
UNRECOVERABLE_THRESHOLD_DAYS = BANK_DETAIL_VERIFICATION_DAYS

# Portfolio scale (validated production shape)
NUM_ENTITIES_ACTIVE = 64     # connected accounts that transacted in the last 35 days
NUM_ENTITIES_DORMANT = 17    # connected accounts with lifetime history, no current activity
NUM_ENTITIES = NUM_ENTITIES_ACTIVE + NUM_ENTITIES_DORMANT

ACTIVE_HOMES_TARGET = 47_000   # homes under active management this month
ACTIVE_CHARGES_TARGET = 44_000  # rent charges actually generated - vacancy + unpaid residents
                                 # create the gap; this is NOT one charge per home.

AVG_RENT_CENTS = 200_000       # $2,000
APPLICATION_FEE_CENTS = 7_500  # $75, always card, routes to PM's own account
PM_ACCOUNT_ID = "acct_DEMO_PMMSTR"

TOTAL_ACTIVE_VOLUME_CENTS = 92_000_000_00  # ~$92M/month across the 64 active entities
MAX_ENTITY_VOLUME_CENTS = 5_200_000_00     # largest active entity, ~$5.2M/month
MIN_ENTITY_VOLUME_CENTS = 4_000_00         # smallest active entity, under $5k/month

# Negotiated card pricing, effective 2024-05-09. Domestic dominates for US residential rent.
CARD_DOMESTIC_BPS = 250          # 2.50%
CARD_DOMESTIC_FIXED_CENTS = 20   # $0.20
CARD_INTERNATIONAL_BPS = 400     # 4.00%
CARD_INTERNATIONAL_FIXED_CENTS = 20

# ACH pricing is NOT verified. Sticker placeholder. Flag in the UI as an assumption.
ACH_BPS = 80                     # 0.80%
ACH_CAP_CENTS = 500              # capped at $5.00

CARD_INTERNATIONAL_SHARE = 0.01  # unverified, named constant, changeable
WALLET_PRICED_AS_CARD = True      # assumption: wallet payments priced identically to domestic card

# Payment method mix, assigned at the resident level (stable 3 months in production data)
PAYMENT_MIX = {"ach": 0.738, "card": 0.224, "wallet": 0.037}

# Whether the processing fee is netted from the investor's transfer, or absorbed by the
# operator. Unconfirmed in production. Modeled here as netted from the transfer - a named,
# on-screen-labeled assumption, not a verified fact.
FEE_NETTED_FROM_INVESTOR_TRANSFER = True

TARGET_WAIVER_COUNT = 2000  # current-period waiver events (subset of card/wallet payers)
WAIVER_PRIOR_FAILURE_RATE = 0.70  # share of waivers with a logged bank-link failure first
WAIVER_AVG_RENT_CENTS = 200_000

# All 81 connected accounts share this configuration in production.
ACCOUNT_CONFIG = {
    "configuration": "custom",
    "dashboard_access": False,
    "onboarding_owner": "platform",
    "loss_liability": "platform",
    "country": "US",
}

rng = random.Random(SEED)

# ---------------------------------------------------------------------------
# ID helpers
# ---------------------------------------------------------------------------

_HEX = "0123456789abcdef"


def demo_id(prefix, n=6):
    suffix = "".join(rng.choice(_HEX) for _ in range(n))
    return f"{prefix}_DEMO_{suffix}"


def seq_id(prefix, i, width=6):
    return f"{prefix}_DEMO_{i:0{width}d}"


# ---------------------------------------------------------------------------
# Fictional investor entity names
# ---------------------------------------------------------------------------

# Pinned names/families: referenced explicitly by the Ask questions or the
# exception script, so they must exist rather than being left to chance.
# "Cedar Row Assets 3, LLC" - the short-payment entity (must be small/active).
# "Marrow Point Assets 1, LLC" / "Marrow Point Assets 2, LLC" - a fund family
# sharing a prefix, used as the old/new pair for the stale-mapping exception.
CEDAR_ROW_NAME = "Cedar Row Assets 3, LLC"
MARROW_POINT_OLD_NAME = "Marrow Point Assets 1, LLC"
MARROW_POINT_NEW_NAME = "Marrow Point Assets 2, LLC"

PINNED_NAMES = [
    CEDAR_ROW_NAME,
    "Cedar Row Assets 1, LLC",
    "Cedar Row Assets 2, LLC",
    "Cedar Row Assets 4, LLC",
    MARROW_POINT_OLD_NAME,
    MARROW_POINT_NEW_NAME,
    "Marrow Point Assets 3, LLC",
]

FUND_FAMILIES = [
    "Northgate SFR", "Briarwood Residential", "Sable Creek Housing", "Thistledown SFR",
    "Wrenfield Asset", "Copper Bend Residential", "Halesworth Property", "Quarrytown SFR",
    "Millbrook", "Ashford", "Stonecrop", "Fallow Field", "Rivergate", "Elderglen",
    "Hawkridge", "Larkspur", "Windmere", "Oakhollow", "Bramblewood", "Tanglewood",
    "Fernbridge", "Grayhollow", "Ironbark SFR", "Kestrel Point", "Longmeadow",
]

STANDALONE_TEMPLATES = [
    "{p} OwnerCo LLC", "{p} Development LLC", "{p} Homes LLC", "{p} Ridge LLC",
    "{p} Crossing LLC", "{p} Terrace LLC",
]
STANDALONE_PREFIXES = [
    "Mossgate", "Nightshade Row", "Pinehollow", "Redcliff", "Silverline", "Thornfield",
    "Underhill", "Vesper Row", "Amberlea", "Brightwater", "Corvid Hill", "Duskwood",
    "Emberly", "Foxglen", "Greystone Row", "Harrowgate", "Ivybrook", "Juniper Bend",
]


def generate_entity_names(count):
    """Fund families own 1-4 numbered accounts each ('Assets N, LLC' / 'Asset Company N LLC');
    standalone entities are named after properties/developments ('X OwnerCo LLC', etc)."""
    names = list(PINNED_NAMES)
    family_pool = []
    for fam in FUND_FAMILIES:
        n_accounts = rng.randint(1, 4)
        style = rng.choice(["Assets {n}, LLC", "Asset Company {n} LLC"])
        for i in range(1, n_accounts + 1):
            candidate = f"{fam} {style.format(n=i)}"
            if candidate not in names:
                family_pool.append(candidate)
    standalone_pool = []
    for p in STANDALONE_PREFIXES:
        for t in STANDALONE_TEMPLATES:
            candidate = t.format(p=p)
            if candidate not in names:
                standalone_pool.append(candidate)
    rng.shuffle(family_pool)
    rng.shuffle(standalone_pool)
    pool = family_pool + standalone_pool
    needed = count - len(names)
    names.extend(pool[:needed])
    return names[:count]


def fund_family_of(name):
    for fam in FUND_FAMILIES + ["Cedar Row", "Marrow Point"]:
        if name.startswith(fam + " "):
            return fam
    return None


MARKETS = [
    "Dallas-Fort Worth, TX", "Phoenix, AZ", "Atlanta, GA", "Charlotte, NC",
    "Tampa, FL", "Orlando, FL", "Nashville, TN", "Indianapolis, IN",
    "Columbus, OH", "Jacksonville, FL", "San Antonio, TX", "Houston, TX",
    "Raleigh, NC", "Memphis, TN", "Kansas City, MO", "Oklahoma City, OK",
    "Las Vegas, NV", "Salt Lake City, UT", "Denver, CO", "Cincinnati, OH",
    "Greenville, SC", "Birmingham, AL", "Chattanooga, TN", "Huntsville, AL",
    "Tucson, AZ", "Boise, ID", "Colorado Springs, CO", "Knoxville, TN",
    "Louisville, KY", "Richmond, VA", "Winston-Salem, NC", "Sarasota, FL",
    "Fort Myers, FL", "Lakeland, FL", "Augusta, GA", "Savannah, GA",
    "El Paso, TX", "Little Rock, AR", "Tulsa, OK", "Wichita, KS",
]

# ---------------------------------------------------------------------------
# Step 1 - build the 64-entity long-tail monthly volume curve
# ---------------------------------------------------------------------------
#
# Two-segment construction, solved numerically ahead of time (see comments):
# rank 1 fixed at the max; ranks 2-40 an exponential decay sized so ranks 1-40
# sum to 96% of total volume (matching the top-40 concentration target);
# ranks 41-64 a geometric tail, continuous with rank 40, sized so the full
# 64 ranks sum to exactly the target total and rank 64 lands near the min.
# This satisfies rank1/rank64 endpoints, monotonic decrease, and the exact
# total exactly; it lands close to (not exact on) every top-N concentration
# checkpoint and the median - those checkpoints are jointly over-constrained
# for a 64-element monotonic sequence, so this is the closest simultaneous fit.

_N_HEAD = 40
_N_TAIL = NUM_ENTITIES_ACTIVE - _N_HEAD
_TOP40_FRAC = 0.96
_HEAD_DECAY_K = 0.055


def _build_volume_curve():
    top40_total = _TOP40_FRAC * TOTAL_ACTIVE_VOLUME_CENTS
    remain_2_40 = top40_total - MAX_ENTITY_VOLUME_CENTS
    ranks2_40 = list(range(2, _N_HEAD + 1))
    raw = [math.exp(-_HEAD_DECAY_K * (r - 2)) for r in ranks2_40]
    c = remain_2_40 / sum(raw)
    head = [MAX_ENTITY_VOLUME_CENTS] + [c * x for x in raw]

    tail_total = TOTAL_ACTIVE_VOLUME_CENTS - sum(head)
    start_val = head[-1]
    lo, hi = 1e-6, 0.999999
    for _ in range(300):
        r = (lo + hi) / 2
        s = start_val * (1 - r ** _N_TAIL) / (1 - r)
        if s > tail_total:
            hi = r
        else:
            lo = r
    r = (lo + hi) / 2
    tail = [start_val * (r ** i) for i in range(_N_TAIL)]

    full = head + tail
    # fix float rounding drift onto the smallest rank so the sum is exact
    drift = TOTAL_ACTIVE_VOLUME_CENTS - sum(round(v) for v in full)
    full = [round(v) for v in full]
    full[-1] += drift
    return full


VOLUME_CURVE_CENTS = _build_volume_curve()  # rank 1..64, descending

# ---------------------------------------------------------------------------
# Step 2 - build entities: names, active/dormant split, volumes, home counts
# ---------------------------------------------------------------------------

all_names = generate_entity_names(NUM_ENTITIES)
by_name_lookup = {n: n for n in all_names}

cedar_row_name = CEDAR_ROW_NAME
marrow_old_name = MARROW_POINT_OLD_NAME
marrow_new_name = MARROW_POINT_NEW_NAME

must_be_active = [cedar_row_name, marrow_old_name, marrow_new_name]
other_names = [n for n in all_names if n not in must_be_active]
rng.shuffle(other_names)

active_names = list(must_be_active) + other_names[:NUM_ENTITIES_ACTIVE - len(must_be_active)]
dormant_names = other_names[NUM_ENTITIES_ACTIVE - len(must_be_active):]
rng.shuffle(active_names)  # so pinned names land at plausible, not-rank-1 volume slots

assert len(active_names) == NUM_ENTITIES_ACTIVE
assert len(dormant_names) == NUM_ENTITIES_DORMANT

# Assign volumes: keep Cedar Row modest (so the ~$690 shortfall in section 5
# looks proportionally alarming) and keep the Marrow Point pair mid-sized
# (so the misrouted rent payment is a visible dollar amount, not noise).
volume_ranks = list(range(NUM_ENTITIES_ACTIVE))
cedar_idx = active_names.index(cedar_row_name)
marrow_old_idx = active_names.index(marrow_old_name)
marrow_new_idx = active_names.index(marrow_new_name)

# swap Cedar Row into a modest rank (~rank 50) and the Marrow Point pair into
# adjacent mid-tier ranks (~rank 18/19), then shuffle the remainder freely
forced_rank_for = {cedar_idx: 49, marrow_old_idx: 17, marrow_new_idx: 18}
free_indices = [i for i in range(NUM_ENTITIES_ACTIVE) if i not in forced_rank_for]
free_ranks = [r for r in range(NUM_ENTITIES_ACTIVE) if r not in forced_rank_for.values()]
rng.shuffle(free_ranks)
rank_for_index = dict(forced_rank_for)
for idx, r in zip(free_indices, free_ranks):
    rank_for_index[idx] = r

entities = []
for i, name in enumerate(active_names):
    rank = rank_for_index[i]
    volume = VOLUME_CURVE_CENTS[rank]
    avg_rent = round(rng.uniform(AVG_RENT_CENTS * 0.92, AVG_RENT_CENTS * 1.08))
    home_count = max(3, round(volume / avg_rent / 0.936))  # ~93.6% pay rate -> volume
    entities.append({
        "id": f"ent_{i+1:03d}",
        "connected_account_id": demo_id("acct"),
        "name": name,
        "fund_family": fund_family_of(name),
        "market": MARKETS[i % len(MARKETS)],
        "status": "active",
        "monthly_volume_target_cents": volume,
        "home_count": home_count,
        "avg_rent_cents": avg_rent,
        "stale_bank_details": False,
    })

# rescale active home counts to hit ACTIVE_HOMES_TARGET exactly
_home_sum = sum(e["home_count"] for e in entities)
_scale = ACTIVE_HOMES_TARGET / _home_sum
for e in entities:
    e["home_count"] = max(3, round(e["home_count"] * _scale))
_drift = ACTIVE_HOMES_TARGET - sum(e["home_count"] for e in entities)
entities[max(range(len(entities)), key=lambda i: entities[i]["home_count"])]["home_count"] += _drift

# dormant entities: no current-month activity, but meaningful lifetime volume
for j, name in enumerate(dormant_names):
    lifetime_monthly_equiv = round(rng.uniform(80_000_00, 900_000_00))
    tenure_months = rng.randint(14, 46)
    entities.append({
        "id": f"ent_{NUM_ENTITIES_ACTIVE + j + 1:03d}",
        "connected_account_id": demo_id("acct"),
        "name": name,
        "fund_family": fund_family_of(name),
        "market": MARKETS[(NUM_ENTITIES_ACTIVE + j) % len(MARKETS)],
        "status": "dormant",
        "monthly_volume_target_cents": 0,
        "home_count": rng.randint(15, 220),
        "avg_rent_cents": round(rng.uniform(AVG_RENT_CENTS * 0.9, AVG_RENT_CENTS * 1.1)),
        "stale_bank_details": False,
        "lifetime_volume_cents": lifetime_monthly_equiv * tenure_months,
    })

by_name = {e["name"]: e for e in entities}
active_entities = [e for e in entities if e["status"] == "active"]

for e in active_entities:
    e["lifetime_volume_cents"] = e["monthly_volume_target_cents"] * rng.randint(9, 40)

# ---------------------------------------------------------------------------
# Step 3 - assign roles for the seeded exceptions to specific active entities
# ---------------------------------------------------------------------------

cedar_row = by_name[cedar_row_name]
e_old = by_name[marrow_old_name]
e_new = by_name[marrow_new_name]

remaining = [e for e in active_entities if e["id"] not in {cedar_row["id"], e_old["id"], e_new["id"]}]
rng.shuffle(remaining)

e_stale = remaining[0]                     # payout failed / stale bank details
e_nsf = remaining[1:4]                      # 3 entities sharing 4 NSF instances (2+1+1)
e_appfee = remaining[4:7]                   # 3 entities, application-fee misroute
e_short = [cedar_row] + remaining[7:13]     # 7 entities total for short payments
e_dup = remaining[13:15]                    # 2 entities, duplicate payment

e_stale["stale_bank_details"] = True

# ---------------------------------------------------------------------------
# Step 4 - property ownership churn: previous_entity_id / ownership_effective_date
# ---------------------------------------------------------------------------
# Populated only for the small subset of properties that actually changed
# hands - specifically the property cited by the stale-mapping exception.

OWNERSHIP_EFFECTIVE_DATE = (TODAY - timedelta(days=14)).isoformat()

# ---------------------------------------------------------------------------
# Step 5 - generate active-entity rent charges (in memory) and roll up per entity
# ---------------------------------------------------------------------------

property_seq = 0
citations = {}
exceptions = []
waiver_pool_source = []  # (entity_id, gross_cents) for card/wallet-paying leases

entity_rollup = {e["id"]: {
    "expected_rent_cents": 0,
    "collected_cents": 0,
    "settled_cents": 0,
    "fee_cents": 0,
    "ach_count": 0,
    "card_count": 0,
    "wallet_count": 0,
    "card_domestic_volume_cents": 0,
    "card_international_volume_cents": 0,
    "wallet_volume_cents": 0,
    "ach_volume_cents": 0,
    "variance_adjustment": 0,
} for e in entities}


def next_property():
    global property_seq
    property_seq += 1
    return {
        "property_id": seq_id("prop", property_seq),
        "lease_id": seq_id("lease", property_seq),
        "resident_id": seq_id("res", property_seq),
    }


def pick_payment_method():
    x = rng.random()
    if x < PAYMENT_MIX["ach"]:
        return "ach"
    elif x < PAYMENT_MIX["ach"] + PAYMENT_MIX["card"]:
        return "card"
    return "wallet"


def fee_for(method, gross_cents):
    """Returns (fee_cents, is_international). Wallet is priced as domestic card (assumption)."""
    if method == "ach":
        return min(round(gross_cents * ACH_BPS / 10_000), ACH_CAP_CENTS), False
    is_intl = method == "card" and rng.random() < CARD_INTERNATIONAL_SHARE
    if is_intl:
        return round(gross_cents * CARD_INTERNATIONAL_BPS / 10_000) + CARD_INTERNATIONAL_FIXED_CENTS, True
    return round(gross_cents * CARD_DOMESTIC_BPS / 10_000) + CARD_DOMESTIC_FIXED_CENTS, False


def make_charge(entity_id, gross_cents, method, days_ago=6, prev_entity_id=None):
    """Destination charge: platform is merchant of record, funds transfer immediately to the
    connected account net of fee (fee netted from the investor transfer, per the named
    FEE_NETTED_FROM_INVESTOR_TRANSFER assumption)."""
    fee_cents, is_intl = fee_for(method, gross_cents)
    net_cents = gross_cents - fee_cents
    p = next_property()
    metadata = {
        "property_id": p["property_id"],
        "lease_id": p["lease_id"],
        "resident_id": p["resident_id"],
    }
    if prev_entity_id:
        metadata["previous_entity_id"] = prev_entity_id
        metadata["ownership_effective_date"] = OWNERSHIP_EFFECTIVE_DATE
    charge = {
        "id": demo_id("ch"),
        "type": "charge",
        "gross_amount_cents": gross_cents,
        "fee_cents": fee_cents,
        "net_amount_cents": net_cents,
        "currency": "usd",
        "status": "succeeded",
        "payment_method_type": method,
        "card_region": ("international" if is_intl else "domestic") if method in ("card", "wallet") else None,
        "destination": entity_id,
        "transfer_data": {"destination": entity_id, "amount_cents": net_cents},
        "date": (TODAY - timedelta(days=days_ago)).isoformat(),
        "metadata": metadata,
    }
    citations[charge["id"]] = charge
    return charge


def make_payout(entity_id, amount_cents, status="paid", days_ago=2):
    payout = {
        "id": demo_id("po"),
        "type": "payout",
        "amount_cents": amount_cents,
        "status": status,
        "arrival_date": (TODAY - timedelta(days=days_ago)).isoformat(),
        "destination": entity_id,
    }
    citations[payout["id"]] = payout
    return payout


def make_refund(charge_id, amount_cents, reason, days_ago=1):
    refund = {
        "id": demo_id("re"),
        "type": "refund",
        "charge_id": charge_id,
        "amount_cents": amount_cents,
        "reason": reason,
        "date": (TODAY - timedelta(days=days_ago)).isoformat(),
    }
    citations[refund["id"]] = refund
    return refund


for e in active_entities:
    roll = entity_rollup[e["id"]]
    target = e["monthly_volume_target_cents"]
    home_count = e["home_count"]
    n_charges = max(1, round(home_count * (ACTIVE_CHARGES_TARGET / ACTIVE_HOMES_TARGET)))
    avg_charge = target / n_charges
    raw_amounts = [max(30_000, round(rng.gauss(avg_charge, avg_charge * 0.12))) for _ in range(n_charges)]
    rescale = target / sum(raw_amounts)
    amounts = [round(a * rescale) for a in raw_amounts]
    drift = target - sum(amounts)
    amounts[0] += drift

    roll["expected_rent_cents"] += home_count * e["avg_rent_cents"]

    for gross in amounts:
        method = pick_payment_method()
        fee_cents, is_intl = fee_for(method, gross)
        net = gross - fee_cents
        roll["collected_cents"] += gross
        roll["settled_cents"] += net
        roll["fee_cents"] += fee_cents
        if method == "ach":
            roll["ach_count"] += 1
            roll["ach_volume_cents"] += gross
        elif method == "card":
            roll["card_count"] += 1
            if is_intl:
                roll["card_international_volume_cents"] += gross
            else:
                roll["card_domestic_volume_cents"] += gross
            waiver_pool_source.append((e["id"], gross))
        else:
            roll["wallet_count"] += 1
            roll["wallet_volume_cents"] += gross
            waiver_pool_source.append((e["id"], gross))

# ---------------------------------------------------------------------------
# Step 6 - layer the six seeded exception types on top of the rollups
# ---------------------------------------------------------------------------

exc_seq = 0


def next_exc_id():
    global exc_seq
    exc_seq += 1
    return f"exc_{exc_seq:02d}"


# --- 1. NSF return after payout already settled (4 instances, spread 2/1/1) ---
nsf_counts = [2, 1, 1]
for ent, count in zip(e_nsf, nsf_counts):
    for _ in range(count):
        amount = round(rng.uniform(1_400, 2_600)) * 100
        ch = make_charge(ent["id"], amount, "ach", days_ago=9)
        po = make_payout(ent["id"], entity_rollup[ent["id"]]["settled_cents"], days_ago=3)
        re = make_refund(ch["id"], amount, "ach_return_nsf", days_ago=1)
        entity_rollup[ent["id"]]["variance_adjustment"] += amount  # cash already disbursed exceeds true entitlement
        exceptions.append({
            "id": next_exc_id(),
            "type": "nsf_after_payout",
            "severity": "critical",
            "entity_id": ent["id"],
            "entity_name": ent["name"],
            "impact_cents": amount,
            "impact_direction": "over",
            "explanation": f"A resident's ACH rent payment of ${amount/100:,.2f} failed as an NSF return after {ent['name']} had already been paid out, leaving the entity over-funded.",
            "disposition": f"Net the ${amount/100:,.2f} NSF return against {ent['name']}'s next scheduled payout rather than requesting funds back.",
            "citations": [ch["id"], po["id"], re["id"]],
            "status": "open",
        })

# --- 2. Payment routed to the prior owner's connected account (2 instances) ---
for _ in range(2):
    amount = round(rng.uniform(1_800, 2_400)) * 100
    ch = make_charge(e_old["id"], amount, "ach", days_ago=11, prev_entity_id=None)
    ch["metadata"]["previous_entity_id"] = e_old["id"]
    ch["metadata"]["ownership_effective_date"] = OWNERSHIP_EFFECTIVE_DATE
    entity_rollup[e_old["id"]]["variance_adjustment"] += amount
    entity_rollup[e_new["id"]]["variance_adjustment"] -= amount
    exceptions.append({
        "id": next_exc_id(),
        "type": "stale_mapping",
        "severity": "high",
        "entity_id": e_new["id"],
        "entity_name": e_new["name"],
        "counterparty_entity_id": e_old["id"],
        "counterparty_entity_name": e_old["name"],
        "impact_cents": amount,
        "impact_direction": "under",
        "explanation": f"Property {ch['metadata']['property_id']} moved from {e_old['name']} to {e_new['name']} on {OWNERSHIP_EFFECTIVE_DATE}, but the ${amount/100:,.2f} rent payment still followed the stale mapping to {e_old['name']}.",
        "disposition": f"Move ${amount/100:,.2f} from {e_old['name']} to {e_new['name']} and update the connected-account mapping for {ch['metadata']['property_id']} so next month routes correctly.",
        "citations": [ch["id"]],
        "status": "open",
    })

# --- 3. Application fee mis-routed to an investor entity (3 instances) ---
for ent in e_appfee:
    ch = make_charge(ent["id"], APPLICATION_FEE_CENTS, "card", days_ago=5)
    entity_rollup[ent["id"]]["variance_adjustment"] += APPLICATION_FEE_CENTS
    exceptions.append({
        "id": next_exc_id(),
        "type": "app_fee_misroute",
        "severity": "low",
        "entity_id": ent["id"],
        "entity_name": ent["name"],
        "impact_cents": APPLICATION_FEE_CENTS,
        "impact_direction": "over",
        "explanation": f"A $75 rental application fee landed on {ent['name']}'s connected account instead of the property manager's own account.",
        "disposition": f"Transfer ${APPLICATION_FEE_CENTS/100:,.2f} from {ent['name']} to the property manager's operating account.",
        "citations": [ch["id"]],
        "status": "open",
    })

# --- 4. Short payment against the rent roll (7 instances) ---
for ent in e_short:
    full = round(rng.uniform(1_800, 2_400)) * 100
    shortfall = round(full * rng.uniform(0.15, 0.45))
    paid = full - shortfall
    ch = make_charge(ent["id"], paid, "ach", days_ago=7)
    entity_rollup[ent["id"]]["variance_adjustment"] -= shortfall
    exceptions.append({
        "id": next_exc_id(),
        "type": "short_payment",
        "severity": "medium",
        "entity_id": ent["id"],
        "entity_name": ent["name"],
        "impact_cents": shortfall,
        "impact_direction": "under",
        "explanation": f"A resident paid ${paid/100:,.2f} against a ${full/100:,.2f} lease amount, leaving {ent['name']} short ${shortfall/100:,.2f} against the rent roll.",
        "disposition": f"Flag the ${shortfall/100:,.2f} shortfall to the resident's ledger for collection next cycle; do not adjust {ent['name']}'s statement.",
        "citations": [ch["id"]],
        "status": "open",
    })

# --- 5. Duplicate resident payment (2 instances) ---
for ent in e_dup:
    amount = round(rng.uniform(1_800, 2_400)) * 100
    ch1 = make_charge(ent["id"], amount, "card", days_ago=8)
    p2 = next_property()
    fee2, is_intl2 = fee_for("card", amount)
    ch2 = {
        "id": demo_id("ch"), "type": "charge", "gross_amount_cents": amount,
        "fee_cents": fee2, "net_amount_cents": amount - fee2, "currency": "usd",
        "status": "succeeded", "payment_method_type": "card",
        "card_region": "international" if is_intl2 else "domestic",
        "destination": ent["id"],
        "transfer_data": {"destination": ent["id"], "amount_cents": amount - fee2},
        "date": ch1["date"],
        "metadata": {"property_id": ch1["metadata"]["property_id"], "lease_id": ch1["metadata"]["lease_id"],
                     "resident_id": ch1["metadata"]["resident_id"]},
    }
    citations[ch2["id"]] = ch2
    entity_rollup[ent["id"]]["variance_adjustment"] += amount
    exceptions.append({
        "id": next_exc_id(),
        "type": "duplicate_payment",
        "severity": "medium",
        "entity_id": ent["id"],
        "entity_name": ent["name"],
        "impact_cents": amount,
        "impact_direction": "over",
        "explanation": f"The same resident's ${amount/100:,.2f} rent payment was charged twice, minutes apart, on the same lease.",
        "disposition": f"Refund the duplicate ${amount/100:,.2f} charge to the resident; leave the original payment to {ent['name']} untouched.",
        "citations": [ch1["id"], ch2["id"]],
        "status": "open",
    })

# --- 6. Payout failed and returned (1 instance, most urgent - blocks the 10th) ---
stale_amount = entity_rollup[e_stale["id"]]["settled_cents"]
po = make_payout(e_stale["id"], stale_amount, status="failed", days_ago=2)
days_until_cutoff = (INITIATE_CUTOFF - TODAY).days
unrecoverable = days_until_cutoff < UNRECOVERABLE_THRESHOLD_DAYS
exceptions.append({
    "id": next_exc_id(),
    "type": "payout_failed",
    "severity": "critical",
    "entity_id": e_stale["id"],
    "entity_name": e_stale["name"],
    "impact_cents": stale_amount,
    "impact_direction": "blocked",
    "unrecoverable_by_deadline": unrecoverable,
    "explanation": f"{e_stale['name']}'s payout of ${stale_amount/100:,.2f} was returned due to stale bank account details on file, blocking funding for the entire entity.",
    "disposition": (
        f"Bank detail verification typically takes {BANK_DETAIL_VERIFICATION_DAYS} business days; with only "
        f"{days_until_cutoff} day(s) left before the {INITIATE_CUTOFF.isoformat()} initiate cutoff, this entity is "
        f"unlikely to clear by the 10th even if contacted today. Escalate immediately and set expectations with the investor."
        if unrecoverable else
        f"Contact {e_stale['name']} today to confirm updated bank details and reinitiate the payout before {INITIATE_CUTOFF.isoformat()} to still land by the 10th."
    ),
    "citations": [po["id"]],
    "status": "open",
})
entity_rollup[e_stale["id"]]["variance_adjustment"] -= stale_amount  # fully blocked from funding
entity_rollup[e_stale["id"]]["settled_cents"] = 0  # funds are stuck, not settled

# ---------------------------------------------------------------------------
# Step 7 - application fees (bulk, non-exception) to the PM's own account
# ---------------------------------------------------------------------------

NUM_APPLICATIONS = 460
for _ in range(NUM_APPLICATIONS - len(e_appfee)):
    ch = make_charge(PM_ACCOUNT_ID, APPLICATION_FEE_CENTS, "card", days_ago=rng.randint(1, 28))

# ---------------------------------------------------------------------------
# Step 8 - fee waivers (current period), weighted by each entity's card/wallet volume
# ---------------------------------------------------------------------------

waivers = []
sampled = rng.sample(waiver_pool_source, k=min(TARGET_WAIVER_COUNT, len(waiver_pool_source)))
market_by_entity = {e["id"]: e["market"] for e in entities}
for i, (entity_id, rent) in enumerate(sampled):
    fee_cents, is_intl = fee_for("card", rent)  # waivers are card/wallet payers; wallet priced as card
    waivers.append({
        "id": seq_id("wv", i + 1),
        "entity_id": entity_id,
        "market": market_by_entity[entity_id],
        "amount_cents": rent,
        "fee_cents": fee_cents,
        "prior_failure": rng.random() < WAIVER_PRIOR_FAILURE_RATE,
        "date": (TODAY - timedelta(days=rng.randint(1, 30))).isoformat(),
    })

current_waiver_count = len(waivers)
current_waiver_total_cents = sum(w["fee_cents"] for w in waivers)

# ---------------------------------------------------------------------------
# Step 9 - 12-month histories (11 synthetic prior months + derived current month)
# ---------------------------------------------------------------------------


def month_label(offset_from_current):
    m = MODEL_MONTH - offset_from_current
    y = MODEL_YEAR
    while m <= 0:
        m += 12
        y -= 1
    return f"{y}-{m:02d}"


waiver_history = []
base = current_waiver_count * 0.55
for k in range(11, 0, -1):
    trend = base + (current_waiver_count - base) * ((11 - k) / 10) * 0.9
    jitter = rng.uniform(-0.05, 0.05) * trend
    count = max(50, round(trend + jitter))
    total = round(count * (current_waiver_total_cents / current_waiver_count))
    waiver_history.append({"month": month_label(k), "count": count, "total_cents": total})
waiver_history.append({"month": month_label(0), "count": current_waiver_count, "total_cents": current_waiver_total_cents})

total_collected_cents = sum(r["collected_cents"] for r in entity_rollup.values())
total_settled_cents = sum(r["settled_cents"] for r in entity_rollup.values())

exceptions_count_by_month_base = len(exceptions)
collection_history = []
for k in range(11, 0, -1):
    factor = rng.uniform(0.94, 1.03)
    exc_factor = rng.uniform(0.6, 1.4)
    collection_history.append({
        "month": month_label(k),
        "total_collected_cents": round(total_collected_cents * factor),
        "total_settled_cents": round(total_settled_cents * factor),
        "exception_count": max(5, round(exceptions_count_by_month_base * exc_factor)),
    })
collection_history.append({
    "month": month_label(0),
    "total_collected_cents": total_collected_cents,
    "total_settled_cents": total_settled_cents,
    "exception_count": len(exceptions),
})

# ---------------------------------------------------------------------------
# Step 10 - finalize entity rollups
# ---------------------------------------------------------------------------

exceptions_by_entity = {}
for exc in exceptions:
    exceptions_by_entity.setdefault(exc["entity_id"], []).append(exc["id"])
    if "counterparty_entity_id" in exc:
        exceptions_by_entity.setdefault(exc["counterparty_entity_id"], []).append(exc["id"])

output_entities = []
for e in entities:
    roll = entity_rollup[e["id"]]
    exc_ids = exceptions_by_entity.get(e["id"], [])
    is_active = e["status"] == "active"
    variance_cents = round(roll["variance_adjustment"]) if is_active else 0
    funding_risk = "on_track"
    if e["stale_bank_details"]:
        blocked_exc = next((x for x in exceptions if x.get("entity_id") == e["id"] and x["type"] == "payout_failed"), None)
        funding_risk = "unrecoverable" if (blocked_exc and blocked_exc.get("unrecoverable_by_deadline")) else "at_risk"
    output_entities.append({
        "id": e["id"],
        "connected_account_id": e["connected_account_id"],
        "name": e["name"],
        "fund_family": e["fund_family"],
        "market": e["market"],
        "status": e["status"],
        "in_reconciliation_scope": is_active,
        "home_count": e["home_count"],
        "lifetime_volume_cents": e["lifetime_volume_cents"],
        "stale_bank_details": e["stale_bank_details"],
        "expected_rent_cents": roll["expected_rent_cents"] if is_active else 0,
        "collected_cents": roll["collected_cents"] if is_active else 0,
        "settled_cents": roll["settled_cents"] if is_active else 0,
        "fee_cents": roll["fee_cents"] if is_active else 0,
        "in_flight_cents": max(0, roll["collected_cents"] - roll["settled_cents"]) if is_active else 0,
        "variance_cents": variance_cents,
        "exception_ids": exc_ids if is_active else [],
        "reconciled": (len(exc_ids) == 0) if is_active else None,
        "payout_status": "failed" if e["stale_bank_details"] else ("paid" if is_active else "n/a"),
        "funding_risk": funding_risk if is_active else "n/a",
        "account_config": ACCOUNT_CONFIG,
    })

reconciled_count = sum(1 for e in output_entities if e["reconciled"])
no_prior_failure_count = sum(1 for w in waivers if not w["prior_failure"])

# ---------------------------------------------------------------------------
# Step 11 - Margin: headline absorbed cost + secondary "ceiling" figure
# ---------------------------------------------------------------------------

total_card_volume_cents = sum(r["card_domestic_volume_cents"] + r["card_international_volume_cents"] for r in entity_rollup.values())
total_card_domestic_volume_cents = sum(r["card_domestic_volume_cents"] for r in entity_rollup.values())
total_card_international_volume_cents = sum(r["card_international_volume_cents"] for r in entity_rollup.values())
total_wallet_volume_cents = sum(r["wallet_volume_cents"] for r in entity_rollup.values())
total_ach_volume_cents = sum(r["ach_volume_cents"] for r in entity_rollup.values())

# ceiling = if every card fee (and, secondarily, every wallet fee) were absorbed rather than
# waived selectively - computed directly from the generated per-charge fee rates, not hardcoded.
ceiling_card_fee_cents = sum(
    (round(r["card_domestic_volume_cents"] * CARD_DOMESTIC_BPS / 10_000) +
     round(r["card_international_volume_cents"] * CARD_INTERNATIONAL_BPS / 10_000))
    for r in entity_rollup.values()
)
ceiling_wallet_fee_cents = round(total_wallet_volume_cents * CARD_DOMESTIC_BPS / 10_000)

margin_ceiling = {
    "card_volume_cents": total_card_volume_cents,
    "wallet_volume_cents": total_wallet_volume_cents,
    "ceiling_card_only_cents_month": ceiling_card_fee_cents,
    "ceiling_card_only_cents_year": ceiling_card_fee_cents * 12,
    "ceiling_with_wallet_cents_month": ceiling_card_fee_cents + ceiling_wallet_fee_cents,
    "ceiling_with_wallet_cents_year": (ceiling_card_fee_cents + ceiling_wallet_fee_cents) * 12,
}

# ---------------------------------------------------------------------------
# Step 11.5 - resident/lease-level detail, for the Residents view
# ---------------------------------------------------------------------------
# Every field here maps to a real, documented Stripe/Sigma table
# (https://docs.stripe.com/data/schema), illustrated on a fixed-size sample
# rather than the full ~47,000-home portfolio:
#   lease            -> subscriptions (id, customer_id, status, created)
#   resident         -> customers (id)
#   rent payment     -> invoices (due_date, period_start/end) + charges
#                       (id, created, status, payment_method_type)
#   late/on-time     -> charges.created vs. invoices.due_date
#   NSF/failed rent  -> charges.status='failed' / refunds.reason='ach_return_nsf'
#                       (same return type already modeled in Step 6 above)
#   security deposit -> invoice_items (a one-time, non-subscription item)
#   deposit refund   -> refunds (at move-out)
#   lease renewal /
#   rent increase    -> subscription_item_change_events (event_type
#                       'ACTIVE_UPGRADE', mrr_change)
#   rent disputed    -> disputes (charge_id, amount, reason)

NUM_RESIDENTS_SAMPLE = 480
HISTORY_MONTHS = 6

resident_entity_weights = [(e, e["home_count"]) for e in active_entities]
_weight_total = sum(w for _, w in resident_entity_weights)


def pick_weighted_entity():
    x = rng.uniform(0, _weight_total)
    acc = 0
    for e, w in resident_entity_weights:
        acc += w
        if x <= acc:
            return e
    return resident_entity_weights[-1][0]


def build_payment_history(method, tenure_months):
    months = min(HISTORY_MONTHS, max(1, tenure_months))
    late_prob = 0.16 * (0.85 if method == "card" else 1.0 if method == "wallet" else 1.05)
    failed_prob = 0.035 * (1.4 if method == "ach" else 0.6)
    history = []
    for k in range(months - 1, -1, -1):
        m = MODEL_MONTH - k
        y = MODEL_YEAR
        while m <= 0:
            m += 12
            y -= 1
        month_label = f"{y}-{m:02d}"
        x = rng.random()
        if x < failed_prob:
            status, days_late = "failed", None
        elif x < failed_prob + late_prob:
            status, days_late = "late", rng.choice([rng.randint(1, 5), rng.randint(6, 20)])
        else:
            status, days_late = "on_time", 0
        history.append({"month": month_label, "status": status, "days_late": days_late})
    return history


output_residents = []
for i in range(NUM_RESIDENTS_SAMPLE):
    entity = pick_weighted_entity()
    method = pick_payment_method()
    monthly_rent_cents = round(entity["avg_rent_cents"] * rng.uniform(0.85, 1.15))
    tenure_months = rng.randint(1, 48)
    history = build_payment_history(method, tenure_months)

    vacated = tenure_months >= 6 and rng.random() < 0.08
    renewed = (not vacated) and tenure_months >= 12 and rng.random() < 0.6
    rent_increase_pct = None
    if renewed:
        rent_increase_pct = round(rng.uniform(0.02, 0.08), 4)

    deposit_cents = round(monthly_rent_cents * rng.choice([1.0, 1.0, 1.0, 1.5]))
    deposit_refunded_cents = None
    if vacated:
        deduction_frac = rng.uniform(0.0, 0.4)
        deposit_refunded_cents = round(deposit_cents * (1 - deduction_frac))

    disputed = rng.random() < 0.006

    output_residents.append({
        "resident_id": seq_id("res_sample", i + 1, width=4),
        "lease_id": seq_id("lease_sample", i + 1, width=4),
        "entity_id": entity["id"],
        "entity_name": entity["name"],
        "market": entity["market"],
        "payment_method_type": method,
        "monthly_rent_cents": monthly_rent_cents,
        "tenure_months": tenure_months,
        "lease_status": "vacated" if vacated else ("renewed" if renewed else "active"),
        "rent_increase_pct": rent_increase_pct,
        "security_deposit_cents": deposit_cents,
        "security_deposit_refunded_cents": deposit_refunded_cents,
        "disputed": disputed,
        "payment_history": history,
    })

resident_sample_note = (
    f"Resident/lease detail on the Residents view is illustrated on a sample of "
    f"{NUM_RESIDENTS_SAMPLE} synthetic leases (of ~{ACTIVE_HOMES_TARGET:,} homes under "
    f"management), weighted by entity size - figures there are proportionally "
    f"representative, not full-portfolio counts."
)

# ---------------------------------------------------------------------------
# Step 12 - assumptions panel (always visible on screen, per finance-audience review)
# ---------------------------------------------------------------------------

ASSUMPTIONS = [
    f"Card pricing: {CARD_DOMESTIC_BPS/100:.2f}% + ${CARD_DOMESTIC_FIXED_CENTS/100:.2f} domestic, "
    f"{CARD_INTERNATIONAL_BPS/100:.2f}% + ${CARD_INTERNATIONAL_FIXED_CENTS/100:.2f} international - negotiated rate, verified.",
    f"ACH pricing: {ACH_BPS/100:.2f}%, capped at ${ACH_CAP_CENTS/100:.2f} - unverified placeholder, not confirmed.",
    f"International card share: {CARD_INTERNATIONAL_SHARE*100:.0f}% of card volume - unverified estimate.",
    "Digital wallet payments are priced identically to domestic card - assumption, not a Stripe-verified rate.",
    "The processing fee is modeled as netted from the investor's transfer, not absorbed by the operator - unconfirmed assumption.",
    "All entity names, resident IDs, property IDs, and dollar amounts are synthetic.",
    resident_sample_note,
]

# ---------------------------------------------------------------------------
# Step 13 - assemble and write output
# ---------------------------------------------------------------------------

data = {
    "meta": {
        "seed": SEED,
        "model_month": f"{MODEL_YEAR}-{MODEL_MONTH:02d}",
        "model_month_label": MODEL_MONTH_LABEL,
        "today": TODAY.isoformat(),
        "target_day": TARGET_DAY.isoformat(),
        "initiate_cutoff": INITIATE_CUTOFF.isoformat(),
        "days_remaining": (TARGET_DAY - TODAY).days,
        "days_until_initiate_cutoff": days_until_cutoff,
        "bank_detail_verification_days": BANK_DETAIL_VERIFICATION_DAYS,
        "total_homes_modeled": ACTIVE_HOMES_TARGET,
        "total_charges_modeled": ACTIVE_CHARGES_TARGET,
        "num_entities_total": NUM_ENTITIES,
        "num_entities_active": NUM_ENTITIES_ACTIVE,
        "num_entities_dormant": NUM_ENTITIES_DORMANT,
        "pm_account_id": PM_ACCOUNT_ID,
        "fee_assumptions": {
            "card_domestic_bps": CARD_DOMESTIC_BPS,
            "card_domestic_fixed_cents": CARD_DOMESTIC_FIXED_CENTS,
            "card_international_bps": CARD_INTERNATIONAL_BPS,
            "card_international_fixed_cents": CARD_INTERNATIONAL_FIXED_CENTS,
            "card_international_share": CARD_INTERNATIONAL_SHARE,
            "card_pricing_verified": True,
            "ach_bps": ACH_BPS,
            "ach_cap_cents": ACH_CAP_CENTS,
            "ach_pricing_verified": False,
            "wallet_priced_as_card": WALLET_PRICED_AS_CARD,
            "fee_netted_from_investor_transfer": FEE_NETTED_FROM_INVESTOR_TRANSFER,
            "note": "Card pricing is this operator's negotiated Connect rate, effective 2024-05-09. ACH pricing and the international card share are unverified placeholders, flagged here and in the assumptions panel.",
        },
        "payment_mix": PAYMENT_MIX,
        "application_fee_cents": APPLICATION_FEE_CENTS,
        "account_config": ACCOUNT_CONFIG,
        "assumptions": ASSUMPTIONS,
    },
    "totals": {
        "total_collected_cents": total_collected_cents,
        "total_settled_cents": total_settled_cents,
        "total_in_flight_cents": max(0, total_collected_cents - total_settled_cents),
        "total_fee_cents": sum(r["fee_cents"] for r in entity_rollup.values()),
        "entities_total": NUM_ENTITIES,
        "entities_active": NUM_ENTITIES_ACTIVE,
        "entities_dormant": NUM_ENTITIES_DORMANT,
        "entities_reconciled_initial": reconciled_count,
        "card_volume_cents": total_card_volume_cents,
        "card_domestic_volume_cents": total_card_domestic_volume_cents,
        "card_international_volume_cents": total_card_international_volume_cents,
        "wallet_volume_cents": total_wallet_volume_cents,
        "ach_volume_cents": total_ach_volume_cents,
    },
    "entities": output_entities,
    "exceptions": exceptions,
    "citations": citations,
    "waivers": waivers,
    "waiver_current_period": {
        "count": current_waiver_count,
        "total_cents": current_waiver_total_cents,
        "no_prior_failure_count": no_prior_failure_count,
    },
    "waiver_history": waiver_history,
    "collection_history": collection_history,
    "margin_ceiling": margin_ceiling,
    "residents": output_residents,
    "resident_sample_size": NUM_RESIDENTS_SAMPLE,
}

with open("web/data/reconciliation.json", "w") as f:
    json.dump(data, f, indent=2)

print(f"Wrote web/data/reconciliation.json")
print(f"Entities: {NUM_ENTITIES} ({NUM_ENTITIES_ACTIVE} active, {NUM_ENTITIES_DORMANT} dormant) | Exceptions: {len(exceptions)} | Waivers: {len(waivers)}")
print(f"Active volume target: ${TOTAL_ACTIVE_VOLUME_CENTS/100:,.2f} | Actual collected: ${total_collected_cents/100:,.2f}")
print(f"Total settled: ${total_settled_cents/100:,.2f}")
print(f"Reconciled at start: {reconciled_count} of {NUM_ENTITIES_ACTIVE}")
print(f"Payment mix (actual): ACH {total_ach_volume_cents/total_collected_cents*100:.1f}% | Card {total_card_volume_cents/total_collected_cents*100:.1f}% | Wallet {total_wallet_volume_cents/total_collected_cents*100:.1f}%")
_effective_domestic_fee_cents = sum(round(r["card_domestic_volume_cents"] * CARD_DOMESTIC_BPS / 10_000) for r in entity_rollup.values())
print(f"Effective domestic card rate: {(_effective_domestic_fee_cents/total_card_domestic_volume_cents*100) if total_card_domestic_volume_cents else 0:.2f}%")
print(f"Current-period waiver total: ${current_waiver_total_cents/100:,.2f} across {current_waiver_count} waivers")
print(f"Annualized waiver headline: ${current_waiver_total_cents*12/100:,.2f}")
print(f"Margin ceiling (card only): ${ceiling_card_fee_cents/100:,.2f}/mo -> ${ceiling_card_fee_cents*12/100:,.2f}/yr")
print(f"Margin ceiling (incl wallet): ${(ceiling_card_fee_cents+ceiling_wallet_fee_cents)/100:,.2f}/mo -> ${(ceiling_card_fee_cents+ceiling_wallet_fee_cents)*12/100:,.2f}/yr")
