use crate::types::{InitialDistribution, StakeRecord, TokenConfig};
use soroban_sdk::{contracttype, Address, Env};

// ─────────────────────────────────────────────────────────────────────────────
// Storage key enum
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    // ── Instance keys (global state) ──────────────────────────────────────
    /// Top-level contract config (admin, usdc_sac, initialised flag).
    Config,
    /// Cumulative USDC fees ever deposited into the pool.
    TotalFeesCollected,
    /// Cumulative USDC ever paid out as revenue share.
    TotalRevenueDistributed,
    /// Total BACKit token supply (fixed at TOTAL_SUPPLY after init).
    TotalSupply,
    /// Snapshot of the initial distribution for auditing.
    InitialDist,
    // ── Persistent per-address keys ────────────────────────────────────────
    /// BACKit balance for `Address`.
    Balance(Address),
    /// Active stake record for `Address`.
    Stake(Address),
    /// The cumulative fees snapshot at the time of the holder's last claim.
    LastClaimFees(Address),
}

// ─────────────────────────────────────────────────────────────────────────────
// Instance-storage helpers (global, cheap reads)
// ─────────────────────────────────────────────────────────────────────────────

pub fn set_config(env: &Env, config: &TokenConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> Option<TokenConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn get_total_fees_collected(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalFeesCollected)
        .unwrap_or(0)
}

pub fn set_total_fees_collected(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalFeesCollected, &amount);
}

pub fn get_total_revenue_distributed(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalRevenueDistributed)
        .unwrap_or(0)
}

pub fn set_total_revenue_distributed(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalRevenueDistributed, &amount);
}

pub fn get_total_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalSupply)
        .unwrap_or(0)
}

pub fn set_total_supply(env: &Env, supply: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalSupply, &supply);
}

pub fn set_initial_distribution(env: &Env, dist: &InitialDistribution) {
    env.storage()
        .instance()
        .set(&DataKey::InitialDist, dist);
}

pub fn get_initial_distribution(env: &Env) -> Option<InitialDistribution> {
    env.storage().instance().get(&DataKey::InitialDist)
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent per-address helpers
// ─────────────────────────────────────────────────────────────────────────────

pub fn get_balance(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<DataKey, i128>(&DataKey::Balance(addr.clone()))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, addr: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(addr.clone()), &amount);
}

pub fn get_stake(env: &Env, addr: &Address) -> Option<StakeRecord> {
    env.storage()
        .persistent()
        .get::<DataKey, StakeRecord>(&DataKey::Stake(addr.clone()))
}

pub fn set_stake(env: &Env, addr: &Address, record: &StakeRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Stake(addr.clone()), record);
}

pub fn remove_stake(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Stake(addr.clone()));
}

pub fn get_last_claim_fees(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<DataKey, i128>(&DataKey::LastClaimFees(addr.clone()))
        .unwrap_or(0)
}

pub fn set_last_claim_fees(env: &Env, addr: &Address, fees: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::LastClaimFees(addr.clone()), &fees);
}
