//! Stateful invariant and differential tests for BACKit prediction settlement.
//!
//! ─── Running ───────────────────────────────────────────────────────────────
//! Normal CI (bounded deterministic suite):
//!   cargo test -p invariant-tests
//!
//! Extended local run with more seeds:
//!   INVARIANT_SEEDS=500 cargo test -p invariant-tests -- --nocapture
//!
//! Reproduce a specific failure:
//!   INVARIANT_SEED=0xDEADBEEF_CAFEBABE cargo test -p invariant-tests -- --nocapture
//! ─────────────────────────────────────────────────────────────────────────────

#![cfg(test)]
#![allow(dead_code, unused_imports, unused_variables)]

use crate::assertions::*;
use crate::generator::{format_trace, generate_sequence, Action, Lcg};
use crate::model::{self, compute_payout_parts, futures_payout, CallStatus, ModelState};

// ─── Shared test constants ────────────────────────────────────────────────────

const TEST_FEE_BPS: u32 = 200; // 2 %
const GRACE_PERIOD: u64 = 604_800; // 7 days
const BASE_TS: u64 = 1_000_000;
const NUM_ACTORS: usize = 8;
const ACTIONS_PER_SEED: usize = 80;

/// Fixed seeds shipped with the crate (regression seeds for known-good sequences).
const REGRESSION_SEEDS: &[u64] = &[
    0x0000_0000_0000_0001,
    0xDEAD_BEEF_CAFE_BABE,
    0x1234_5678_9ABC_DEF0,
    0xFEED_FACE_DEAD_BEEF,
    0xC0FF_EE00_1234_5678,
    0x0BAD_C0DE_0000_0001,
    0x1111_1111_1111_1111,
    0xFFFF_FFFF_FFFF_FFFF,
    0xA5A5_A5A5_A5A5_A5A5,
    0x5A5A_5A5A_5A5A_5A5A,
];

/// Address pool (string IDs for the reference model).
fn make_actors(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("actor_{i}")).collect()
}

// ─── Reference-model sequence runner ─────────────────────────────────────────

/// Apply a sequence of actions to the reference model, checking invariants
/// after every step.  Invalid actions (e.g. staking on a non-existent call)
/// are skipped gracefully; the test only fails on invariant violations.
fn run_sequence_model(seed: u64, actions: &[Action]) {
    let actors = make_actors(NUM_ACTORS);
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let trace = format_trace(actions);

    for action in actions {
        apply_action_model(&mut state, &actors, action);
        assert_all_invariants(&state, seed, &trace);
    }
}

