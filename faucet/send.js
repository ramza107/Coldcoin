#!/usr/bin/env node
/**
 * Coldcoin faucet — send COLD from the unlocked faucet account via JSON-RPC.
 * Usage: node faucet/send.js <toAddress> [amountEther]
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const accounts = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/accounts.json'), 'utf8'));
const network = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/network.json'), 'utf8'));

async function main() {
  const to = process.argv[2];
  const amount = process.argv[3] || '10';
  if (!to || !ethers.isAddress(to)) {
    console.error('Usage: node faucet/send.js <toAddress> [amountEther]');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(network.rpcHttp, network.chainId);
  const wallet = new ethers.Wallet(accounts.faucet.privateKey, provider);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Faucet ${wallet.address} balance: ${ethers.formatEther(balance)} COLD`);

  const tx = await wallet.sendTransaction({
    to,
    value: ethers.parseEther(amount),
    chainId: network.chainId,
  });
  console.log(`Sent ${amount} COLD -> ${to}`);
  console.log(`tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`confirmed in block ${receipt.blockNumber}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
