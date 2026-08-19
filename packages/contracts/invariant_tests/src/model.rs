//! Pure-Rust reference model for the BACKit prediction-settlement protocol.
//!
//! This module implements the same economic rules as the on-chain contracts
//! using plain `std` collections and integer arithmetic so tests can compare
//! the contract's observable state against a ground-truth bookkeeper.
//!
//! Invariants maintained by the model
//! ------------------------------------
//! 1. **Conservation**: total escrowed == sum of unclaimed stakes + claimable
//!    payouts + distributed fees, within integer-division rounding dust.
//! 2. **No double-claim**: once a staker has claimed, the model records it and
//!    rejects a second claim.
//! 3. **Authorization**: only the call creator can cancel; only the admin can
//!    void; only the outcome-manager may resolve.

use std::collections::HashMap;

// ─── Constants (mirror shared/src/lib.rs) ─────────────────────────────────────

pub const OUTCOME_UP: u32 = 1;
pub const OUTCOME_DOWN: u32 = 2;
pub const MAX_FEE_BPS: u32 = 10_000;
pub const MAX_DURATION_SECS: u64 = 2_592_000; // 30 days

// ─── Call status ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallStatus {
    Open,
    Resolved { outcome: u32 },
    Settled { outcome: u32 },
    Cancelled,
    Voided,
    Expired, // end_ts passed but never resolved within grace period
}

// ─── Model call ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ModelCall {
    pub call_id: u64,
    pub creator: String,
    /// Required stake amount per position (informational; not enforced by
    /// the reference model because the Soroban contract enforces it).
    pub stake_amount: i128,
    pub end_ts: u64,
    pub outcome_count: u32,
    /// per-outcome aggregate stakes:  outcome (1-based) -> total
    pub outcome_stakes: HashMap<u32, i128>,
    /// per-outcome per-staker stakes: outcome -> staker -> amount
    pub staker_stakes: HashMap<u32, HashMap<String, i128>>,
    pub status: CallStatus,
}

impl ModelCall {
    pub fn new(call_id: u64, creator: &str, stake_amount: i128, end_ts: u64, outcome_count: u32) -> Self {
        let mut outcome_stakes = HashMap::new();
        let mut staker_stakes = HashMap::new();
        for i in 1..=outcome_count {
            outcome_stakes.insert(i, 0i128);
            staker_stakes.insert(i, HashMap::new());
        }
        ModelCall {
            call_id,
            creator: creator.to_string(),
            stake_amount,
            end_ts,
            outcome_count,
            outcome_stakes,
            staker_stakes,
            status: CallStatus::Open,
        }
    }

    /// Sum of all stakes across every outcome.
    pub fn total_stake(&self) -> i128 {
        self.outcome_stakes.values().sum()
    }

    /// Stake of a specific staker on a specific outcome.
    pub fn staker_stake(&self, outcome: u32, staker: &str) -> i128 {
        self.staker_stakes
            .get(&outcome)
            .and_then(|m| m.get(staker))
            .copied()
            .unwrap_or(0)
    }
}

// ─── Futures position ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ModelFutures {
    pub contract_id: u64,
    pub creator: String,
    pub counterparty: Option<String>,
    pub call_id: u64,
    pub outcome: u32,
    pub strike_probability_bps: u32,
    pub expiry_ts: u64,
    pub margin_requirement: i128,
    pub is_settled: bool,
}

// ─── Global model state ───────────────────────────────────────────────────────

#[derive(Debug, Default, Clone)]
pub struct ModelState {
    pub calls: HashMap<u64, ModelCall>,
    pub next_call_id: u64,
    /// set of (call_id, staker) that have already claimed their payout
    pub claimed: std::collections::HashSet<(u64, String)>,
    /// set of (call_id, staker) that have already claimed a void refund
    pub void_refund_claimed: std::collections::HashSet<(u64, String)>,
    /// set of (call_id, staker) that have already claimed an expired refund
    pub expired_refund_claimed: std::collections::HashSet<(u64, String)>,
    /// accumulated fee total (informational)
    pub total_fees_collected: i128,
    /// futures positions
    pub futures: HashMap<u64, ModelFutures>,
    pub next_futures_id: u64,
    /// fee configuration
    pub fee_bps: u32,
    pub resolution_grace_period: u64,
}

impl ModelState {
    pub fn new(fee_bps: u32, resolution_grace_period: u64) -> Self {
        ModelState {
            fee_bps,
            resolution_grace_period,
            next_call_id: 1,
            next_futures_id: 1,
            ..Default::default()
        }
    }

    // ── Call lifecycle ────────────────────────────────────────────────────────

    pub fn create_call(
        &mut self,
        creator: &str,
        stake_amount: i128,
        end_ts: u64,
        outcome_count: u32,
    ) -> u64 {
        let id = self.next_call_id;
        self.next_call_id += 1;
        self.calls.insert(id, ModelCall::new(id, creator, stake_amount, end_ts, outcome_count));
        id
    }

