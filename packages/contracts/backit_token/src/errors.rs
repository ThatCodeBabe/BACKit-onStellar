use soroban_sdk::contracterror;

/// Error codes for the BACKit token contract.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum BackitError {
    /// `initialize` called on an already-initialised contract.
    AlreadyInitialized = 1,
    /// A function requiring initialisation was called before `initialize`.
    NotInitialized = 2,
    /// Caller is not authorised for this operation.
    Unauthorized = 3,
    /// The holder has no tokens and therefore no revenue share to claim.
    ZeroBalance = 4,
    /// The fee pool is empty — nothing to distribute.
    NoFeesAvailable = 5,
    /// The staker already has an active stake.
    AlreadyStaked = 6,
    /// No active stake found for this address.
    NotStaked = 7,
    /// The stake lock period has not yet expired.
    LockNotExpired = 8,
    /// Amount is invalid (zero or negative).
    InvalidAmount = 9,
    /// Insufficient token balance for the requested operation.
    InsufficientBalance = 10,
    /// Lock duration provided is zero.
    InvalidLockDuration = 11,
    /// USDC SAC address has not been configured.
    UsdcNotConfigured = 12,
}
