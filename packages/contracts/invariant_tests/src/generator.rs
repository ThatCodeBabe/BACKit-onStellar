//! Seeded, deterministic action-sequence generator.
//!
//! A tiny linear-congruential generator (`Lcg`) provides reproducible
//! pseudo-randomness without any external crate.  Every test that uses this
//! module prints the seed on failure so the sequence can be reproduced.
//!
//! ```text
//! INVARIANT FAILURE – reproduce with seed: 0xDEADBEEF_CAFEBABE
//! ```

// ─── Minimal LCG RNG ──────────────────────────────────────────────────────────

/// Linear-congruential generator (Knuth MMIX parameters).
#[derive(Clone)]
pub struct Lcg {
    pub state: u64,
}

impl Lcg {
    /// Create a new generator from a 64-bit seed.
    pub fn new(seed: u64) -> Self {
        Lcg { state: seed }
    }

    /// Advance the state and return the next u64.
    pub fn next_u64(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.state
    }

    /// Return a value in `[0, upper)`.
    pub fn next_range(&mut self, upper: u64) -> u64 {
        if upper == 0 {
            return 0;
        }
        self.next_u64() % upper
    }

    /// Return a bool with given probability numerator / 256.
    pub fn bool_prob(&mut self, numerator: u8) -> bool {
        (self.next_u64() & 0xFF) < numerator as u64
    }
}

// ─── Action types ─────────────────────────────────────────────────────────────

/// An action that can be applied to the reference model and/or contract.
#[derive(Debug, Clone)]
pub enum Action {
    CreateCall {
        call_id_hint: u64, // expected id (sequential)
        creator: usize,    // index into address pool
        stake_amount: i128,
        end_ts: u64,
        outcome_count: u32,
    },
    Stake {
        call_id: u64,
        staker: usize,
        amount: i128,
        outcome: u32,
    },
    CancelCall {
        call_id: u64,
        creator: usize,
    },
    VoidCall {
        call_id: u64,
    },
    ResolveCall {
        call_id: u64,
        outcome: u32,
        now: u64,
    },
    MarkSettled {
        call_id: u64,
    },
    ClaimPayout {
        call_id: u64,
        staker: usize,
    },
    ClaimVoidRefund {
        call_id: u64,
        staker: usize,
    },
    ClaimExpiredRefund {
        call_id: u64,
        staker: usize,
        now: u64,
    },
    CreateFutures {
        call_id: u64,
        creator: usize,
        outcome: u32,
        strike_probability_bps: u32,
        expiry_ts: u64,
        margin_requirement: i128,
        now: u64,
    },
    AcceptFutures {
        contract_id: u64,
        counterparty: usize,
        now: u64,
    },
    SettleFutures {
        contract_id: u64,
        now: u64,
    },
}

// ─── Sequence generation ──────────────────────────────────────────────────────

/// Context used while generating a sequence.
struct GenCtx {
    rng: Lcg,
    num_actors: usize,
    base_ts: u64,
}

impl GenCtx {
    fn actor(&mut self) -> usize {
        self.rng.next_range(self.num_actors as u64) as usize
    }

    fn outcome(&mut self, count: u32) -> u32 {
        (self.rng.next_range(count as u64) as u32) + 1
    }

    fn stake_amount(&mut self) -> i128 {
        // Choose from a spread of amounts including small, medium, large.
        let choices: &[i128] = &[
            1,
            1_000_000,
            10_000_000,
            100_000_000,
            1_000_000_000,
            10_000_000_000,
            50_000_000_000,
        ];
        choices[self.rng.next_range(choices.len() as u64) as usize]
    }

    fn margin(&mut self) -> i128 {
        let choices: &[i128] = &[
            1_000_000,
            10_000_000,
            100_000_000,
        ];
        choices[self.rng.next_range(choices.len() as u64) as usize]
    }

    fn end_ts(&mut self) -> u64 {
        // end_ts in [base+1 .. base+2_592_000]
        self.base_ts + 1 + self.rng.next_range(2_591_999)
    }
}

