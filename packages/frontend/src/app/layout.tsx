import "./globals.css";
import { Inter } from "next/font/google";
import { WalletProvider } from "@/components/WalletContext";
import { PlatformConfigProvider } from "@/contexts/PlatformConfigContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { NavBar } from "@/components/NavBar";
import { I18nProvider } from "@/components/I18nProvider";
import NetworkConfigBanner from "@/components/NetworkConfigBanner";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "BACKit - Stellar Prediction Markets",
  description: "Decentralized prediction markets on Stellar",
};

const WS_URL =
  (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001").replace(
    /^http/,
    "ws",
  ) + "/ws";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <I18nProvider>
          <ThemeProvider>
            <WebSocketProvider url={WS_URL}>
              <WalletProvider>
                <NetworkConfigBanner />
                <PlatformConfigProvider>
                  <NavBar />
                  <main>{children}</main>
                </PlatformConfigProvider>
              </WalletProvider>
            </WebSocketProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
