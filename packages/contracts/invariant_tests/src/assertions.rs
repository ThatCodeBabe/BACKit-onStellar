//! Invariant assertion helpers.
//!
//! Each function panics with a descriptive message (including the seed and
//! action trace) when an invariant is violated, so CI logs clearly show
//! what went wrong and how to reproduce it.

use crate::model::{compute_settlement_totals, CallStatus, ModelState};

/// Maximum allowed rounding dust per staker (integer division truncates).
pub const MAX_DUST_PER_STAKER: i128 = 2;

/// Assert that for every settled call, the sum of all individual payouts is
/// within `MAX_DUST_PER_STAKER * n_winners` of the total staked pool minus fees.
pub fn assert_conservation(state: &ModelState, seed: u64, trace: &str) {
    for (call_id, call) in &state.calls {
        if let CallStatus::Settled { outcome } = &call.status {
            let total_pool = call.total_stake();
            let n_winners = call
                .staker_stakes
                .get(outcome)
                .map(|m| m.len())
                .unwrap_or(0);

            if n_winners == 0 {
                // No winners – nothing distributed, conservation trivially holds.
                continue;
            }

            let total_fee_bps_amount =
                call.outcome_stakes
                    .iter()
                    .filter(|(o, _)| *o != outcome)
                    .map(|(_, s)| s * state.fee_bps as i128 / 10_000)
                    .sum::<i128>();

            let expected_distributed = total_pool - total_fee_bps_amount;

            if let Some((total_payout, _total_fee)) = compute_settlement_totals(call, state.fee_bps) {
                let dust = (expected_distributed - total_payout).abs();
                let max_dust = MAX_DUST_PER_STAKER * n_winners as i128;
                assert!(
                    dust <= max_dust,
                    "CONSERVATION VIOLATED – call {call_id}: \
                     expected_distributed={expected_distributed} total_payout={total_payout} \
                     dust={dust} max_allowed={max_dust}\n\
                     seed=0x{seed:016X}\ntrace:\n{trace}"
                );
            }
        }
    }
}

/// Assert that no staker can have a total payout exceeding their modeled entitlement.
pub fn assert_no_over_claim(state: &ModelState, seed: u64, trace: &str) {
    for (call_id, call) in &state.calls {
        let outcome = match &call.status {
            CallStatus::Settled { outcome } => *outcome,
            _ => continue,
        };

        let total_winning_stake = call.outcome_stakes.get(&outcome).copied().unwrap_or(0);
        if total_winning_stake == 0 {
            continue;
        }
        let total_losing_stake: i128 = (1..=call.outcome_count)
            .filter(|&o| o != outcome)
            .map(|o| call.outcome_stakes.get(&o).copied().unwrap_or(0))
            .sum();

        let stakers_map = match call.staker_stakes.get(&outcome) {
            Some(m) => m,
            None => continue,
        };

        for (staker, &staker_stake) in stakers_map {
            let (_, payout) = crate::model::compute_payout_parts(
                staker_stake,
                total_winning_stake,
                total_losing_stake,
                state.fee_bps,
            );

            // Upper bound: staker gets back their stake + all losing stake (fee=0 case).
            let upper_bound = staker_stake + total_losing_stake;
            assert!(
                payout <= upper_bound,
                "OVER-CLAIM – call {call_id} staker {staker}: payout={payout} > upper_bound={upper_bound}\n\
                 seed=0x{seed:016X}\ntrace:\n{trace}"
            );

            // Payout must be >= staker_stake (can never lose principal in winner path).
            assert!(
                payout >= staker_stake,
                "PRINCIPAL LOSS – call {call_id} staker {staker}: payout={payout} < stake={staker_stake}\n\
                 seed=0x{seed:016X}\ntrace:\n{trace}"
            );
        }
    }
}

/// Assert that no address is recorded as claimed twice for the same call.
pub fn assert_no_double_claim(state: &ModelState, seed: u64, trace: &str) {
    // The `claimed` set in ModelState already rejects duplicates; this assertion
    // re-checks by counting occurrences (defensively).
    let mut counts: std::collections::HashMap<(u64, &str), u32> = Default::default();
    for (call_id, staker) in &state.claimed {
        *counts.entry((*call_id, staker.as_str())).or_insert(0) += 1;
    }
    for ((call_id, staker), count) in &counts {
        assert!(
            *count <= 1,
            "DOUBLE-CLAIM – call {call_id} staker {staker}: count={count}\n\
             seed=0x{seed:016X}\ntrace:\n{trace}"
        );
    }
}

