#!/usr/bin/env node
/**
 * Deploy ColdRegistry via eth_sendTransaction (no Hardhat required).
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.join(__dirname, '..');
const accounts = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/accounts.json'), 'utf8'));
const network = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/network.json'), 'utf8'));

function compile() {
  const source = fs.readFileSync(path.join(ROOT, 'contracts/ColdRegistry.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'ColdRegistry.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'london',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors?.some((e) => e.severity === 'error')) {
    console.error(output.errors);
    process.exit(1);
  }
  const art = output.contracts['ColdRegistry.sol'].ColdRegistry;
  return { abi: art.abi, bytecode: art.evm.bytecode.object };
}

async function main() {
  const { abi, bytecode } = compile();
  const provider = new ethers.JsonRpcProvider(network.rpcHttp, network.chainId);
  const wallet = new ethers.Wallet(accounts.treasury.privateKey, provider);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(
    network.chainId,
    network.rpcHttp,
    network.rpcWs,
    'https://github.com/ramza107/Coldcoin'
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const out = {
    address,
    abi,
    deployedBy: wallet.address,
    chainId: network.chainId,
    txHash: contract.deploymentTransaction().hash,
  };
  fs.mkdirSync(path.join(ROOT, 'deployments'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'deployments/ColdRegistry.json'), JSON.stringify(out, null, 2));
  console.log('ColdRegistry deployed:', address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
