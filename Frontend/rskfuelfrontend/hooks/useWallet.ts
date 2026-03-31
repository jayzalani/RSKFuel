"use client";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { RSK_TESTNET } from "@/lib/constants";

export type WalletState = {
  address: string | null;
  signer: ethers.JsonRpcSigner | null;
  chainId: number | null;
  isConnecting: boolean;
  isCorrectNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
};

declare global { interface Window { ethereum?: any } }

export function useWallet(): WalletState {
  const [address, setAddress]   = useState<string | null>(null);
  const [signer, setSigner]     = useState<ethers.JsonRpcSigner | null>(null);
  const [chainId, setChainId]   = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const init = useCallback(async () => {
    if (!window.ethereum) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    const net = await p.getNetwork();
    const s   = await p.getSigner();
    setSigner(s);
    setAddress(await s.getAddress());
    setChainId(Number(net.chainId));
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    new ethers.BrowserProvider(window.ethereum).listAccounts().then(a => { if (a.length) init(); });
    window.ethereum.on("accountsChanged", (a: string[]) => a.length ? init() : (setAddress(null), setSigner(null)));
    window.ethereum.on("chainChanged", init);
  }, [init]);

  const connect = useCallback(async () => {
    if (!window.ethereum) return alert("Install MetaMask to continue.");
    setIsConnecting(true);
    try { await window.ethereum.request({ method: "eth_requestAccounts" }); await init(); }
    finally { setIsConnecting(false); }
  }, [init]);

  const disconnect = useCallback(() => { setAddress(null); setSigner(null); setChainId(null); }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: RSK_TESTNET.chainIdHex }] });
    } catch (e: any) {
      if (e.code === 4902)
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: RSK_TESTNET.chainIdHex, chainName: RSK_TESTNET.name, rpcUrls: [RSK_TESTNET.rpcUrl], nativeCurrency: RSK_TESTNET.nativeCurrency, blockExplorerUrls: [RSK_TESTNET.explorerUrl] }],
        });
    }
  }, []);

  return { address, signer, chainId, isConnecting, isCorrectNetwork: chainId === RSK_TESTNET.chainId, connect, disconnect, switchNetwork };
}
