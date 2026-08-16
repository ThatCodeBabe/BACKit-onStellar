use soroban_sdk::{contracttype, Address};

// ─────────────────────────────────────────────────────────────────────────────
// Token constants
// ─────────────────────────────────────────────────────────────────────────────

/// Total BACKit supply: 100,000,000 tokens with 7 decimal places.
pub const TOTAL_SUPPLY: i128 = 100_000_000_0000000_i128;

/// Decimal precision (7 decimal places, matching SAC standard).
pub const DECIMALS: u32 = 7;

// ─────────────────────────────────────────────────────────────────────────────
// Distribution allocations (as basis points of total supply)
// ─────────────────────────────────────────────────────────────────────────────

/// 40% → community rewards pool.
pub const ALLOC_COMMUNITY_REWARDS_BPS: u32 = 4000;
/// 20% → team (3-year vesting).
pub const ALLOC_TEAM_BPS: u32 = 2000;
/// 15% → treasury.
pub const ALLOC_TREASURY_BPS: u32 = 1500;
/// 15% → liquidity provision.
pub const ALLOC_LIQUIDITY_BPS: u32 = 1500;
/// 10% → airdrop.
pub const ALLOC_AIRDROP_BPS: u32 = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Lock-period boost multipliers (in basis-point integers)
// ─────────────────────────────────────────────────────────────────────────────

pub const SECS_30_DAYS: u64 = 30 * 24 * 3600;
pub const SECS_90_DAYS: u64 = 90 * 24 * 3600;
pub const SECS_180_DAYS: u64 = 180 * 24 * 3600;

/// Return the boost multiplier (integer, e.g. 2 = 2x) for a lock duration.
///
/// - < 30 days  → 1×
/// - 30–90 days → 2×
/// - 90–180 days → 3×
/// - ≥ 180 days → 4×
pub fn boost_multiplier(lock_duration_secs: u64) -> u64 {
    if lock_duration_secs < SECS_30_DAYS {
        1
    } else if lock_duration_secs < SECS_90_DAYS {
        2
    } else if lock_duration_secs < SECS_180_DAYS {
        3
    } else {
        4
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract-level configuration
// ─────────────────────────────────────────────────────────────────────────────

/// Top-level contract configuration, stored in instance storage.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenConfig {
    /// Protocol admin (can deposit fees, disabled for token ops after init).
    pub admin: Address,
    /// USDC Stellar Asset Contract address used for revenue-share payouts.
    pub usdc_sac: Address,
    /// Whether the contract has been fully initialised.
    pub initialized: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial distribution record
// ─────────────────────────────────────────────────────────────────────────────

/// Snapshot of the initial token distribution destinations and amounts.
/// Stored once at initialisation for auditability.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct InitialDistribution {
    pub community_rewards: Address,
    pub community_rewards_amount: i128,
    pub team: Address,
    pub team_amount: i128,
    pub treasury: Address,
    pub treasury_amount: i128,
    pub liquidity: Address,
    pub liquidity_amount: i128,
    pub airdrop: Address,
    pub airdrop_amount: i128,
}

// ─────────────────────────────────────────────────────────────────────────────
// Staking record
// ─────────────────────────────────────────────────────────────────────────────

/// Per-address staking state, stored in persistent storage.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeRecord {
    /// Number of BACKit tokens currently staked.
    pub amount: i128,
    /// Ledger timestamp after which the staker may call `unstake_backit`.
    pub lock_until: u64,
    /// Boost multiplier active for this stake (1, 2, 3, or 4).
    pub boost: u64,
    /// Snapshot of `total_fees_collected` at the time of staking,
    /// used to compute incremental revenue earned since the last claim/stake.
    pub fees_at_stake: i128,
}