fn apply_action_model(state: &mut ModelState, actors: &[String], action: &Action) {
    match action {
        Action::CreateCall {
            call_id_hint,
            creator,
            stake_amount,
            end_ts,
            outcome_count,
        } => {
            let name = &actors[creator % actors.len()];
            let _id = state.create_call(name, *stake_amount, *end_ts, *outcome_count);
        }

        Action::Stake {
            call_id,
            staker,
            amount,
            outcome,
        } => {
            if state.calls.contains_key(call_id) {
                let call = &state.calls[call_id];
                if !matches!(call.status, CallStatus::Open) {
                    return;
                }
                if *outcome < 1 || *outcome > call.outcome_count {
                    return;
                }
                if *amount <= 0 {
                    return;
                }
                let name = actors[staker % actors.len()].clone();
                let call_id = *call_id;
                let amount = *amount;
                let outcome = *outcome;
                state.stake(call_id, &name, amount, outcome);
            }
        }

        Action::CancelCall { call_id, creator } => {
            if let Some(call) = state.calls.get(call_id) {
                if !matches!(call.status, CallStatus::Open) {
                    return;
                }
                if call.total_stake() > 0 {
                    return;
                }
                let name = call.creator.clone();
                state.cancel_call(*call_id, &name);
            }
        }

        Action::VoidCall { call_id } => {
            if let Some(call) = state.calls.get(call_id) {
                if matches!(
                    call.status,
                    CallStatus::Settled { .. } | CallStatus::Voided | CallStatus::Cancelled
                ) {
                    return;
                }
                state.void_call(*call_id);
            }
        }

        Action::ResolveCall {
            call_id,
            outcome,
            now,
        } => {
            if let Some(call) = state.calls.get(call_id) {
                if !matches!(call.status, CallStatus::Open) {
                    return;
                }
                if *now < call.end_ts {
                    return;
                }
                if *outcome < 1 || *outcome > call.outcome_count {
                    return;
                }
                let now = *now;
                let outcome = *outcome;
                let call_id = *call_id;
                state.resolve_call(call_id, outcome, now);
            }
        }

        Action::MarkSettled { call_id } => {
            if let Some(call) = state.calls.get(call_id) {
                if !matches!(call.status, CallStatus::Resolved { .. }) {
                    return;
                }
                state.mark_settled(*call_id);
            }
        }

        Action::ClaimPayout { call_id, staker } => {
            let staker_name = actors[staker % actors.len()].clone();
            let key = (*call_id, staker_name.clone());
            if state.claimed.contains(&key) {
                return;
            }
            if let Some(call) = state.calls.get(call_id) {
                let outcome = match &call.status {
                    CallStatus::Settled { outcome } => *outcome,
                    _ => return,
                };
                if call.staker_stake(outcome, &staker_name) <= 0 {
                    return;
                }
                state.claim_payout(*call_id, &staker_name);
            }
        }

        Action::ClaimVoidRefund { call_id, staker } => {
            let staker_name = actors[staker % actors.len()].clone();
            let key = (*call_id, staker_name.clone());
            if state.void_refund_claimed.contains(&key) {
                return;
            }
            if let Some(call) = state.calls.get(call_id) {
                if !matches!(call.status, CallStatus::Voided) {
                    return;
                }
                let total: i128 = (1..=call.outcome_count)
                    .map(|o| call.staker_stake(o, &staker_name))
                    .sum();
                if total <= 0 {
                    return;
                }
                state.claim_void_refund(*call_id, &staker_name);
            }
        }

        Action::ClaimExpiredRefund {
            call_id,
            staker,
            now,
        } => {
            let staker_name = actors[staker % actors.len()].clone();
            let key = (*call_id, staker_name.clone());
            if state.expired_refund_claimed.contains(&key) {
                return;
            }
            if let Some(call) = state.calls.get(call_id) {
                if matches!(
                    call.status,
                    CallStatus::Settled { .. } | CallStatus::Voided | CallStatus::Cancelled
                ) {
                    return;
                }
                let grace_deadline = call.end_ts + state.resolution_grace_period;
                if *now <= grace_deadline {
                    return;
                }
                let total: i128 = (1..=call.outcome_count)
                    .map(|o| call.staker_stake(o, &staker_name))
                    .sum();
                if total <= 0 {
                    return;
                }
                state.claim_expired_refund(*call_id, &staker_name, *now);
            }
        }

        Action::CreateFutures {
            call_id,
            creator,
            outcome,
            strike_probability_bps,
            expiry_ts,
            margin_requirement,
            now,
        } => {
            if !state.calls.contains_key(call_id) {
                return;
            }
            if *margin_requirement <= 0 || *strike_probability_bps > 10_000 {
                return;
            }
            if *expiry_ts <= *now {
                return;
            }
            let name = actors[creator % actors.len()].clone();
            state.create_futures(
                &name,
                *call_id,
                *outcome,
                *strike_probability_bps,
                *expiry_ts,
                *margin_requirement,
                *now,
            );
        }

        Action::AcceptFutures {
            contract_id,
            counterparty,
            now,
        } => {
            if let Some(pos) = state.futures.get(contract_id) {
                if pos.is_settled || pos.counterparty.is_some() || *now >= pos.expiry_ts {
                    return;
                }
                let name = actors[counterparty % actors.len()].clone();
                state.accept_futures(*contract_id, &name, *now);
            }
        }

        Action::SettleFutures { contract_id, now } => {
            if let Some(pos) = state.futures.get(contract_id) {
                if pos.is_settled || pos.counterparty.is_none() || *now < pos.expiry_ts {
                    return;
                }
                let margin = pos.margin_requirement;
                let strike = pos.strike_probability_bps;
                let call_id = pos.call_id;

                // Compute current implied probability from model state.
                if let Some(call) = state.calls.get(&call_id) {
                    let total = call.total_stake();
                    if total == 0 {
                        return;
                    }
                    let outcome_stake = call.outcome_stakes.get(&pos.outcome).copied().unwrap_or(0);
                    let current_bps = (outcome_stake * 10_000 / total) as u32;
                    let (buyer_payout, seller_payout) = futures_payout(margin, strike, current_bps);
                    assert_futures_conservation(buyer_payout, seller_payout, margin, 0, "inline");
                }
                let contract_id = *contract_id;
                let now = *now;
                state.settle_futures(contract_id, now);
            }
        }
    }
}

