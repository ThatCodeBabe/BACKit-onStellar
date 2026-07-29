//! Local mirror of CallRegistry types for cross-contract deserialisation.
//! These must stay in sync with `call_registry/src/types.rs` and
//! `call_registry/src/errors.rs`.

use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Map, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum CallRegistryError {
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
    FeeTooHigh = 14,
    StakingCutoffActive = 15,
    Sep10TokenExpired = 16,
    ReentrancyDetected = 17,
    Overflow = 18,
    EmptyBasket = 19,
    InvalidCondition = 20,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum BasketLogic {
    AllOf,
    AnyOf,
    Weighted(u32),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum LeafConditionType {
    TargetAbove(i128),
    TargetBelow(i128),
    PercentUp(u32),
    PercentDown(u32),
    Range(i128, i128),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetCondition {
    pub token_address: Address,
    pub pair_id: Bytes,
    pub condition: LeafConditionType,
    pub weight_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BasketCall {
    pub conditions: Vec<AssetCondition>,
    pub logic: BasketLogic,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ConditionType {
    TargetAbove(i128),
    TargetBelow(i128),
    PercentUp(u32),
    PercentDown(u32),
    Range(i128, i128),
    Basket(BasketCall),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub id: u64,
    pub creator: Address,
    pub stake_token: Address,
    pub stake_amount: i128,
    pub end_ts: u64,
    pub token_address: Address,
    pub pair_id: Bytes,
    pub metadata_hash: BytesN<32>,
    pub outcome_count: u32,
    pub outcome_stakes: Map<u32, i128>,
    pub stakes: Map<u32, Map<Address, i128>>,
    pub outcome: u32,
    pub start_price: i128,
    pub end_price: i128,
    pub condition: ConditionType,
    pub settled: bool,
    pub voided: bool,
    pub unresolvable: bool,
    pub created_at: u64,
    pub cancelled: bool,
    pub metadata_version: u32,
    pub share_tokens: Map<u32, Address>,
}
