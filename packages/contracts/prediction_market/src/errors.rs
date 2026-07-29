use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum MarketError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidStakeAmount = 3,
    InvalidEndTime = 4,
    CallNotFound = 5,
    CallEnded = 6,
    CallSettled = 7,
    InvalidPosition = 8,
    Unauthorized = 9,
    ContractPaused = 10,
    CallNotEnded = 11,
    InvalidOutcome = 12,
    InvalidOutcomeCount = 13,
    StakingCutoffActive = 15,
    InvalidCallId = 16,
    ReserveDiscrepancy = 17,
    NotEligibleForBonus = 18,
    /// #465: checked arithmetic overflowed.
    Overflow = 19,
    /// #465: no limit order exists with the given id.
    OrderNotFound = 20,
    /// #465: caller is not the owner of the limit order.
    NotOrderOwner = 21,
    /// #465: `target_implied_probability_bps` is out of the valid 0..=10_000 range.
    InvalidTargetProbability = 22,
    /// #465: `ttl_secs` is zero or exceeds the maximum allowed order lifetime.
    InvalidOrderTTL = 23,
    /// #465: the order has not yet expired, so it cannot be force-refunded.
    OrderNotExpired = 24,
    /// Rollover percentage exceeds 100% (10_000 bps).
    InvalidRolloverPercentage = 25,
    /// User has no stake on the winning outcome.
    NoWinningStake = 26,
    /// Rollover amount is below the minimum stake for the new market.
    RolloverInsufficientAmount = 27,
    /// The call has not been settled yet.
    CallNotSettled = 28,
}