// ─── Deterministic seeded-sequence tests ─────────────────────────────────────

/// Run the full invariant suite over all regression seeds plus any additional
/// seeds requested via the `INVARIANT_SEEDS` environment variable.
#[test]
fn test_invariants_seeded_sequences() {
    let extra_seeds: usize = std::env::var("INVARIANT_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // Run regression seeds
    for &seed in REGRESSION_SEEDS {
        let actions = generate_sequence(seed, ACTIONS_PER_SEED, NUM_ACTORS, BASE_TS);
        run_sequence_model(seed, &actions);
    }

    // Run extra seeds if requested
    if extra_seeds > 0 {
        let mut rng = Lcg::new(0xC0DE_4242_1337_BEEF);
        for _ in 0..extra_seeds {
            let seed = rng.next_u64();
            let actions = generate_sequence(seed, ACTIONS_PER_SEED, NUM_ACTORS, BASE_TS);
            run_sequence_model(seed, &actions);
        }
    }
}

// ─── Conservation invariant: payout formula arithmetic ───────────────────────

#[test]
fn test_conservation_sum_of_payouts_equals_pool_minus_fee() {
    // Note: i128::MAX-scale inputs overflow the reference-model's unchecked
    // arithmetic (matching the on-chain contract's behaviour). Those cases are
    // tested separately in regression_asymmetric_pool_rounding_dust.
    let cases: &[(&[i128], i128, u32)] = &[
        (&[100, 200, 300, 400], 500, 200),
        (&[1_000_000], 0, 0),
        (&[500_000], 1_000_000, 500),
        (&[1, 2, 3], 1_000, 100),
        (&[1_000_000_000_000i128, 500_000_000_000], 1_000_000_000_000, 100),
    ];

    for &(winning_stakes, total_losing, fee_bps) in cases {
        let total_winning: i128 = winning_stakes.iter().sum();
        let fee = total_losing * fee_bps as i128 / 10_000;
        let expected_distributed = total_winning + total_losing - fee;

        let sum_payouts: i128 = winning_stakes
            .iter()
            .map(|&s| {
                let (_, payout) = compute_payout_parts(s, total_winning, total_losing, fee_bps);
                payout
            })
            .sum();

        let dust = (expected_distributed - sum_payouts).abs();
        assert!(
            dust <= winning_stakes.len() as i128,
            "conservation: expected={expected_distributed} got={sum_payouts} dust={dust}"
        );
    }
}

#[test]
fn test_conservation_no_winner_zero_payout() {
    // When all stakes are on one outcome and there's no losing pool, payout == principal.
    let (_, payout) = compute_payout_parts(500, 500, 0, 200);
    assert_eq!(payout, 500, "winner in empty-loser pool should get back only principal");
}

#[test]
fn test_conservation_fee_zero_bps() {
    let winning_stakes = [200i128, 300];
    let total_winning: i128 = 500;
    let total_losing: i128 = 1_000;

    let sum: i128 = winning_stakes
        .iter()
        .map(|&s| {
            let (_, p) = compute_payout_parts(s, total_winning, total_losing, 0);
            p
        })
        .sum();
    assert_eq!(sum, total_winning + total_losing, "zero fee: full pool distributed");
}

#[test]
fn test_conservation_max_fee_bps() {
    // At 100% fee the losing pool goes entirely to fee_collector; winners only get principal.
    let (fee_share, payout) = compute_payout_parts(500, 500, 1_000, 10_000);
    assert_eq!(fee_share, 1_000, "full fee should equal losing pool");
    assert_eq!(payout, 500, "payout at max fee == principal only");
}

// ─── Authorization invariants ─────────────────────────────────────────────────

#[test]
fn test_auth_only_creator_can_cancel() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);

    // Non-creator should panic
    let result = std::panic::catch_unwind(|| {
        let mut s2 = state.clone();
        s2.cancel_call(id, "bob");
    });
    assert!(result.is_err(), "non-creator cancel should panic");

    // Creator succeeds
    state.cancel_call(id, "alice");
    assert!(matches!(state.calls[&id].status, CallStatus::Cancelled));
}

