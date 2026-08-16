#![cfg(test)]

use crate::{BackitToken, BackitTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

// ─── Test helpers ────────────────────────────────────────────────────────────

/// Deploy a minimal mock USDC token and return (env, usdc_id, usdc_admin).
fn deploy_usdc(env: &Env) -> (Address, Address) {
    let usdc_admin = Address::generate(env);
    let usdc_id = env.register_stellar_asset_contract_v2(usdc_admin.clone()).address();
    (usdc_id, usdc_admin)
}

/// Deploy the BACKit token contract and return (client, admin address).
fn deploy_backit(env: &Env) -> (BackitTokenClient, Address) {
    let contract_id = env.register(BackitToken, ());
    let client = BackitTokenClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

/// Helper: fully initialize the BACKit contract with five distinct wallets.
/// Returns (client, admin, usdc_id, community, team, treasury, liquidity, airdrop).
#[allow(clippy::type_complexity)]
fn setup_initialized(
    env: &Env,
) -> (
    BackitTokenClient,
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let (client, admin) = deploy_backit(env);
    let (usdc_id, usdc_admin) = deploy_usdc(env);

    let community = Address::generate(env);
    let team = Address::generate(env);
    let treasury = Address::generate(env);
    let liquidity = Address::generate(env);
    let airdrop = Address::generate(env);

    // Admin must authorize initialize
    env.mock_all_auths();

    client.initialize(
        &admin,
        &usdc_id,
        &community,
        &team,
        &treasury,
        &liquidity,
        &airdrop,
    );

    // Mint some USDC to the admin so fee_pool_deposit can pull from it
    let usdc_sac = StellarAssetClient::new(env, &usdc_id);
    usdc_sac.mint(&admin, &10_000_000_0000000_i128);

    let _ = usdc_admin; // silence unused warning
    (
        client, admin, usdc_id, community, team, treasury, liquidity, airdrop,
    )
}

// ─── 1. Initial distribution accuracy ───────────────────────────────────────

#[test]
fn test_initial_distribution_accuracy() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, community, team, treasury, liquidity, airdrop) =
        setup_initialized(&env);

    let total_supply = client.total_supply();
    // 100_000_000 with 7 decimals
    assert_eq!(total_supply, 100_000_000_0000000_i128);

    // 40 % → community
    let expected_community = total_supply * 40 / 100;
    assert_eq!(client.balance(&community), expected_community);

    // 20 % → team
    let expected_team = total_supply * 20 / 100;
    assert_eq!(client.balance(&team), expected_team);

    // 15 % → treasury
    let expected_treasury = total_supply * 15 / 100;
    assert_eq!(client.balance(&treasury), expected_treasury);

    // 15 % → liquidity
    let expected_liquidity = total_supply * 15 / 100;
    assert_eq!(client.balance(&liquidity), expected_liquidity);

    // 10 % → airdrop
    let expected_airdrop = total_supply * 10 / 100;
    assert_eq!(client.balance(&airdrop), expected_airdrop);

    // Balances should sum to exactly the total supply
    let sum = expected_community
        + expected_team
        + expected_treasury
        + expected_liquidity
        + expected_airdrop;
    assert_eq!(sum, total_supply);

    // Distribution record stored correctly
    let dist = client.get_initial_distribution().unwrap();
    assert_eq!(dist.community_rewards_amount, expected_community);
    assert_eq!(dist.team_amount, expected_team);
    assert_eq!(dist.treasury_amount, expected_treasury);
    assert_eq!(dist.liquidity_amount, expected_liquidity);
    assert_eq!(dist.airdrop_amount, expected_airdrop);
}

// ─── 2. Revenue share proportional to holdings ──────────────────────────────

#[test]
fn test_revenue_share_proportional_to_holdings() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _usdc_id, community, _team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    // Deposit 1_000_000 USDC of fees (7-decimal: 1_000_000_0000000 stroops)
    let fee_amount: i128 = 1_000_000_0000000;
    client.fee_pool_deposit(&fee_amount);
    assert_eq!(client.get_total_fees_collected(), fee_amount);

    let total_supply = client.total_supply();

    // community holds 40 % of supply — should receive exactly 40 % of fees
    let community_balance = client.balance(&community);
    let expected_share = fee_amount * community_balance / total_supply;

    let estimate = client.get_revenue_share_estimate(&community);
    assert_eq!(estimate, expected_share);

    let claimed = client.claim_revenue_share(&community);
    assert_eq!(claimed, expected_share);

    // Distributed counter updated
    assert_eq!(client.get_total_revenue_distributed(), claimed);

    // Admin deposited from fee pool — let's verify a second holder gets correct share
    let _ = admin; // admin used in fee_pool_deposit mock auth
}

// ─── 3. No double-claim: second claim before new fees yields error ───────────

#[test]
fn test_no_double_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, community, _team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    let fee_amount: i128 = 500_000_0000000;
    client.fee_pool_deposit(&fee_amount);

    // First claim succeeds
    client.claim_revenue_share(&community);

    // Second claim before any new fees should fail
    let result = client.try_claim_revenue_share(&community);
    assert!(result.is_err());
}