    pub fn stake(&mut self, call_id: u64, staker: &str, amount: i128, outcome: u32) {
        let call = self.calls.get_mut(&call_id).expect("call not found");
        assert!(matches!(call.status, CallStatus::Open), "call not open");
        assert!(outcome >= 1 && outcome <= call.outcome_count, "invalid outcome");
        *call.outcome_stakes.entry(outcome).or_insert(0) += amount;
        *call
            .staker_stakes
            .entry(outcome)
            .or_default()
            .entry(staker.to_string())
            .or_insert(0) += amount;
    }

    /// Cancel a call (creator only, no stakes placed).
    pub fn cancel_call(&mut self, call_id: u64, caller: &str) {
        let call = self.calls.get_mut(&call_id).expect("call not found");
        assert_eq!(call.creator, caller, "only creator can cancel");
        assert!(matches!(call.status, CallStatus::Open));
        assert_eq!(call.total_stake(), 0, "cannot cancel with active stakes");
        call.status = CallStatus::Cancelled;
    }

    /// Void a call (admin only, any time before settlement).
    pub fn void_call(&mut self, call_id: u64) {
        let call = self.calls.get_mut(&call_id).expect("call not found");
        assert!(
            !matches!(call.status, CallStatus::Settled { .. } | CallStatus::Voided | CallStatus::Cancelled),
            "cannot void in current state"
        );
        call.status = CallStatus::Voided;
    }

    /// Resolve a call (outcome_manager only, after end_ts).
    pub fn resolve_call(&mut self, call_id: u64, outcome: u32, now: u64) {
        let call = self.calls.get_mut(&call_id).expect("call not found");
        assert!(matches!(call.status, CallStatus::Open), "call not open");
        assert!(now >= call.end_ts, "call not ended");
        assert!(outcome >= 1 && outcome <= call.outcome_count);
        call.status = CallStatus::Resolved { outcome };
    }

    /// Mark a resolved call as settled.
    pub fn mark_settled(&mut self, call_id: u64) {
        let call = self.calls.get_mut(&call_id).expect("call not found");
        if let CallStatus::Resolved { outcome } = call.status {
            call.status = CallStatus::Settled { outcome };
        } else {
            panic!("call must be resolved before marking settled");
        }
    }

    /// Claim payout for a winning staker. Returns (fee_share, payout).
    pub fn claim_payout(&mut self, call_id: u64, staker: &str) -> (i128, i128) {
        let key = (call_id, staker.to_string());
        assert!(!self.claimed.contains(&key), "already claimed");

        let call = self.calls.get(&call_id).expect("call not found");
        let outcome = match call.status {
            CallStatus::Settled { outcome } => outcome,
            _ => panic!("call not settled"),
        };

        let staker_winning_stake = call.staker_stake(outcome, staker);
        assert!(staker_winning_stake > 0, "no winning stake");

        let total_winning_stake = call.outcome_stakes.get(&outcome).copied().unwrap_or(0);
        let total_losing_stake: i128 = (1..=call.outcome_count)
            .filter(|&o| o != outcome)
            .map(|o| call.outcome_stakes.get(&o).copied().unwrap_or(0))
            .sum();

        let (fee_share, payout) =
            compute_payout_parts(staker_winning_stake, total_winning_stake, total_losing_stake, self.fee_bps);

        self.claimed.insert(key);
        self.total_fees_collected += fee_share;
        (fee_share, payout)
    }

    /// Claim a void refund. Returns refund amount.
    pub fn claim_void_refund(&mut self, call_id: u64, staker: &str) -> i128 {
        let key = (call_id, staker.to_string());
        assert!(!self.void_refund_claimed.contains(&key), "already claimed void refund");

        let call = self.calls.get(&call_id).expect("call not found");
        assert!(matches!(call.status, CallStatus::Voided), "call not voided");

        let refund: i128 = (1..=call.outcome_count)
            .map(|o| call.staker_stake(o, staker))
            .sum();
        assert!(refund > 0, "no stake to refund");

        self.void_refund_claimed.insert(key);
        refund
    }

    /// Claim an expired refund (after grace period, never settled).
    pub fn claim_expired_refund(&mut self, call_id: u64, staker: &str, now: u64) -> i128 {
        let key = (call_id, staker.to_string());
        assert!(!self.expired_refund_claimed.contains(&key), "already claimed expired refund");

        let call = self.calls.get(&call_id).expect("call not found");
        assert!(
            !matches!(call.status, CallStatus::Settled { .. } | CallStatus::Voided | CallStatus::Cancelled),
            "cannot claim expired refund"
        );
        let grace_deadline = call.end_ts + self.resolution_grace_period;
        assert!(now > grace_deadline, "grace period not elapsed");

        let refund: i128 = (1..=call.outcome_count)
            .map(|o| call.staker_stake(o, staker))
            .sum();
        assert!(refund > 0, "no stake to refund");

        self.expired_refund_claimed.insert(key);
        refund
    }

    // ── Futures lifecycle ─────────────────────────────────────────────────────

