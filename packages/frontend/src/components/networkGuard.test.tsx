import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  toStroops,
  type Market,
  type MarketOdds,
  type PortfolioStake,
} from "@/lib/backend";
import type { NetworkMatch, StellarNetworkName } from "@/lib/networkConfig";
import StakingInterface from "./StakingInterface";
import ClaimPayout from "./ClaimPayout";
import CreateCallForm from "./CreateCallForm";

const { walletContext } = vi.hoisted(() => {
  const walletContext: {
    publicKey: string | null;
    walletType: string | null;
    isConnected: boolean;
    network: string | null;
    networkStatus: NetworkMatch;
    requireNetworkMatch: () => void;
    configuredNetwork: StellarNetworkName | null;
    networkConfigErrors: string[];
    disconnect: () => void;
  } = {
    publicKey: "GSTAKER",
    walletType: "freighter",
    isConnected: true,
    network: "PUBLIC",
    networkStatus: {
      status: "mismatch",
      active: "PUBLIC",
      configured: "TESTNET",
    },
    requireNetworkMatch: () => {
      throw new Error("NetworkMismatchError");
    },
    configuredNetwork: "TESTNET",
    networkConfigErrors: [],
    disconnect: () => {},
  };
  return { walletContext };
});

vi.mock("./WalletContext", () => ({
  useWalletContext: () => walletContext,
}));

vi.mock("./GasFeeDisplay", () => ({ default: () => null }));
vi.mock("./PayoutCalculator", () => ({ default: () => null }));

const submitStakeMock = vi.fn();
const claimPayoutMock = vi.fn();

vi.mock("@/lib/backend", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    submitStake: (...args: unknown[]) => submitStakeMock(...args),
    claimPayout: (...args: unknown[]) => claimPayoutMock(...args),
  };
});

// Keep the create wizard light: each step exposes a single "set" button.
vi.mock("@/components/create/ProgressIndicator", () => ({
  default: () => null,
}));
vi.mock("@/components/create/ReviewSubmitStep", () => ({
  default: () => <div>review-step</div>,
}));
vi.mock("@/components/create/TokenSelectionStep", () => ({
  default: ({ onSelect }: any) => (
    <button
      onClick={() =>
        onSelect({
          symbol: "BTC/USDC",
          name: "Bitcoin",
          base: "BTC",
          quote: "USDC",
          price: 1,
          change24h: 0,
        })
      }
    >
      select-token
    </button>
  ),
}));
vi.mock("@/components/create/ConditionBuilderStep", () => ({
  default: ({ onChange }: any) => (
    <button
      onClick={() =>
        onChange({
          type: "TARGET",
          comparator: "ABOVE",
          targetPrice: "50000",
          direction: "UP",
          percentChange: "",
          rangeMin: "",
          rangeMax: "",
        })
      }
    >
      set-condition
    </button>
  ),
}));
vi.mock("@/components/create/ThesisStep", () => ({
  default: ({ onChange }: any) => (
    <button
      onClick={() => onChange("A sufficiently long thesis for this market.")}
    >
      set-thesis
    </button>
  ),
}));
vi.mock("@/components/create/StakeDurationStep", () => ({
  default: ({ onStakeAmountChange, onExpiryChange }: any) => (
    <button
      onClick={() => {
        onStakeAmountChange("10");
        onExpiryChange("2030-01-01T00:00");
      }}
    >
      set-stake
    </button>
  ),
}));

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "call-1",
    title: "BTC over 50k",
    thesis: "thesis",
    condition: "BTC > $50k",
    conditionJson: null,
    creatorAddress: "GCREATOR",
    pairId: "BTC/USDC",
    tokenSymbol: "BTC",
    stakeToken: "USDC",
    contractAddress: null,
    status: "OPEN",
    outcome: "PENDING",
    resolved: false,
    endTime: "2030-01-01T00:00:00.000Z",
    resolvedAt: null,
    createdAt: "2029-01-01T00:00:00.000Z",
    totalYesStroops: 1000n,
    totalNoStroops: 1000n,
    currentPrice: null,
    startPrice: null,
    targetPrice: null,
    isBookmarked: false,
    bookmarkCount: 0,
    ...overrides,
  };
}

