import {
  isConnected,
  setAllowed,
  signTransaction,
} from "@stellar/freighter-api";
import { getNetworkConfig, NetworkConfigError } from "./networkConfig";

export async function signWithFreighter(xdr: string) {
  const config = getNetworkConfig();
  if (config.status === "error") {
    throw new NetworkConfigError(config.errors);
  }

  const connected = await isConnected();
  if (!connected) {
    // Note: in a real app you'd check isAllowed() first,
    // but setAllowed() handles the permission request.
    await setAllowed();
  }

  return signTransaction(xdr, {
    networkPassphrase: config.config.networkPassphrase,
  });
}
