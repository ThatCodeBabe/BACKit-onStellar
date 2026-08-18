"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { useWallet, WalletState, WalletType } from "../hooks/useWallet";
import {
  useProfile,
  UserProfile,
  ProfileSaveStatus,
} from "../hooks/useProfile";
import {
  getNetworkConfig,
  NetworkConfigError,
  NetworkMismatchError,
  resolveNetworkMatch,
  type NetworkMatch,
  type StellarNetworkName,
} from "@/lib/networkConfig";

interface WalletContextValue {
  // Wallet
  wallet: WalletState;
  publicKey: string | null;
  shortAddress: string | null;
  isConnected: boolean;
  walletType: WalletType | null;
  installedWallets: Record<WalletType, boolean> | null;
  /** @deprecated use installedWallets.freighter */
  isFreighterInstalled: boolean | null;
  connect: (walletType: WalletType) => Promise<void>;
  disconnect: () => void;

  // Network safety
  /** Wallet-reported network name (e.g. `PUBLIC` / `TESTNET`), when connected. */
  network: string | null;
  /** How the active wallet network compares to the configured deployment. */
  networkStatus: NetworkMatch;
  /** The configured deployment network, when config is valid. */
  configuredNetwork: StellarNetworkName | null;
  /** Config errors surfaced at load (missing/malformed contract IDs, etc.). */
  networkConfigErrors: string[];
  /** Throws unless the wallet network matches the configured deployment. */
  requireNetworkMatch: () => void;

  // Profile
  profile: UserProfile | null;
  isProfileLoading: boolean;
  saveStatus: ProfileSaveStatus;
  saveProfile: (
    updates: Partial<Pick<UserProfile, "displayName" | "bio" | "avatarUrl">>,
  ) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const walletHook = useWallet();
  const profileHook = useProfile(walletHook.publicKey);

  const configResult = useMemo(() => getNetworkConfig(), []);
  const networkStatus = useMemo(
    () => resolveNetworkMatch(walletHook.network, configResult),
    [walletHook.network, configResult],
  );
  const configuredNetwork =
    configResult.status === "ok" ? configResult.config.name : null;
  const networkConfigErrors =
    configResult.status === "error" ? configResult.errors : [];

  const requireNetworkMatch = useCallback(() => {
    if (configResult.status === "error") {
      throw new NetworkConfigError(configResult.errors);
    }
    if (networkStatus.status === "mismatch") {
      throw new NetworkMismatchError(networkStatus);
    }
    if (networkStatus.status === "unknown-active") {
      throw new NetworkMismatchError(networkStatus);
    }
  }, [configResult, networkStatus]);

  useEffect(() => {
    if (!walletHook.isConnected) {
      profileHook.clearProfile();
    }
  }, [walletHook.isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: WalletContextValue = {
    wallet: walletHook.wallet,
    publicKey: walletHook.publicKey,
    shortAddress: walletHook.shortAddress,
    isConnected: walletHook.isConnected,
    walletType: walletHook.walletType,
    installedWallets: walletHook.installedWallets,
    isFreighterInstalled: walletHook.isFreighterInstalled,
    connect: walletHook.connect,
    disconnect: walletHook.disconnect,
    network: walletHook.network,
    networkStatus,
    configuredNetwork,
    networkConfigErrors,
    requireNetworkMatch,
    profile: profileHook.profile,
    isProfileLoading: profileHook.isLoading,
    saveStatus: profileHook.saveStatus,
    saveProfile: profileHook.saveProfile,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx)
    throw new Error("useWalletContext must be used within <WalletProvider>");
  return ctx;
}
