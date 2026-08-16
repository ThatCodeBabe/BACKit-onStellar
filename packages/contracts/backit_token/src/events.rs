use soroban_sdk::{Address, Env};

/// Emitted when a holder claims their pro-rata USDC revenue share.
pub fn emit_revenue_claimed(env: &Env, holder: &Address, amount: i128) {
    env.events().publish(
        (
            soroban_sdk::symbol_short!("rev_claim"),
            soroban_sdk::symbol_short!("claimed"),
        ),
        (holder.clone(), amount),
    );
}

/// Emitted when a holder stakes BACKit tokens for a lock period.
pub fn emit_backit_staked(env: &Env, staker: &Address, amount: i128, lock_until: u64) {
    env.events().publish(
        (
            soroban_sdk::symbol_short!("backit"),
            soroban_sdk::symbol_short!("staked"),
        ),
        (staker.clone(), amount, lock_until),
    );
}

/// Emitted when a staker reclaims their staked BACKit after lock expiry.
pub fn emit_backit_unstaked(env: &Env, staker: &Address, amount: i128) {
    env.events().publish(
        (
            soroban_sdk::symbol_short!("backit"),
            soroban_sdk::symbol_short!("unstaked"),
        ),
        (staker.clone(), amount),
    );
}

/// Emitted when the admin deposits fees into the revenue pool.
pub fn emit_fee_deposited(env: &Env, depositor: &Address, amount: i128) {
    env.events().publish(
        (
            soroban_sdk::symbol_short!("fee_pool"),
            soroban_sdk::symbol_short!("deposit"),
        ),
        (depositor.clone(), amount),
    );
}

/// Emitted once at contract initialisation.
pub fn emit_initialized(env: &Env, admin: &Address, total_supply: i128) {
    env.events().publish(
        (
            soroban_sdk::symbol_short!("backit"),
            soroban_sdk::symbol_short!("init"),
        ),
        (admin.clone(), total_supply),
    );
}
