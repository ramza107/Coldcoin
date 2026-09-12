# Coldcoin

Частная **Ethereum-совместимая** сеть с нуля: нативная монета **COLD**, консенсус **Clique PoA**, JSON-RPC, faucet и статус-дашборд.

> DEV / PRIVATE NETWORK ONLY. Ключи в `config/` публичны намеренно — не используйте их в mainnet и не кладите туда реальные средства.

## Параметры сети

| Параметр | Значение |
|----------|----------|
| Chain ID | `10742` |
| Symbol | `COLD` (18 decimals) |
| Consensus | Clique PoA, period 5s |
| Sealers | 3 валидатора |
| RPC HTTP | `http://127.0.0.1:8545` |
| RPC WS | `ws://127.0.0.1:8546` |

## Быстрый старт (локально через geth)

Требуется **Geth 1.13.x** (Clique удалён в 1.14+; Clique также не поддерживает Shanghai) и Node.js ≥ 18.

Рекомендуемая версия: `1.13.15`.

```bash
npm install
./scripts/init-network.sh   # genesis + keystores
./scripts/start-network.sh  # 3 sealers + RPC
npm run faucet              # http://127.0.0.1:8787
npm run dashboard           # http://127.0.0.1:3000
```

Остановка:

```bash
./scripts/stop-network.sh
```

Проверка RPC:

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Отправить COLD с faucet:

```bash
node faucet/send.js 0xYourAddress 25
```

## Docker Compose

```bash
docker compose up -d
# RPC на :8545 / :8546
docker compose down
```

## Архитектура

```
genesis/          Clique genesis (chainId 10742, pre-funded accounts)
config/           network.json, accounts, password, keys (DEV)
scripts/          init / start / stop / peer mesh / deploy
docker/           entrypoints для compose
faucet/           HTTP drip + CLI send
dashboard/        статус сети + MetaMask add-chain
contracts/        ColdRegistry — on-chain метаданные сети
```

Узлы:

1. **sealer1–3** — майнят блоки Clique (2/3 кворум)
2. **rpc** — публичный HTTP/WS endpoint, разблокированный faucet

## Смарт-контракт

После запуска сети:

```bash
npm run deploy:registry
```

Артефакт появится в `deployments/ColdRegistry.json`.

## MetaMask

- Network name: `Coldcoin`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `10742`
- Currency symbol: `COLD`

Или кнопка «Добавить в MetaMask» на дашборде.

## Что это не является

Это не mainnet-форк, не L2-rollup и не готовый продукт для листинга. Это воспроизводимый каркас приватной EVM-сети, на котором можно дальше строить токены, мосты, explorer и приложения.