// ─── 4. Staking boost calculation ───────────────────────────────────────────

#[test]
fn test_staking_boost_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, _community, team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    // team holds 20 % → 20_000_000_0000000 tokens
    let stake_amount: i128 = 1_000_000_0000000; // 1 M BACKit
    // 180 days lock → 4× boost
    let lock_duration: u64 = 180 * 24 * 3600;

    client.stake_backit(&team, &stake_amount, &lock_duration);

    let record = client.get_stake_record(&team).unwrap();
    assert_eq!(record.amount, stake_amount);
    assert_eq!(record.boost, 4); // 180+ days → 4×

    // boost_bps = staked * 10_000 / total_supply * boost_multiplier
    let total_supply = client.total_supply();
    let expected_bps = (stake_amount * 10_000 / total_supply) as u32 * 4;
    assert_eq!(client.get_staking_boost(&team), expected_bps);
}

// ─── 5. Lock period enforcement ─────────────────────────────────────────────

#[test]
fn test_lock_period_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, _community, team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    let stake_amount: i128 = 500_000_0000000;
    let lock_secs: u64 = 90 * 24 * 3600; // 90 days

    client.stake_backit(&team, &stake_amount, &lock_secs);

    // Attempting to unstake immediately must fail
    let early_unstake = client.try_unstake_backit(&team);
    assert!(early_unstake.is_err());

    // Advance ledger past the lock
    env.ledger().with_mut(|li| {
        li.timestamp += lock_secs + 1;
    });

    // Now unstake must succeed
    client.unstake_backit(&team);

    // Tokens returned to liquid balance
    let team_balance = client.balance(&team);
    let total = client.total_supply();
    let expected_full = total * 20 / 100; // 20 % was the team allocation
    assert_eq!(team_balance, expected_full);

    // Stake record cleared
    assert!(client.get_stake_record(&team).is_none());
}

// ─── 6. Claim after stake compounds revenue (staked weight = 2× boost) ──────

#[test]
fn test_claim_after_stake_compounds_revenue() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, community, _team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    // community: 40 % supply → 40_000_000_0000000
    let stake_amount: i128 = 10_000_000_0000000; // 10 M
    let lock_secs: u64 = 180 * 24 * 3600; // 4× boost

    // Stake first
    client.stake_backit(&community, &stake_amount, &lock_secs);

    // Deposit fees AFTER stake
    let fees: i128 = 2_000_000_0000000;
    client.fee_pool_deposit(&fees);

    // Effective balance = liquid + staked * 2 * boost
    let liquid = client.balance(&community);
    // liquid = 40_000_000_0000000 - 10_000_000_0000000 = 30_000_000_0000000
    let record = client.get_stake_record(&community).unwrap();
    let effective = liquid + record.amount * 2 * (record.boost as i128);

    let total_supply = client.total_supply();
    let expected_share = fees * effective / total_supply;

    let estimate = client.get_revenue_share_estimate(&community);
    assert_eq!(estimate, expected_share);

    let claimed = client.claim_revenue_share(&community);
    assert_eq!(claimed, expected_share);

    // Staker gets MORE than a non-staking holder with same token count
    // (because effective_balance > raw_balance due to staking weight)
    assert!(claimed > fees * liquid / total_supply);
}

// ─── 7. Cannot initialize twice ──────────────────────────────────────────────

#[test]
fn test_cannot_initialize_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, usdc_id, community, team, treasury, liquidity, airdrop) =
        setup_initialized(&env);

    let result = client.try_initialize(
        &admin, &usdc_id, &community, &team, &treasury, &liquidity, &airdrop,
    );
    assert!(result.is_err());
}

// ─── 8. Cannot stake twice without unstaking first ───────────────────────────

#[test]
fn test_cannot_double_stake() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, _community, team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    let amount: i128 = 1_000_000_0000000;
    let lock: u64 = 30 * 24 * 3600;

    client.stake_backit(&team, &amount, &lock);

    // Second stake before unlock must fail
    let result = client.try_stake_backit(&team, &amount, &lock);
    assert!(result.is_err());
}

// ─── 9. Transfer basic functionality ─────────────────────────────────────────

#[test]
fn test_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, community, team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    let total_supply = client.total_supply();
    let community_initial = total_supply * 40 / 100;
    let team_initial = total_supply * 20 / 100;

    let transfer_amount: i128 = 1_000_0000000; // 1 000 BACKit

    client.transfer(&community, &team, &transfer_amount);

    assert_eq!(client.balance(&community), community_initial - transfer_amount);
    assert_eq!(client.balance(&team), team_initial + transfer_amount);
}

// ─── 10. Zero-balance holder gets ZeroBalance error ──────────────────────────

#[test]
fn test_zero_balance_claim_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _usdc_id, _community, _team, _treasury, _liquidity, _airdrop) =
        setup_initialized(&env);

    let fees: i128 = 100_0000000;
    client.fee_pool_deposit(&fees);

    // Random address with zero balance
    let nobody = Address::generate(&env);
    let result = client.try_claim_revenue_share(&nobody);
    assert!(result.is_err());
}