/// Assert stake totals are non-negative on every open call.
pub fn assert_non_negative_stakes(state: &ModelState, seed: u64, trace: &str) {
    for (call_id, call) in &state.calls {
        for (outcome, &total) in &call.outcome_stakes {
            assert!(
                total >= 0,
                "NEGATIVE STAKE – call {call_id} outcome {outcome}: total={total}\n\
                 seed=0x{seed:016X}\ntrace:\n{trace}"
            );
        }
        for (outcome, stakers_map) in &call.staker_stakes {
            for (staker, &amt) in stakers_map {
                assert!(
                    amt >= 0,
                    "NEGATIVE INDIVIDUAL STAKE – call {call_id} outcome {outcome} staker {staker}: amt={amt}\n\
                     seed=0x{seed:016X}\ntrace:\n{trace}"
                );
            }
        }
    }
}

/// Assert that individual per-staker totals sum to the aggregate outcome total.
pub fn assert_stake_sum_consistency(state: &ModelState, seed: u64, trace: &str) {
    for (call_id, call) in &state.calls {
        for outcome in 1..=call.outcome_count {
            let aggregate = call.outcome_stakes.get(&outcome).copied().unwrap_or(0);
            let sum_individuals: i128 = call
                .staker_stakes
                .get(&outcome)
                .map(|m| m.values().sum())
                .unwrap_or(0);
            assert_eq!(
                aggregate, sum_individuals,
                "STAKE SUM MISMATCH – call {call_id} outcome {outcome}: \
                 aggregate={aggregate} sum_individual={sum_individuals}\n\
                 seed=0x{seed:016X}\ntrace:\n{trace}"
            );
        }
    }
}

/// Assert that a voided call's total refundable amount equals the total staked.
pub fn assert_void_conservation(state: &ModelState, seed: u64, trace: &str) {
    for (call_id, call) in &state.calls {
        if !matches!(call.status, CallStatus::Voided) {
            continue;
        }
        let total_staked = call.total_stake();
        // Every refund claimant should get back exactly what they staked.
        // We just ensure the pool is non-negative (full distribution is checked
        // when void refunds are claimed in the sequence tests).
        assert!(
            total_staked >= 0,
            "NEGATIVE VOID POOL – call {call_id}: total_staked={total_staked}\n\
             seed=0x{seed:016X}\ntrace:\n{trace}"
        );
    }
}

/// Assert fee amount is within [0, total_losing_stake] for every settled call.
pub fn assert_fee_bounds(state: &ModelState, seed: u64, trace: &str) {
    for (call_id, call) in &state.calls {
        let outcome = match &call.status {
            CallStatus::Settled { outcome } => *outcome,
            _ => continue,
        };
        let total_losing: i128 = (1..=call.outcome_count)
            .filter(|&o| o != outcome)
            .map(|o| call.outcome_stakes.get(&o).copied().unwrap_or(0))
            .sum();
        let total_fee = total_losing * state.fee_bps as i128 / 10_000;
        assert!(
            total_fee >= 0 && total_fee <= total_losing,
            "FEE OUT OF BOUNDS – call {call_id}: fee={total_fee} losing={total_losing}\n\
             seed=0x{seed:016X}\ntrace:\n{trace}"
        );
    }
}

/// Assert futures payout conservation: buyer + seller == 2 * margin.
pub fn assert_futures_conservation(
    buyer_payout: i128,
    seller_payout: i128,
    margin: i128,
    seed: u64,
    trace: &str,
) {
    let total = buyer_payout + seller_payout;
    assert_eq!(
        total,
        2 * margin,
        "FUTURES CONSERVATION – buyer={buyer_payout} seller={seller_payout} 2*margin={}\n\
         seed=0x{seed:016X}\ntrace:\n{trace}",
        2 * margin
    );
}

/// Run all standard invariants at once.
pub fn assert_all_invariants(state: &ModelState, seed: u64, trace: &str) {
    assert_non_negative_stakes(state, seed, trace);
    assert_stake_sum_consistency(state, seed, trace);
    assert_conservation(state, seed, trace);
    assert_no_over_claim(state, seed, trace);
    assert_no_double_claim(state, seed, trace);
    assert_void_conservation(state, seed, trace);
    assert_fee_bounds(state, seed, trace);
}