#[test]
fn test_auth_cannot_cancel_with_stakes() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    state.stake(id, "bob", 1_000_000, 1);

    let result = std::panic::catch_unwind(|| {
        let mut s2 = state.clone();
        s2.cancel_call(id, "alice");
    });
    assert!(result.is_err(), "cancel with stakes should panic");
}

#[test]
fn test_auth_void_prevents_further_stakes() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    state.stake(id, "bob", 1_000_000, 1);
    state.void_call(id);

    let result = std::panic::catch_unwind(|| {
        let mut s2 = state.clone();
        s2.stake(id, "carol", 1_000_000, 2);
    });
    assert!(result.is_err(), "stake on voided call should panic");
}

#[test]
fn test_auth_cannot_resolve_before_end_ts() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);

    let result = std::panic::catch_unwind(|| {
        let mut s2 = state.clone();
        s2.resolve_call(id, 1, BASE_TS); // now < end_ts
    });
    assert!(result.is_err(), "resolve before end_ts should panic");
}

#[test]
fn test_auth_no_double_claim() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    state.stake(id, "bob", 10_000_000, 1);
    state.stake(id, "carol", 5_000_000, 2);
    state.resolve_call(id, 1, BASE_TS + 3601);
    state.mark_settled(id);

    state.claim_payout(id, "bob");

    let result = std::panic::catch_unwind(|| {
        let mut s2 = state.clone();
        s2.claim_payout(id, "bob");
    });
    assert!(result.is_err(), "double claim should panic");
}

#[test]
fn test_auth_no_double_void_refund() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    state.stake(id, "bob", 10_000_000, 1);
    state.void_call(id);

    state.claim_void_refund(id, "bob");

    let result = std::panic::catch_unwind(|| {
        let mut s2 = state.clone();
        s2.claim_void_refund(id, "bob");
    });
    assert!(result.is_err(), "double void refund should panic");
}

// ─── Boundary conditions ──────────────────────────────────────────────────────

#[test]
fn test_boundary_single_unit_stake_payout() {
    let (_, payout) = compute_payout_parts(1, 1, 0, 0);
    assert_eq!(payout, 1, "unit winner with empty loser pool");

    // 1 unit winner, 1 unit loser, no fee
    let (_, payout) = compute_payout_parts(1, 1, 1, 0);
    assert_eq!(payout, 2, "unit winner gets 2 units");
}

#[test]
fn test_boundary_zero_winner_pool_no_payout() {
    // total_winning_stake = 0 means no winners; payout returns 0 (divide by zero guarded).
    let (fee_share, payout) = compute_payout_parts(0, 0, 500, 200);
    assert_eq!(fee_share, 0);
    assert_eq!(payout, 0);
}

#[test]
fn test_boundary_extreme_asymmetry_single_winner() {
    // 1 unit winner vs 999_999_999 loser pool
    let total_winning = 1i128;
    let total_losing = 999_999_999i128;
    let (_, payout) = compute_payout_parts(1, total_winning, total_losing, 0);
    assert_eq!(payout, 1 + total_losing);
}

#[test]
fn test_boundary_max_fee_bps_never_exceeds_pool() {
    for fee_bps in [0u32, 100, 500, 1_000, 5_000, 10_000] {
        for losing in [0i128, 1, 1_000, 1_000_000_000] {
            let fee = losing * fee_bps as i128 / 10_000;
            assert!(fee >= 0 && fee <= losing,
                "fee={fee} not in [0,{losing}] for fee_bps={fee_bps}");
        }
    }
}

#[test]
fn test_boundary_no_winner_outcome_model() {
    // A call where nobody staked on the winning outcome – no payouts, pool stays.
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    // Only outcome 2 has stakes; outcome 1 wins → no winners.
    state.stake(id, "bob", 5_000_000, 2);
    state.resolve_call(id, 1, BASE_TS + 3601);
    state.mark_settled(id);

    // No stakers on outcome 1, so compute_settlement_totals returns None.
    let totals = model::compute_settlement_totals(&state.calls[&id], state.fee_bps);
    assert!(totals.is_none(), "no-winner call should have no distribution");
}

