#!/usr/bin/env node
/**
 * Tiny HTTP faucet for local Coldcoin (rate-limited, DEV only).
 * POST /drip  { "address": "0x...", "amount": "10" }
 * GET  /status
 */
const http = require('http');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const accounts = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/accounts.json'), 'utf8'));
const network = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/network.json'), 'utf8'));

const PORT = Number(process.env.FAUCET_PORT || 8787);
const MAX_AMOUNT = 100;
const COOLDOWN_MS = 30_000;
const lastDrip = new Map();

const provider = new ethers.JsonRpcProvider(network.rpcHttp, network.chainId);
const wallet = new ethers.Wallet(accounts.faucet.privateKey, provider);

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  try {
    if (req.method === 'GET' && req.url === '/status') {
      const [blockNumber, faucetBal, chainId] = await Promise.all([
        provider.getBlockNumber(),
        provider.getBalance(wallet.address),
        provider.getNetwork(),
      ]);
      return json(res, 200, {
        ok: true,
        network: 'Coldcoin',
        symbol: 'COLD',
        chainId: Number(chainId.chainId),
        blockNumber,
        faucet: wallet.address,
        faucetBalance: ethers.formatEther(faucetBal),
      });
    }

    if (req.method === 'POST' && req.url === '/drip') {
      const body = await readBody(req);
      const address = body.address;
      const amount = String(body.amount || '10');
      if (!ethers.isAddress(address)) return json(res, 400, { error: 'invalid address' });
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_AMOUNT) {
        return json(res, 400, { error: `amount must be 0 < x <= ${MAX_AMOUNT}` });
      }
      const key = address.toLowerCase();
      const now = Date.now();
      if (lastDrip.has(key) && now - lastDrip.get(key) < COOLDOWN_MS) {
        return json(res, 429, { error: 'cooldown', retryAfterMs: COOLDOWN_MS - (now - lastDrip.get(key)) });
      }
      const tx = await wallet.sendTransaction({
        to: address,
        value: ethers.parseEther(amount),
        chainId: network.chainId,
      });
      lastDrip.set(key, now);
      const receipt = await tx.wait();
      return json(res, 200, { ok: true, hash: tx.hash, blockNumber: receipt.blockNumber, amount });
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: err.message || String(err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Coldcoin faucet listening on http://127.0.0.1:${PORT}`);
});
