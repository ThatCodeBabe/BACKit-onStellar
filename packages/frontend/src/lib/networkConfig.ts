/**
 * Single frontend network configuration boundary.
 *
 * The connected wallet's network, the Soroban RPC network and the deployed
 * contract IDs must all describe the same Stellar network before any
 * transaction is signed. This module is the one place that:
 *
 *   - types the network (passphrase, RPC URL, Horizon URL, contract IDs),
 *   - validates required contract IDs and fails loudly when they are absent
 *     or malformed, and
 *   - normalises a wallet-reported network so it can be compared against the
 *     configured deployment.
 *
 * Everything is a pure function of an env-like object so it can be unit tested
 * without touching `process.env`.
 */

export type StellarNetworkName = "PUBLIC" | "TESTNET" | "FUTURENET";

export interface SupportedNetwork {
  /** Canonical name used throughout the codebase. */
  name: StellarNetworkName;
  /** Human label shown in the UI, e.g. "Mainnet". */
  label: string;
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  /** Base URL for the Stellar.Expert explorer for this network. */
  explorerBaseUrl: string;
}

export interface NetworkContractIds {
  callRegistry: string;
  outcomeManager: string;
  /** Optional SAC wrapper for the pool asset (USDC). Empty when unknown. */
  usdcSac: string;
}

export interface NetworkConfig extends SupportedNetwork {
  contractIds: NetworkContractIds;
}

export type NetworkConfigResult =
  | { status: "ok"; config: NetworkConfig }
  | { status: "error"; errors: string[] };

/** Result of comparing the active wallet network to the configured deployment. */
export type NetworkMatch =
  | { status: "match" }
  | {
      status: "mismatch";
      active: StellarNetworkName;
      configured: StellarNetworkName;
    }
  | { status: "unknown-active"; configured: StellarNetworkName }
  | { status: "config-error"; errors: string[] };

export class NetworkConfigError extends Error {
  constructor(readonly errors: string[]) {
    super(`Network configuration is invalid:\n- ${errors.join("\n- ")}`);
    this.name = "NetworkConfigError";
  }
}

export class NetworkMismatchError extends Error {
  constructor(readonly match: NetworkMatch) {
    super(networkMismatchMessage(match));
    this.name = "NetworkMismatchError";
  }
}

/** Stellar contract IDs are 56 base32 chars starting with `C`. */
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;

const NETWORK_ALIASES: Record<string, StellarNetworkName> = {
  public: "PUBLIC",
  mainnet: "PUBLIC",
  pubnet: "PUBLIC",
  testnet: "TESTNET",
  futurenet: "FUTURENET",
  "public global stellar network ; september 2015": "PUBLIC",
  "test sdf network ; september 2015": "TESTNET",
  "test sdf future network ; october 2022": "FUTURENET",
};

export const SUPPORTED_NETWORKS: Record<StellarNetworkName, SupportedNetwork> =
  {
    PUBLIC: {
      name: "PUBLIC",
      label: "Mainnet",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      rpcUrl: "https://mainnet.sorobanrpc.com",
      horizonUrl: "https://horizon.stellar.org",
      explorerBaseUrl: "https://stellar.expert/explorer/public",
    },
    TESTNET: {
      name: "TESTNET",
      label: "Testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      horizonUrl: "https://horizon-testnet.stellar.org",
      explorerBaseUrl: "https://stellar.expert/explorer/testnet",
    },
    FUTURENET: {
      name: "FUTURENET",
      label: "Futurenet",
      networkPassphrase: "Test SDF Future Network ; October 2022",
      rpcUrl: "https://rpc-futurenet.stellar.org",
      horizonUrl: "https://horizon-futurenet.stellar.org",
      explorerBaseUrl: "https://stellar.expert/explorer/futurenet",
    },
  };

/** Known SAC wrapper IDs so the optional `usdcSac` has a sane per-network default. */
const DEFAULT_USDC_SAC: Partial<Record<StellarNetworkName, string>> = {
  TESTNET: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  PUBLIC: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
};

export interface NetworkConfigEnv {
  [key: string]: string | undefined;
  NEXT_PUBLIC_STELLAR_NETWORK?: string;
  NEXT_PUBLIC_NETWORK_PASSPHRASE?: string;
  NEXT_PUBLIC_SOROBAN_RPC_URL?: string;
  NEXT_PUBLIC_HORIZON_URL?: string;
  NEXT_PUBLIC_CALL_REGISTRY_CONTRACT_ID?: string;
  NEXT_PUBLIC_OUTCOME_MANAGER_CONTRACT_ID?: string;
  NEXT_PUBLIC_USDC_SAC_CONTRACT_ID?: string;
}

/** Contract IDs that must be present and well-formed before any signing. */
export const REQUIRED_CONTRACT_IDS = [
  "callRegistry",
  "outcomeManager",
] as const;

export function isValidContractId(value: unknown): value is string {
  return typeof value === "string" && CONTRACT_ID_PATTERN.test(value);
}

/**
 * Normalise a wallet-reported network into a {@link StellarNetworkName}.
 * Accepts Freighter's `PUBLIC`/`TESTNET`/`FUTURENET`, common aliases
 * (`mainnet`, `pubnet`) and network passphrases. Returns `null` for anything
 * unrecognised (including custom/local networks).
 */