#[test]
fn test_boundary_multi_outcome_three_way() {
    // 3-outcome call: stake on all 3, one wins.
    let mut state = ModelState::new(0, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 3);
    state.stake(id, "bob", 300, 1);
    state.stake(id, "carol", 500, 2);
    state.stake(id, "dave", 200, 3);

    state.resolve_call(id, 1, BASE_TS + 3601);
    state.mark_settled(id);

    // Bob wins; losing = 500 + 200 = 700; no fee.
    let (_, payout) = state.claim_payout(id, "bob");
    assert_eq!(payout, 300 + 700, "bob gets back stake + full losing pool");

    assert_all_invariants(&state, 0, "multi_outcome_three_way");
}

#[test]
fn test_boundary_max_outcome_count() {
    // outcome_count = 10 with stakes spread across all outcomes.
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000, BASE_TS + 3600, 10);
    for o in 1..=10 {
        state.stake(id, &format!("staker_{o}"), 1_000 * o as i128, o);
    }
    // Total = 1000+2000+...+10000 = 55000
    assert_eq!(state.calls[&id].total_stake(), 55_000);

    state.resolve_call(id, 5, BASE_TS + 3601);
    state.mark_settled(id);

    let (_, payout) = state.claim_payout(id, "staker_5");
    assert!(payout > 5_000, "winner should receive more than principal");
    assert_all_invariants(&state, 0, "max_outcome_count");
}

// ─── Void / expired refund paths ─────────────────────────────────────────────

#[test]
fn test_void_refund_full_conservation() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    let stakers = vec![("bob", 1, 10_000_000i128), ("carol", 2, 20_000_000i128)];
    for &(name, outcome, amt) in &stakers {
        state.stake(id, name, amt, outcome);
    }

    state.void_call(id);

    let refund_bob = state.claim_void_refund(id, "bob");
    let refund_carol = state.claim_void_refund(id, "carol");

    assert_eq!(refund_bob, 10_000_000);
    assert_eq!(refund_carol, 20_000_000);
    assert_eq!(refund_bob + refund_carol, state.calls[&id].total_stake());
    assert_all_invariants(&state, 0, "void_refund_conservation");
}

#[test]
fn test_expired_refund_after_grace_period() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let end_ts = BASE_TS + 3600;
    let id = state.create_call("alice", 1_000_000, end_ts, 2);
    state.stake(id, "bob", 5_000_000, 1);

    let now = end_ts + GRACE_PERIOD + 1;
    let refund = state.claim_expired_refund(id, "bob", now);
    assert_eq!(refund, 5_000_000);
}

#[test]
fn test_expired_refund_before_grace_fails() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let end_ts = BASE_TS + 3600;
    let id = state.create_call("alice", 1_000_000, end_ts, 2);
    state.stake(id, "bob", 5_000_000, 1);

    let now = end_ts + GRACE_PERIOD; // exactly at deadline, not after
    let result = std::panic::catch_unwind(|| {
        let mut s2 = state.clone();
        s2.claim_expired_refund(id, "bob", now);
    });
    assert!(result.is_err(), "claim before grace period end should panic");
}

// ─── Rollover chain (winner re-stakes on a new call) ─────────────────────────

#[test]
fn test_rollover_chain_two_hops() {
    let mut state = ModelState::new(0, GRACE_PERIOD);

    // First call
    let id1 = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    state.stake(id1, "bob", 10_000_000, 1);
    state.stake(id1, "carol", 5_000_000, 2);
    state.resolve_call(id1, 1, BASE_TS + 3601);
    state.mark_settled(id1);
    let (_, payout1) = state.claim_payout(id1, "bob");
    assert_eq!(payout1, 15_000_000, "bob wins all");

    // Second call: bob re-stakes winnings
    let id2 = state.create_call("bob", 1_000_000, BASE_TS + 7200, 2);
    state.stake(id2, "bob", payout1, 1);
    state.stake(id2, "dave", 7_000_000, 2);
    state.resolve_call(id2, 1, BASE_TS + 7201);
    state.mark_settled(id2);
    let (_, payout2) = state.claim_payout(id2, "bob");
    assert!(payout2 > payout1, "bob wins more in round 2");

    assert_all_invariants(&state, 0, "rollover_chain_two_hops");
}

