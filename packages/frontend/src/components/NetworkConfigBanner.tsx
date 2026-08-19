"use client";

import { AlertTriangle } from "lucide-react";
import { useWalletContext } from "./WalletContext";

/**
 * Rendered once at the top of the app. Surfaces network configuration errors
 * (missing/malformed contract IDs, unsupported network) immediately at load so
 * a misconfigured deployment fails clearly instead of failing later at signing.
 */
export default function NetworkConfigBanner() {
  const { networkConfigErrors } = useWalletContext();

  if (networkConfigErrors.length === 0) return null;

  return (
    <div
      role="alert"
      className="border-b border-red-200 bg-red-50 px-4 py-3 text-red-800"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
        <div>
          <p className="text-sm font-semibold">
            BACKit network configuration is incomplete
          </p>
          <ul className="mt-1 list-disc pl-4 text-xs text-red-700">
            {networkConfigErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