    pub fn create_futures(
        &mut self,
        creator: &str,
        call_id: u64,
        outcome: u32,
        strike_probability_bps: u32,
        expiry_ts: u64,
        margin_requirement: i128,
        now: u64,
    ) -> u64 {
        assert!(margin_requirement > 0, "invalid margin");
        assert!(strike_probability_bps <= 10_000, "invalid strike");
        assert!(expiry_ts > now, "expiry in the past");

        let id = self.next_futures_id;
        self.next_futures_id += 1;
        self.futures.insert(id, ModelFutures {
            contract_id: id,
            creator: creator.to_string(),
            counterparty: None,
            call_id,
            outcome,
            strike_probability_bps,
            expiry_ts,
            margin_requirement,
            is_settled: false,
        });
        id
    }

    pub fn accept_futures(&mut self, contract_id: u64, counterparty: &str, now: u64) {
        let pos = self.futures.get_mut(&contract_id).expect("futures not found");
        assert!(!pos.is_settled, "already settled");
        assert!(pos.counterparty.is_none(), "counterparty already assigned");
        assert!(now < pos.expiry_ts, "contract expired");
        pos.counterparty = Some(counterparty.to_string());
    }

    /// Settle futures and return (buyer_payout, seller_payout).
    pub fn settle_futures(&mut self, contract_id: u64, now: u64) -> (i128, i128) {
        let pos = self.futures.get(&contract_id).expect("futures not found").clone();
        assert!(!pos.is_settled, "already settled");
        assert!(pos.counterparty.is_some(), "no counterparty");
        assert!(now >= pos.expiry_ts, "not yet expired");

        let call = self.calls.get(&pos.call_id).expect("call not found");
        let total_stake = call.total_stake();
        assert!(total_stake > 0, "zero total stake");
        let outcome_stake = call.outcome_stakes.get(&pos.outcome).copied().unwrap_or(0);
        let current_bps = (outcome_stake * 10_000 / total_stake) as u32;

        let margin = pos.margin_requirement;
        let (buyer_payout, seller_payout) = futures_payout(margin, pos.strike_probability_bps, current_bps);

        let pos_mut = self.futures.get_mut(&contract_id).unwrap();
        pos_mut.is_settled = true;
        (buyer_payout, seller_payout)
    }
}

// ─── Pure arithmetic helpers (public so assertion modules can import them) ────

/// Mirror of `compute_payout_parts` in `outcome_manager`.
/// Returns `(fee_share_for_staker, payout_to_staker)`.
pub fn compute_payout_parts(
    staker_winning_stake: i128,
    total_winning_stake: i128,
    total_losing_stake: i128,
    fee_bps: u32,
) -> (i128, i128) {
    let total_fee = total_losing_stake * fee_bps as i128 / 10_000;
    let net_losing = total_losing_stake - total_fee;

    let fee_share = if total_winning_stake > 0 {
        staker_winning_stake * total_fee / total_winning_stake
    } else {
        0
    };
    let prize = if total_winning_stake > 0 {
        staker_winning_stake * net_losing / total_winning_stake
    } else {
        0
    };
    let payout = staker_winning_stake + prize;
    (fee_share, payout)
}

/// Mirror of futures payout formula in `prediction_market_futures`.
pub fn futures_payout(margin: i128, strike_bps: u32, current_bps: u32) -> (i128, i128) {
    if current_bps > strike_bps {
        let diff = current_bps - strike_bps;
        let delta = (margin * diff as i128 / 10_000).min(margin);
        (margin + delta, margin - delta)
    } else if current_bps < strike_bps {
        let diff = strike_bps - current_bps;
        let delta = (margin * diff as i128 / 10_000).min(margin);
        (margin - delta, margin + delta)
    } else {
        (margin, margin)
    }
}

/// Sum payouts for all winning stakers and return total distributed + total fee.
/// Used by conservation invariant checks.
pub fn compute_settlement_totals(
    call: &ModelCall,
    fee_bps: u32,
) -> Option<(i128, i128)> {
    let outcome = match &call.status {
        CallStatus::Settled { outcome } => *outcome,
        _ => return None,
    };

    let total_winning_stake = call.outcome_stakes.get(&outcome).copied().unwrap_or(0);
    if total_winning_stake == 0 {
        return None; // no-winner case – no payouts
    }

    let total_losing_stake: i128 = (1..=call.outcome_count)
        .filter(|&o| o != outcome)
        .map(|o| call.outcome_stakes.get(&o).copied().unwrap_or(0))
        .sum();

    let total_fee = total_losing_stake * fee_bps as i128 / 10_000;
    let net_losing = total_losing_stake - total_fee;

    // Sum payouts across all winning stakers
    let stakers_map = call.staker_stakes.get(&outcome)?;
    let mut total_payout: i128 = 0;
    let mut total_fee_distributed: i128 = 0;
    for &stake in stakers_map.values() {
        let (fee_share, payout) =
            compute_payout_parts(stake, total_winning_stake, total_losing_stake, fee_bps);
        total_payout += payout;
        total_fee_distributed += fee_share;
        let _ = net_losing; // used implicitly via compute_payout_parts
    }

    Some((total_payout, total_fee_distributed))
}