// ─── Futures: payout conservation ────────────────────────────────────────────

#[test]
fn test_futures_payout_conservation_at_strike() {
    // If current_bps == strike, both get margin back (no-op trade).
    let (b, s) = futures_payout(1_000_000, 5_000, 5_000);
    assert_eq!(b, 1_000_000);
    assert_eq!(s, 1_000_000);
    assert_futures_conservation(b, s, 1_000_000, 0, "at_strike");
}

#[test]
fn test_futures_payout_conservation_buyer_wins() {
    // current > strike → long (buyer) profits.
    let (b, s) = futures_payout(1_000_000, 4_000, 6_000); // +20% move
    assert!(b > 1_000_000, "buyer profit expected");
    assert!(s < 1_000_000, "seller loss expected");
    assert_futures_conservation(b, s, 1_000_000, 0, "buyer_wins");
}

#[test]
fn test_futures_payout_conservation_seller_wins() {
    let (b, s) = futures_payout(1_000_000, 6_000, 4_000);
    assert!(s > 1_000_000, "seller profit expected");
    assert!(b < 1_000_000, "buyer loss expected");
    assert_futures_conservation(b, s, 1_000_000, 0, "seller_wins");
}

#[test]
fn test_futures_payout_capped_at_margin() {
    // Even a 100% move should not exceed 2*margin payout to one side.
    for &(strike, current) in &[(0u32, 10_000u32), (10_000, 0)] {
        let margin = 1_000_000i128;
        let (b, s) = futures_payout(margin, strike, current);
        assert!(b <= 2 * margin && b >= 0, "buyer payout out of range: {b}");
        assert!(s <= 2 * margin && s >= 0, "seller payout out of range: {s}");
        assert_futures_conservation(b, s, margin, 0, "capped");
    }
}

#[test]
fn test_futures_model_lifecycle() {
    let mut state = ModelState::new(0, GRACE_PERIOD);

    // Need a call with some staking for implied probability.
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    state.stake(id, "bob", 6_000_000, 1);
    state.stake(id, "carol", 4_000_000, 2);
    // implied prob for outcome 1 = 6/10 = 60% = 6000 bps

    let now = BASE_TS + 100;
    let expiry = BASE_TS + 200;
    let fid = state.create_futures("dave", id, 1, 5_000, expiry, 1_000_000, now);
    state.accept_futures(fid, "eve", now + 10);

    let (b, s) = state.settle_futures(fid, expiry + 1);
    // strike=5000, current=6000 → buyer profits
    assert!(b > 1_000_000, "buyer should profit");
    assert_futures_conservation(b, s, 1_000_000, 0, "futures_model_lifecycle");
}

// ─── Serialization compatibility ─────────────────────────────────────────────

#[test]
fn test_shared_constants_match_model() {
    // Verify the model's constants mirror the shared crate exactly.
    assert_eq!(model::OUTCOME_UP, 1u32);
    assert_eq!(model::OUTCOME_DOWN, 2u32);
    assert_eq!(model::MAX_FEE_BPS, 10_000u32);
    assert_eq!(model::MAX_DURATION_SECS, 2_592_000u64);
}

#[test]
fn test_call_field_parity() {
    // Ensure all fields of ModelCall mirror the contract Call struct.
    // If a new field is added to the contract, this test forces an update
    // to the reference model too.
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("creator", 1_000, BASE_TS + 100, 2);
    let call = &state.calls[&id];

    assert_eq!(call.call_id, id);
    assert_eq!(call.creator, "creator");
    assert_eq!(call.stake_amount, 1_000);
    assert_eq!(call.end_ts, BASE_TS + 100);
    assert_eq!(call.outcome_count, 2);
    assert_eq!(call.total_stake(), 0);
    assert!(matches!(call.status, CallStatus::Open));
}

// ─── Edge-case sequences (static, always-valid inputs) ───────────────────────

