const RPC = 'http://127.0.0.1:8545';
const CHAIN_ID = 10742;

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function set(id, value) {
  document.getElementById(id).textContent = value;
}

async function refresh() {
  const pulse = document.getElementById('pulse');
  pulse.textContent = 'Запрос к узлу…';
  try {
    const [blockHex, peerHex, gasHex, netVersion] = await Promise.all([
      rpc('eth_blockNumber'),
      rpc('net_peerCount'),
      rpc('eth_gasPrice'),
      rpc('net_version'),
    ]);
    set('m-state', Number(netVersion) === CHAIN_ID ? 'online' : `chain ${netVersion}`);
    set('m-block', String(parseInt(blockHex, 16)));
    set('m-peers', String(parseInt(peerHex, 16)));
    set('m-gas', `${(Number(BigInt(gasHex)) / 1e9).toFixed(2)} gwei`);
    document.getElementById('live-line').textContent =
      `online · блок ${parseInt(blockHex, 16)} · пиры ${parseInt(peerHex, 16)}`;
    pulse.textContent = `Обновлено · ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    set('m-state', 'offline');
    set('m-block', '—');
    set('m-peers', '—');
    set('m-gas', '—');
    document.getElementById('live-line').textContent = 'узел offline';
    pulse.textContent = `Узел недоступен: ${err.message}. Запустите ./scripts/start-network.sh`;
  }
}

async function addWallet() {
  if (!window.ethereum) {
    alert('MetaMask не найден');
    return;
  }
  try {
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x' + CHAIN_ID.toString(16),
        chainName: 'Coldcoin',
        nativeCurrency: { name: 'Coldcoin', symbol: 'COLD', decimals: 18 },
        rpcUrls: [RPC],
      }],
    });
  } catch (err) {
    alert(err.message || String(err));
  }
}

document.getElementById('refresh').addEventListener('click', refresh);
document.getElementById('add-wallet').addEventListener('click', addWallet);
refresh();
setInterval(refresh, 5000);
