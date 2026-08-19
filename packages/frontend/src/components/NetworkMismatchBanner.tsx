"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useWalletContext } from "./WalletContext";
import {
  SUPPORTED_NETWORKS,
  networkMismatchMessage,
} from "@/lib/networkConfig";

/**
 * Shared network-guard surface. Renders nothing when the wallet network matches
 * the configured deployment, otherwise explains the problem and offers a
 * recovery action instead of letting a transaction fail later at signing time.
 */
export default function NetworkMismatchBanner() {
  const { networkStatus, configuredNetwork, walletType, disconnect } =
    useWalletContext();

  if (networkStatus.status === "match") return null;

  const isConfigError = networkStatus.status === "config-error";
  const configuredLabel = configuredNetwork
    ? SUPPORTED_NETWORKS[configuredNetwork].label
    : "the configured network";
  const walletLabel = walletType
    ? walletType.charAt(0).toUpperCase() + walletType.slice(1)
    : "your wallet";

  return (
    <div
      role="alert"
      className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 sm:flex-row sm:items-center"
    >
      <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
      <div className="flex-1">
        <p className="text-sm font-semibold">
          {isConfigError
            ? "Network configuration is incomplete"
            : "Wallet network mismatch"}
        </p>
        <p className="mt-1 whitespace-pre-line text-xs text-amber-700">
          {networkMismatchMessage(networkStatus)}
        </p>
      </div>
      {!isConfigError && (
        <button
          onClick={disconnect}
          className="inline-flex items-center gap-1.5 self-start rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-amber-700 sm:self-center"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {`Reconnect ${walletLabel} on ${configuredLabel}`}
        </button>
      )}
    </div>
  );
}
