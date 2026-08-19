import { describe, expect, it } from "vitest";
import {
  compareNetworks,
  isValidContractId,
  normalizeNetworkName,
  parseNetworkConfig,
  resolveNetworkMatch,
  SUPPORTED_NETWORKS,
  type NetworkConfigEnv,
} from "./networkConfig";

const VALID_ID = "C" + "A".repeat(55);
const VALID_ID_2 = "C" + "B".repeat(55);

function validEnv(overrides: NetworkConfigEnv = {}): NetworkConfigEnv {
  return {
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    NEXT_PUBLIC_CALL_REGISTRY_CONTRACT_ID: VALID_ID,
    NEXT_PUBLIC_OUTCOME_MANAGER_CONTRACT_ID: VALID_ID_2,
    ...overrides,
  };
}

describe("normalizeNetworkName", () => {
  it("maps supported wallet-reported network names", () => {
    expect(normalizeNetworkName("PUBLIC")).toBe("PUBLIC");
    expect(normalizeNetworkName("TESTNET")).toBe("TESTNET");
    expect(normalizeNetworkName("FUTURENET")).toBe("FUTURENET");
  });

  it("maps common aliases and passphrases", () => {
    expect(normalizeNetworkName("mainnet")).toBe("PUBLIC");
    expect(normalizeNetworkName("pubnet")).toBe("PUBLIC");
    expect(normalizeNetworkName("Test SDF Network ; September 2015")).toBe(
      "TESTNET",
    );
    expect(
      normalizeNetworkName("Public Global Stellar Network ; September 2015"),
    ).toBe("PUBLIC");
  });

  it("returns null for unknown or missing networks", () => {
    expect(normalizeNetworkName("my-custom-network")).toBeNull();
    expect(normalizeNetworkName("")).toBeNull();
    expect(normalizeNetworkName(undefined)).toBeNull();
    expect(normalizeNetworkName(null)).toBeNull();
  });
});

describe("isValidContractId", () => {
  it("accepts a 56-char base32 contract id", () => {
    expect(isValidContractId(VALID_ID)).toBe(true);
    // The XLM SAC wrapper is a real, special contract id.
    expect(
      isValidContractId(
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      ),
    ).toBe(true);
  });

  it("rejects malformed contract ids", () => {
    expect(isValidContractId("GACCOUNT")).toBe(false);
    expect(isValidContractId("Cshort")).toBe(false);
    expect(isValidContractId("")).toBe(false);
    expect(isValidContractId(undefined)).toBe(false);
    expect(isValidContractId(123)).toBe(false);
  });
});

describe("parseNetworkConfig", () => {
  it("resolves a valid testnet configuration", () => {
    const result = parseNetworkConfig(validEnv());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.config.name).toBe("TESTNET");
    expect(result.config.networkPassphrase).toBe(
      SUPPORTED_NETWORKS.TESTNET.networkPassphrase,
    );
    expect(result.config.contractIds.callRegistry).toBe(VALID_ID);
    expect(result.config.contractIds.outcomeManager).toBe(VALID_ID_2);
    expect(result.config.contractIds.usdcSac).toBe(
      "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    );
  });

  it("resolves mainnet and futurenet from their aliases", () => {
    const mainnet = parseNetworkConfig(
      validEnv({ NEXT_PUBLIC_STELLAR_NETWORK: "mainnet" }),
    );
    const futurenet = parseNetworkConfig(
      validEnv({ NEXT_PUBLIC_STELLAR_NETWORK: "futurenet" }),
    );
    expect(mainnet.status).toBe("ok");
    expect(futurenet.status).toBe("ok");
    if (mainnet.status === "ok") expect(mainnet.config.name).toBe("PUBLIC");
    if (futurenet.status === "ok")
      expect(futurenet.config.name).toBe("FUTURENET");
  });

  it("fails clearly when required contract ids are absent", () => {
    const result = parseNetworkConfig({
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.join("\n")).toContain(
      "NEXT_PUBLIC_CALL_REGISTRY_CONTRACT_ID",
    );
    expect(result.errors.join("\n")).toContain(
      "NEXT_PUBLIC_OUTCOME_MANAGER_CONTRACT_ID",
    );
  });

  it("fails clearly when a contract id is malformed", () => {
    const result = parseNetworkConfig(
      validEnv({ NEXT_PUBLIC_OUTCOME_MANAGER_CONTRACT_ID: "Cshort" }),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors[0]).toContain("not a valid Stellar contract ID");
  });

  it("fails clearly for an unsupported network", () => {
    const result = parseNetworkConfig(
      validEnv({ NEXT_PUBLIC_STELLAR_NETWORK: "polygon" }),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors[0]).toContain("not supported");
  });

  it("allows explicit passphrase, rpc and horizon overrides", () => {
    const result = parseNetworkConfig(
      validEnv({
        NEXT_PUBLIC_NETWORK_PASSPHRASE: "Custom Passphrase",
        NEXT_PUBLIC_SOROBAN_RPC_URL: "https://rpc.example.com",
        NEXT_PUBLIC_HORIZON_URL: "https://horizon.example.com",
      }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.config.networkPassphrase).toBe("Custom Passphrase");
    expect(result.config.rpcUrl).toBe("https://rpc.example.com");
    expect(result.config.horizonUrl).toBe("https://horizon.example.com");
  });
});

describe("compareNetworks / resolveNetworkMatch", () => {
  const parsed = parseNetworkConfig(validEnv());
  if (parsed.status !== "ok") throw new Error("validEnv must parse");
  const config = parsed.config;

  it("matches a wallet on the configured network", () => {
    expect(compareNetworks("TESTNET", config)).toEqual({ status: "match" });
    expect(resolveNetworkMatch("TESTNET", { status: "ok", config })).toEqual({
      status: "match",
    });
  });

  it("mismatches a wallet on a different network", () => {
    expect(compareNetworks("PUBLIC", config)).toEqual({
      status: "mismatch",
      active: "PUBLIC",
      configured: "TESTNET",
    });
  });

  it("reports an unknown active network", () => {
    expect(compareNetworks("some-custom-network", config)).toEqual({
      status: "unknown-active",
      configured: "TESTNET",
    });
  });

  it("reports a disconnected wallet as match (callers gate on isConnected)", () => {
    expect(resolveNetworkMatch(null, { status: "ok", config })).toEqual({
      status: "match",
    });
  });

  it("surfaces config errors ahead of comparison", () => {
    const result = resolveNetworkMatch("TESTNET", {
      status: "error",
      errors: ["bad config"],
    });
    expect(result).toEqual({ status: "config-error", errors: ["bad config"] });
  });
});