/// Generate a deterministic sequence of `n` actions given a seed.
///
/// The generator emits actions in a realistic order:
/// 1. Start with several `CreateCall` actions.
/// 2. Mix in `Stake`, `CancelCall` (only before stakes), `VoidCall`.
/// 3. Advance time and emit `ResolveCall` → `MarkSettled` → `ClaimPayout`.
/// 4. Occasionally include futures actions.
pub fn generate_sequence(seed: u64, n: usize, num_actors: usize, base_ts: u64) -> Vec<Action> {
    let mut ctx = GenCtx {
        rng: Lcg::new(seed),
        num_actors,
        base_ts,
    };

    let mut actions = Vec::with_capacity(n);

    // Track which call_ids are in which state so we can generate valid follow-ups.
    let mut open_calls: Vec<(u64, u64, u32)> = Vec::new(); // (id, end_ts, outcome_count)
    let mut resolved_calls: Vec<u64> = Vec::new();
    let mut settled_calls: Vec<(u64, Vec<usize>)> = Vec::new(); // (id, stakers who staked)
    let mut voided_calls: Vec<(u64, Vec<usize>)> = Vec::new();
    let mut active_futures: Vec<(u64, u64)> = Vec::new(); // (contract_id, expiry_ts)
    let mut next_call_id: u64 = 1;
    let mut next_futures_id: u64 = 1;
    let mut stakers_per_call: std::collections::HashMap<u64, Vec<usize>> = Default::default();

    while actions.len() < n {
        // Weight table:  create (20%), stake (35%), resolve (10%), settle (8%),
        // claim (8%), void (4%), cancel (3%), futures (6%), misc (6%)
        let roll = ctx.rng.next_range(100);

        if roll < 20 || open_calls.is_empty() {
            // CreateCall
            let creator = ctx.actor();
            let stake_amount = ctx.stake_amount();
            let end_ts = ctx.end_ts();
            let outcome_count = if ctx.rng.bool_prob(30) { 3 } else { 2 };
            actions.push(Action::CreateCall {
                call_id_hint: next_call_id,
                creator,
                stake_amount,
                end_ts,
                outcome_count,
            });
            open_calls.push((next_call_id, end_ts, outcome_count));
            stakers_per_call.insert(next_call_id, Vec::new());
            next_call_id += 1;
        } else if roll < 55 && !open_calls.is_empty() {
            // Stake
            let idx = ctx.rng.next_range(open_calls.len() as u64) as usize;
            let (call_id, _end_ts, outcome_count) = open_calls[idx];
            let staker = ctx.actor();
            let amount = ctx.stake_amount();
            let outcome = ctx.outcome(outcome_count);
            actions.push(Action::Stake { call_id, staker, amount, outcome });
            stakers_per_call.entry(call_id).or_default().push(staker);
        } else if roll < 65 && !open_calls.is_empty() {
            // ResolveCall – advance time past end_ts
            let idx = ctx.rng.next_range(open_calls.len() as u64) as usize;
            let (call_id, end_ts, outcome_count) = open_calls[idx];
            let now = end_ts + 1 + ctx.rng.next_range(3600);
            let outcome = ctx.outcome(outcome_count);
            actions.push(Action::ResolveCall { call_id, outcome, now });
            open_calls.remove(idx);
            resolved_calls.push(call_id);
        } else if roll < 73 && !resolved_calls.is_empty() {
            // MarkSettled
            let idx = ctx.rng.next_range(resolved_calls.len() as u64) as usize;
            let call_id = resolved_calls[idx];
            actions.push(Action::MarkSettled { call_id });
            resolved_calls.remove(idx);
            let stakers = stakers_per_call.get(&call_id).cloned().unwrap_or_default();
            settled_calls.push((call_id, stakers));
        } else if roll < 81 && !settled_calls.is_empty() {
            // ClaimPayout
            let cidx = ctx.rng.next_range(settled_calls.len() as u64) as usize;
            let (call_id, ref stakers) = settled_calls[cidx].clone();
            if !stakers.is_empty() {
                let sidx = ctx.rng.next_range(stakers.len() as u64) as usize;
                let staker = stakers[sidx];
                actions.push(Action::ClaimPayout { call_id, staker });
            }
        } else if roll < 85 && !open_calls.is_empty() {
            // VoidCall
            let idx = ctx.rng.next_range(open_calls.len() as u64) as usize;
            let (call_id, _end_ts, _outcome_count) = open_calls[idx];
            actions.push(Action::VoidCall { call_id });
            let stakers = stakers_per_call.get(&call_id).cloned().unwrap_or_default();
            voided_calls.push((call_id, stakers));
            open_calls.remove(idx);
        } else if roll < 88 && !voided_calls.is_empty() {
            // ClaimVoidRefund
            let cidx = ctx.rng.next_range(voided_calls.len() as u64) as usize;
            let (call_id, ref stakers) = voided_calls[cidx].clone();
            if !stakers.is_empty() {
                let sidx = ctx.rng.next_range(stakers.len() as u64) as usize;
                let staker = stakers[sidx];
                actions.push(Action::ClaimVoidRefund { call_id, staker });
            }
        } else if roll < 91 && !open_calls.is_empty() {
            // CancelCall (only if no stakes on the call)
            let idx = ctx.rng.next_range(open_calls.len() as u64) as usize;
            let (call_id, _end_ts, _outcome_count) = open_calls[idx];
            // Only try to cancel if no stakers
            if stakers_per_call.get(&call_id).map(|v| v.is_empty()).unwrap_or(true) {
                let creator_hint = 0usize; // will be matched by model
                actions.push(Action::CancelCall { call_id, creator: creator_hint });
                open_calls.remove(idx);
            }
        } else if roll < 95 && !settled_calls.is_empty() {
            // Futures on a settled call
            let cidx = ctx.rng.next_range(settled_calls.len() as u64) as usize;
            let (call_id, _) = settled_calls[cidx].clone();
            let creator = ctx.actor();
            let outcome = 1u32;
            let strike_probability_bps = ctx.rng.next_range(10_001) as u32;
            let now = base_ts + 1000;
            let expiry_ts = now + 3600 + ctx.rng.next_range(86_400);
            let margin_requirement = ctx.margin();
            actions.push(Action::CreateFutures {
                call_id,
                creator,
                outcome,
                strike_probability_bps,
                expiry_ts,
                margin_requirement,
                now,
            });
            active_futures.push((next_futures_id, expiry_ts));
            next_futures_id += 1;
        } else if !active_futures.is_empty() {
            let fidx = ctx.rng.next_range(active_futures.len() as u64) as usize;
            let (contract_id, expiry_ts) = active_futures[fidx];
            let subroll = ctx.rng.next_range(2);
            if subroll == 0 {
                let counterparty = ctx.actor();
                let now = base_ts + 500; // before expiry
                actions.push(Action::AcceptFutures { contract_id, counterparty, now });
            } else {
                let now = expiry_ts + 1;
                actions.push(Action::SettleFutures { contract_id, now });
                active_futures.remove(fidx);
            }
        }
    }

    actions
}

/// Format an action sequence as a compact trace string for failure messages.
pub fn format_trace(actions: &[Action]) -> String {
    let lines: Vec<String> = actions
        .iter()
        .enumerate()
        .map(|(i, a)| format!("  [{i:>3}] {a:?}"))
        .collect();
    lines.join("\n")
}