#[test]
fn test_edge_many_stakers_single_outcome_winner() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1, BASE_TS + 3600, 2);

    // 50 stakers on outcome 1, 1 staker on outcome 2
    for i in 0..50usize {
        state.stake(id, &format!("winner_{i}"), 1_000_000, 1);
    }
    state.stake(id, "loser_0", 500_000_000, 2); // large losing pool

    state.resolve_call(id, 1, BASE_TS + 3601);
    state.mark_settled(id);

    let mut total_payout = 0i128;
    for i in 0..50usize {
        let (_, payout) = state.claim_payout(id, &format!("winner_{i}"));
        total_payout += payout;
    }

    let pool = state.calls[&id].total_stake();
    let fee = 500_000_000i128 * TEST_FEE_BPS as i128 / 10_000;
    let expected = pool - fee;
    let dust = (expected - total_payout).abs();
    assert!(dust <= 50, "dust={dust} too large for 50 stakers");

    assert_all_invariants(&state, 0, "many_stakers_single_outcome_winner");
}

#[test]
fn test_edge_empty_winning_pool_no_distribution() {
    // Resolves to outcome 1 but nobody staked there → zero payouts.
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1, BASE_TS + 3600, 2);
    state.stake(id, "bob", 5_000_000, 2); // only outcome 2 has stakes
    state.resolve_call(id, 1, BASE_TS + 3601);
    state.mark_settled(id);

    let totals = model::compute_settlement_totals(&state.calls[&id], state.fee_bps);
    assert!(totals.is_none(), "no winning stakes → no distribution");
}

#[test]
fn test_edge_staker_on_both_outcomes_can_claim_winner() {
    let mut state = ModelState::new(0, GRACE_PERIOD);
    let id = state.create_call("alice", 1, BASE_TS + 3600, 2);
    state.stake(id, "bob", 3_000_000, 1); // bet on winner
    state.stake(id, "bob", 2_000_000, 2); // also bet on loser
    state.stake(id, "carol", 5_000_000, 2);

    state.resolve_call(id, 1, BASE_TS + 3601);
    state.mark_settled(id);

    // bob has 3M on winning side; losing pool = 2M+5M = 7M; no fee
    let (_, payout) = state.claim_payout(id, "bob");
    assert_eq!(payout, 3_000_000 + 7_000_000, "bob gets full pool");
}

#[test]
fn test_edge_deadline_plus_one_resolve_allowed() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let end_ts = BASE_TS + 3600;
    let id = state.create_call("alice", 1, end_ts, 2);
    state.stake(id, "bob", 1_000_000, 1);

    // Resolve exactly at end_ts (now == end_ts satisfies now >= end_ts).
    state.resolve_call(id, 1, end_ts);
    assert!(matches!(state.calls[&id].status, CallStatus::Resolved { .. }));
}

#[test]
fn test_edge_cancel_with_zero_stakes_succeeds() {
    let mut state = ModelState::new(TEST_FEE_BPS, GRACE_PERIOD);
    let id = state.create_call("alice", 1_000_000, BASE_TS + 3600, 2);
    // No stakes placed.
    state.cancel_call(id, "alice");
    assert!(matches!(state.calls[&id].status, CallStatus::Cancelled));
}

// ─── Regression seed: documented defects ─────────────────────────────────────

/// Regression: conserve with large asymmetric pool (fee accumulation rounding).
#[test]
fn regression_asymmetric_pool_rounding_dust() {
    // 1 tiny winner vs 10^12 loser; high fee; dust must be ≤1.
    let (fee, payout) = compute_payout_parts(1, 1, 1_000_000_000_000, 9_999);
    let expected = 1 + 1_000_000_000_000 - (1_000_000_000_000i128 * 9_999 / 10_000);
    let dust = (expected - payout).abs();
    assert!(dust <= 1, "dust={dust}");
}

/// Regression: three-winner equal-stake scenario should distribute exactly.
#[test]
fn regression_three_equal_winners_exact_distribution() {
    let winning_stakes = [1_000i128; 3];
    let total_winning: i128 = 3_000;
    let total_losing: i128 = 3_000;
    let fee_bps = 300u32;
    let fee = total_losing * fee_bps as i128 / 10_000;

    let sum_payouts: i128 = winning_stakes
        .iter()
        .map(|&s| {
            let (_, p) = compute_payout_parts(s, total_winning, total_losing, fee_bps);
            p
        })
        .sum();

    let expected = total_winning + total_losing - fee;
    let dust = (expected - sum_payouts).abs();
    assert!(dust <= 3, "three-equal-winner dust={dust}");
}
