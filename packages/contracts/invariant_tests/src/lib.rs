// invariant_tests: stateful invariant and differential test harness (issue #563).
// All production logic lives in the modules below; this lib has no runtime API.
#![allow(dead_code)]

pub mod assertions;
pub mod generator;
pub mod model;

#[cfg(test)]
mod tests;