const odds: MarketOdds = {
  yes: "2.0000",
  no: "2.0000",
  totalPoolStroops: 2000n,
};

function makeStake(overrides: Partial<PortfolioStake> = {}): PortfolioStake {
  return {
    id: "stake-1",
    callId: "call-1",
    userAddress: "GSTAKER",
    position: "YES",
    amountStroops: toStroops("100"),
    profitLossStroops: null,
    payoutStroops: toStroops("200"),
    transactionHash: "tx-1",
    createdAt: "2029-01-01T00:00:00.000Z",
    updatedAt: "2029-01-01T00:00:00.000Z",
    status: "CLAIMABLE",
    claimTxHash: null,
    claimedAt: null,
    call: {
      id: "call-1",
      title: "BTC over 50k",
      description: "desc",
      outcome: "YES",
      resolvedAt: "2030-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
      createdAt: "2029-01-01T00:00:00.000Z",
      contractAddress: null,
      totalYesStroops: 1000n,
      totalNoStroops: 1000n,
    },
    ...overrides,
  };
}

beforeEach(() => {
  walletContext.publicKey = "GSTAKER";
  walletContext.walletType = "freighter";
  walletContext.isConnected = true;
  walletContext.network = "PUBLIC";
  walletContext.networkStatus = {
    status: "mismatch",
    active: "PUBLIC",
    configured: "TESTNET",
  };
  walletContext.requireNetworkMatch = () => {
    throw new Error("NetworkMismatchError");
  };
  walletContext.configuredNetwork = "TESTNET";
  walletContext.networkConfigErrors = [];
  walletContext.disconnect = () => {};
  submitStakeMock.mockReset();
  claimPayoutMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StakingInterface network guard", () => {
  it("blocks staking and shows recovery on network mismatch", async () => {
    render(<StakingInterface market={makeMarket()} odds={odds} />);

    await userEvent.click(screen.getByRole("button", { name: /market yes/i }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/switch your wallet to testnet/i);
    expect(
      screen.getByRole("button", { name: /stake on yes/i }),
    ).toBeDisabled();
    expect(submitStakeMock).not.toHaveBeenCalled();
  });

  it("allows staking when the wallet matches the configured network", async () => {
    walletContext.network = "TESTNET";
    walletContext.networkStatus = { status: "match" };
    walletContext.requireNetworkMatch = () => {};

    render(<StakingInterface market={makeMarket()} odds={odds} />);

    await userEvent.click(screen.getByRole("button", { name: /market yes/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stake on yes/i })).toBeEnabled();
  });
});

describe("ClaimPayout network guard", () => {
  it("blocks claiming and shows recovery on network mismatch", async () => {
    render(<ClaimPayout market={makeMarket()} stake={makeStake()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /switch your wallet to testnet/i,
    );
    expect(screen.getByRole("button", { name: /claim/i })).toBeDisabled();
    expect(claimPayoutMock).not.toHaveBeenCalled();
  });

  it("allows claiming when the wallet matches the configured network", async () => {
    walletContext.network = "TESTNET";
    walletContext.networkStatus = { status: "match" };
    walletContext.requireNetworkMatch = () => {};

    render(<ClaimPayout market={makeMarket()} stake={makeStake()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /claim/i })).toBeEnabled();
  });
});

describe("CreateCallForm network guard", () => {
  it("blocks create submission and shows recovery on network mismatch", async () => {
    render(<CreateCallForm />);

    await userEvent.click(
      screen.getByRole("button", { name: /select-token/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /set-condition/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /set-thesis/i }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /set-stake/i }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("review-step")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /switch your wallet to testnet/i,
    );
    expect(
      screen.getByRole("button", { name: /confirm & create/i }),
    ).toBeDisabled();
  });
});