export function normalizeNetworkName(
  input: string | null | undefined,
): StellarNetworkName | null {
  if (!input) return null;
  const alias = NETWORK_ALIASES[input.trim().toLowerCase()];
  if (alias) return alias;
  const upper = input.trim().toUpperCase();
  if (upper === "PUBLIC" || upper === "TESTNET" || upper === "FUTURENET") {
    return upper;
  }
  return null;
}

function networkLabel(name: StellarNetworkName | null | undefined): string {
  return name ? SUPPORTED_NETWORKS[name].label : "an unknown network";
}

/** Human-readable, user-facing description of a network mismatch. */
export function networkMismatchMessage(match: NetworkMatch): string {
  switch (match.status) {
    case "mismatch":
      return (
        `Your wallet is on ${networkLabel(match.active)} but BACKit is ` +
        `configured for ${networkLabel(match.configured)}. Switch your wallet ` +
        `to ${networkLabel(match.configured)} before signing.`
      );
    case "unknown-active":
      return (
        `Could not determine your wallet's network. Switch your wallet to ` +
        `${networkLabel(match.configured)} before signing.`
      );
    case "config-error":
      return `Network configuration is invalid:\n- ${match.errors.join("\n- ")}`;
    default:
      return "Network mismatch.";
  }
}

/**
 * Parse and validate the network configuration from an env-like object.
 * Returns a list of actionable errors instead of throwing so callers can
 * render them clearly at configuration load.
 */
export function parseNetworkConfig(
  env: NetworkConfigEnv = process.env,
): NetworkConfigResult {
  const errors: string[] = [];

  const networkKey = (env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet")
    .trim()
    .toLowerCase();
  const networkName = NETWORK_ALIASES[networkKey];
  if (!networkName) {
    return {
      status: "error",
      errors: [
        `NEXT_PUBLIC_STELLAR_NETWORK "${env.NEXT_PUBLIC_STELLAR_NETWORK}" is ` +
          `not supported. Expected one of: testnet, mainnet, futurenet.`,
      ],
    };
  }
  const base = SUPPORTED_NETWORKS[networkName];

  const callRegistry = env.NEXT_PUBLIC_CALL_REGISTRY_CONTRACT_ID;
  const outcomeManager = env.NEXT_PUBLIC_OUTCOME_MANAGER_CONTRACT_ID;
  const usdcSac = env.NEXT_PUBLIC_USDC_SAC_CONTRACT_ID;

  const validateContract = (label: string, value: string | undefined) => {
    if (!value) {
      errors.push(`${label} is required but not set.`);
    } else if (!isValidContractId(value)) {
      errors.push(`${label} "${value}" is not a valid Stellar contract ID.`);
    }
  };
  validateContract("NEXT_PUBLIC_CALL_REGISTRY_CONTRACT_ID", callRegistry);
  validateContract("NEXT_PUBLIC_OUTCOME_MANAGER_CONTRACT_ID", outcomeManager);

  if (usdcSac !== undefined && usdcSac !== "" && !isValidContractId(usdcSac)) {
    errors.push(
      `NEXT_PUBLIC_USDC_SAC_CONTRACT_ID "${usdcSac}" is not a valid Stellar ` +
        `contract ID.`,
    );
  }

  if (errors.length > 0) return { status: "error", errors };

  const networkPassphrase =
    env.NEXT_PUBLIC_NETWORK_PASSPHRASE?.trim() || base.networkPassphrase;
  const rpcUrl = env.NEXT_PUBLIC_SOROBAN_RPC_URL?.trim() || base.rpcUrl;
  const horizonUrl = env.NEXT_PUBLIC_HORIZON_URL?.trim() || base.horizonUrl;

  return {
    status: "ok",
    config: {
      name: base.name,
      label: base.label,
      networkPassphrase,
      rpcUrl,
      horizonUrl,
      explorerBaseUrl: base.explorerBaseUrl,
      contractIds: {
        callRegistry: callRegistry as string,
        outcomeManager: outcomeManager as string,
        usdcSac: usdcSac?.trim() || DEFAULT_USDC_SAC[networkName] || "",
      },
    },
  };
}

let cachedConfig: NetworkConfigResult | null = null;

/** Read the validated network configuration once per runtime. */
export function getNetworkConfig(): NetworkConfigResult {
  if (!cachedConfig) cachedConfig = parseNetworkConfig(process.env);
  return cachedConfig;
}

/** Reset the memoised config (used by tests). */
export function resetNetworkConfigCache(): void {
  cachedConfig = null;
}

/**
 * Compare a connected wallet's reported network against a validated config.
 * An unrecognised network name (custom/local network) is `unknown-active`.
 */
export function compareNetworks(
  activeNetwork: string,
  config: NetworkConfig,
): NetworkMatch {
  const active = normalizeNetworkName(activeNetwork);
  if (!active) return { status: "unknown-active", configured: config.name };
  if (active === config.name) {
    return { status: "match" };
  }
  return { status: "mismatch", active, configured: config.name };
}

/**
 * Combine config validation with wallet-network comparison in one step.
 * A disconnected wallet (no active network) is reported as `match` — callers
 * gate on `isConnected` separately and never sign while disconnected.
 */
export function resolveNetworkMatch(
  activeNetwork: string | null | undefined,
  configResult: NetworkConfigResult,
): NetworkMatch {
  if (configResult.status === "error") {
    return { status: "config-error", errors: configResult.errors };
  }
  if (!activeNetwork) return { status: "match" };
  return compareNetworks(activeNetwork, configResult.config);
}
