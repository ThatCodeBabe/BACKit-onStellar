//! BACKit Revenue-Share Token — Soroban smart contract.
//!
//! A fixed-supply (100 M BACKit, 7 decimals) governance/revenue-share token
//! deployed on Stellar via Soroban.  Key capabilities:
//!
//! - **Revenue share**: holders claim pro-rata USDC from the protocol fee pool.
//! - **Staking boosts**: locking BACKit for longer periods amplifies revenue
//!   share weight (up to 4× for ≥ 180-day locks).
//! - **Initial distribution**: 40% community, 20% team, 15% treasury,
//!   15% liquidity, 10% airdrop — minted once at initialisation.
#![no_std]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use errors::BackitError;
use events::{
    emit_backit_staked, emit_backit_unstaked, emit_fee_deposited, emit_initialized,
    emit_revenue_claimed,
};
use soroban_sdk::{contract, contractimpl, token, Address, Env};
use storage::*;
use types::{
    boost_multiplier, InitialDistribution, StakeRecord, TokenConfig, ALLOC_AIRDROP_BPS,
    ALLOC_COMMUNITY_REWARDS_BPS, ALLOC_LIQUIDITY_BPS, ALLOC_TEAM_BPS, ALLOC_TREASURY_BPS,
    DECIMALS, TOTAL_SUPPLY,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: integer basis-point multiplication (avoids floating point)
// ─────────────────────────────────────────────────────────────────────────────

/// Compute `total * bps / 10_000` using i128 arithmetic (no overflow for
/// values up to TOTAL_SUPPLY × 10 000).
fn bps_of(total: i128, bps: u32) -> i128 {
    total * (bps as i128) / 10_000
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract definition
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct BackitToken;

#[contractimpl]
impl BackitToken {
    // ── Initialisation ───────────────────────────────────────────────────────

    /// Initialise the contract, mint the full supply, and distribute tokens.
    ///
    /// May only be called once.  After this call the `admin` address is stored
    /// for fee-pool management but has **no** minting or clawback capability.
    ///
    /// # Arguments
    /// * `admin`             – Protocol admin (only allowed to call `fee_pool_deposit`).
    /// * `usdc_sac`          – Address of the USDC Stellar Asset Contract used for payouts.
    /// * `community_rewards` – Recipient of the 40% community rewards allocation.
    /// * `team`              – Recipient of the 20% team allocation (expected to handle vesting externally).
    /// * `treasury`          – Recipient of the 15% treasury allocation.
    /// * `liquidity`         – Recipient of the 15% liquidity allocation.
    /// * `airdrop`           – Recipient of the 10% airdrop allocation.
    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_sac: Address,
        community_rewards: Address,
        team: Address,
        treasury: Address,
        liquidity: Address,
        airdrop: Address,
    ) -> Result<(), BackitError> {
        if get_config(&env).is_some() {
            return Err(BackitError::AlreadyInitialized);
        }
        admin.require_auth();

        // ── Compute allocation amounts ──────────────────────────────────────
        let cr_amount = bps_of(TOTAL_SUPPLY, ALLOC_COMMUNITY_REWARDS_BPS);
        let team_amount = bps_of(TOTAL_SUPPLY, ALLOC_TEAM_BPS);
        let treasury_amount = bps_of(TOTAL_SUPPLY, ALLOC_TREASURY_BPS);
        let liq_amount = bps_of(TOTAL_SUPPLY, ALLOC_LIQUIDITY_BPS);
        let airdrop_amount = bps_of(TOTAL_SUPPLY, ALLOC_AIRDROP_BPS);

        // ── Mint balances (no actual SAC mint — token IS this contract) ─────
        set_balance(&env, &community_rewards, cr_amount);
        set_balance(&env, &team, team_amount);
        set_balance(&env, &treasury, treasury_amount);
        set_balance(&env, &liquidity, liq_amount);
        set_balance(&env, &airdrop, airdrop_amount);

        set_total_supply(&env, TOTAL_SUPPLY);

        // ── Persist distribution record ─────────────────────────────────────
        let dist = InitialDistribution {
            community_rewards: community_rewards.clone(),
            community_rewards_amount: cr_amount,
            team: team.clone(),
            team_amount,
            treasury: treasury.clone(),
            treasury_amount,
            liquidity: liquidity.clone(),
            liquidity_amount: liq_amount,
            airdrop: airdrop.clone(),
            airdrop_amount,
        };
        set_initial_distribution(&env, &dist);

        // ── Store config ────────────────────────────────────────────────────
        let config = TokenConfig {
            admin: admin.clone(),
            usdc_sac,
            initialized: true,
        };
        set_config(&env, &config);

        emit_initialized(&env, &admin, TOTAL_SUPPLY);
        Ok(())
    }

    // ── Token view functions ─────────────────────────────────────────────────

    /// Return the token symbol.
    pub fn symbol(_env: Env) -> soroban_sdk::Symbol {
        soroban_sdk::Symbol::new(&_env, "BACKit")
    }

    /// Return the token name.
    pub fn name(_env: Env) -> soroban_sdk::Symbol {
        soroban_sdk::Symbol::new(&_env, "BACKit")
    }

    /// Return the number of decimal places (7).
    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    /// Return the total BACKit supply (fixed).
    pub fn total_supply(env: Env) -> i128 {
        get_total_supply(&env)
    }

    /// Return the BACKit balance of `addr`.
    pub fn balance(env: Env, addr: Address) -> i128 {
        get_balance(&env, &addr)
    }

    /// Transfer BACKit tokens from `from` to `to`.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), BackitError> {
        if amount <= 0 {
            return Err(BackitError::InvalidAmount);
        }
        from.require_auth();

        let from_bal = get_balance(&env, &from);
        if from_bal < amount {
            return Err(BackitError::InsufficientBalance);
        }

        set_balance(&env, &from, from_bal - amount);
        let to_bal = get_balance(&env, &to);
        set_balance(&env, &to, to_bal + amount);
        Ok(())
    }

    // ── Fee-pool management ──────────────────────────────────────────────────

    /// Admin deposits USDC fees into the revenue pool.
    ///
    /// This transfers `amount` USDC **from** `admin` **into** this contract
    /// and increments `total_fees_collected`.  Any holder can then call
    /// `claim_revenue_share` to withdraw their pro-rata share.
    pub fn fee_pool_deposit(env: Env, amount: i128) -> Result<(), BackitError> {
        if amount <= 0 {
            return Err(BackitError::InvalidAmount);
        }
        let config = get_config(&env).ok_or(BackitError::NotInitialized)?;
        config.admin.require_auth();

        // Pull USDC from admin into the contract
        token::StellarAssetClient::new(&env, &config.usdc_sac).transfer(
            &config.admin,
            &env.current_contract_address(),
            &amount,
        );

        let new_total = get_total_fees_collected(&env) + amount;
        set_total_fees_collected(&env, new_total);

        emit_fee_deposited(&env, &config.admin, amount);
        Ok(())
    }

    // ── Revenue share ────────────────────────────────────────────────────────

    /// Claim the caller's pro-rata share of USDC fees accumulated since their
    /// last claim (or since contract initialisation if never claimed).
    ///
    /// Formula:
    /// ```text
    /// fees_since_last = total_fees_collected - last_claim_snapshot
    /// effective_balance = balance + staked * boost   (stake counts 2× baseline,
    ///                                                  further multiplied by lock boost)
    /// holder_share = fees_since_last * effective_balance / total_supply
    /// ```
    ///
    /// Returns the USDC amount transferred.
    pub fn claim_revenue_share(env: Env, holder: Address) -> Result<i128, BackitError> {
        holder.require_auth();

        let config = get_config(&env).ok_or(BackitError::NotInitialized)?;
        let total_supply = get_total_supply(&env);
        if total_supply == 0 {
            return Err(BackitError::NotInitialized);
        }

        let holder_balance = get_balance(&env, &holder);

        // Compute the effective balance (staking boost counts as 2× the raw stake,
        // then further multiplied by the lock-period boost multiplier).
        let effective_balance = Self::compute_effective_balance(&env, &holder, holder_balance);

        if effective_balance == 0 {
            return Err(BackitError::ZeroBalance);
        }

        let total_fees = get_total_fees_collected(&env);
        let last_claim = get_last_claim_fees(&env, &holder);
        let fees_since_last = total_fees - last_claim;

        if fees_since_last <= 0 {
            return Err(BackitError::NoFeesAvailable);
        }

        // Pro-rata share
        let holder_share = fees_since_last * effective_balance / total_supply;

        if holder_share <= 0 {
            return Err(BackitError::NoFeesAvailable);
        }

        // Update accounting before external call (checks-effects-interactions)
        set_last_claim_fees(&env, &holder, total_fees);
        let new_distributed = get_total_revenue_distributed(&env) + holder_share;
        set_total_revenue_distributed(&env, new_distributed);

        // Transfer USDC from contract to holder
        token::StellarAssetClient::new(&env, &config.usdc_sac).transfer(
            &env.current_contract_address(),
            &holder,
            &holder_share,
        );

        emit_revenue_claimed(&env, &holder, holder_share);
        Ok(holder_share)
    }

    // ── Staking ──────────────────────────────────────────────────────────────

    /// Stake `amount` BACKit tokens for `lock_duration_secs` seconds.
    ///
    /// Staked tokens are deducted from the liquid balance and recorded in a
    /// [`StakeRecord`].  For revenue-share purposes, each staked token counts
    /// as `2 × boost_multiplier(lock_duration_secs)` tokens (staked tokens
    /// are worth more than liquid holdings).
    ///
    /// A single active stake per address is enforced; call `unstake_backit`
    /// first to add a new stake position.
    pub fn stake_backit(
        env: Env,
        staker: Address,
        amount: i128,
        lock_duration_secs: u64,
    ) -> Result<(), BackitError> {
        staker.require_auth();

        get_config(&env).ok_or(BackitError::NotInitialized)?;

        if amount <= 0 {
            return Err(BackitError::InvalidAmount);
        }
        if lock_duration_secs == 0 {
            return Err(BackitError::InvalidLockDuration);
        }
        if get_stake(&env, &staker).is_some() {
            return Err(BackitError::AlreadyStaked);
        }

        let balance = get_balance(&env, &staker);
        if balance < amount {
            return Err(BackitError::InsufficientBalance);
        }

        let boost = boost_multiplier(lock_duration_secs);
        let lock_until = env.ledger().timestamp() + lock_duration_secs;
        let current_fees = get_total_fees_collected(&env);

        // Deduct from liquid balance
        set_balance(&env, &staker, balance - amount);

        let record = StakeRecord {
            amount,
            lock_until,
            boost,
            fees_at_stake: current_fees,
        };
        set_stake(&env, &staker, &record);

        // Reset the claim snapshot to current fees so the staker only earns
        // revenue from this point forward on the staked portion.
        set_last_claim_fees(&env, &staker, current_fees);

        emit_backit_staked(&env, &staker, amount, lock_until);
        Ok(())
    }

    /// Unstake BACKit tokens after the lock period has expired.
    ///
    /// Tokens are returned to the liquid balance.  Any pending revenue share
    /// should be claimed **before** unstaking if the caller wants to capture
    /// the boosted weight for the full lock period.
    pub fn unstake_backit(env: Env, staker: Address) -> Result<(), BackitError> {
        staker.require_auth();

        get_config(&env).ok_or(BackitError::NotInitialized)?;

        let record = get_stake(&env, &staker).ok_or(BackitError::NotStaked)?;

        if env.ledger().timestamp() < record.lock_until {
            return Err(BackitError::LockNotExpired);
        }

        // Return staked tokens to liquid balance
        let balance = get_balance(&env, &staker);
        set_balance(&env, &staker, balance + record.amount);

        remove_stake(&env, &staker);

        emit_backit_unstaked(&env, &staker, record.amount);
        Ok(())
    }

    // ── View functions ───────────────────────────────────────────────────────

    /// Estimate the USDC amount the holder would receive if they called
    /// `claim_revenue_share` right now.
    ///
    /// Returns 0 if there are no fees to claim or the holder has zero
    /// effective balance.
    pub fn get_revenue_share_estimate(env: Env, holder: Address) -> i128 {
        let total_supply = get_total_supply(&env);
        if total_supply == 0 {
            return 0;
        }

        let holder_balance = get_balance(&env, &holder);
        let effective_balance = Self::compute_effective_balance(&env, &holder, holder_balance);

        if effective_balance == 0 {
            return 0;
        }

        let total_fees = get_total_fees_collected(&env);
        let last_claim = get_last_claim_fees(&env, &holder);
        let fees_since_last = total_fees - last_claim;

        if fees_since_last <= 0 {
            return 0;
        }

        fees_since_last * effective_balance / total_supply
    }

    /// Return the staking boost in basis points (bps) for `staker`.
    ///
    /// Formula: `staked_amount * 10_000 / total_supply * boost_multiplier`
    ///
    /// Returns 0 if the staker has no active stake.
    pub fn get_staking_boost(env: Env, staker: Address) -> u32 {
        let total_supply = get_total_supply(&env);
        if total_supply == 0 {
            return 0;
        }

        let record = match get_stake(&env, &staker) {
            Some(r) => r,
            None => return 0,
        };

        // boost_bps = staked_amount * 10_000 / total_supply * boost_multiplier
        let boost_bps =
            (record.amount * 10_000 / total_supply) as u32 * record.boost as u32;
        boost_bps
    }

    /// Return cumulative fees ever deposited into the pool.
    pub fn get_total_fees_collected(env: Env) -> i128 {
        get_total_fees_collected(&env)
    }

    /// Return cumulative USDC ever distributed as revenue share.
    pub fn get_total_revenue_distributed(env: Env) -> i128 {
        get_total_revenue_distributed(&env)
    }

    /// Return the initial distribution record.
    pub fn get_initial_distribution(env: Env) -> Option<InitialDistribution> {
        get_initial_distribution(&env)
    }

    /// Return the active stake record for `staker`, if any.
    pub fn get_stake_record(env: Env, staker: Address) -> Option<StakeRecord> {
        get_stake(&env, &staker)
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /// Compute the effective BACKit balance of `holder` for revenue-share
    /// weight purposes.
    ///
    /// If the holder has an active stake, the staked tokens count as
    /// `2 × boost_multiplier` instead of 1×, capturing both the "staked =
    /// locked = more committed" premium (2×) and the lock-duration multiplier.
    fn compute_effective_balance(env: &Env, holder: &Address, liquid_balance: i128) -> i128 {
        let total_supply = get_total_supply(env);
        match get_stake(env, holder) {
            Some(record) => {
                // Staked tokens: weight = staked_amount * 2 * boost
                let staked_weight = record.amount * 2_i128 * (record.boost as i128);
                let effective = liquid_balance + staked_weight;
                // Cap at total_supply so no holder can claim more than 100% of fees
                if effective > total_supply {
                    total_supply
                } else {
                    effective
                }
            }
            None => liquid_balance,
        }
    }
}
