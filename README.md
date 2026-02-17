# P-C-t-bt-v0.1

A bot that automatically copies trades from successful traders.

## How It Works

```
1. 👀 Watch a trader's positions (every 200ms)
2. 🔍 Detect when they buy or sell
3. 📊 Calculate how much YOU should trade
4. 🚀 Place the order automatically
5. 📈 Track everything on a dashboard
```

## Current Status

- ✅ Phase 1: Position Poller (COMPLETE)
- ✅ Phase 2: Strategy Engine (COMPLETE)
- ✅ Phase 3: Order Execution (COMPLETE)
- ✅ Phase 4: Dashboard (COMPLETE)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure

```bash
# Copy the example config
cp .env.example .env

# Edit .env and add your trader address
```

### 3. Run Tests

```bash
# Run all tests
npm test

# Or run individual tests
npm run test:cache
npm run test:detector
```

### 4. Test API Connection

```bash
npm run test:api
```

### 5. Run the Demo

```bash
npm run demo:poller
```

This will watch your configured trader and log when they make trades.

## Project Structure

```
copy-trading-bot_v2/
├── src/
│   ├── index.ts              # Main entry point & bot orchestrator
│   ├── types/                # TypeScript types
│   ├── api/                  # Polymarket API client
│   ├── polling/              # Trade detection (activity + positions)
│   ├── strategy/             # Copy size, risk, price, market analysis, TP/SL
│   ├── execution/            # Paper & live trading executors
│   ├── storage/              # SQLite trade history persistence
│   └── dashboard/            # Web dashboard (REST API + WebSocket)
├── tests/                    # Test files
├── scripts/                  # Demo & utility scripts
├── .env.example              # Configuration template
└── package.json
```

## Commands

| Command               | Description             |
| --------------------- | ----------------------- |
| `npm run build`       | Compile TypeScript      |
| `npm start`           | Run the bot             |
| `npm test`            | Run all tests           |
| `npm run test:api`    | Test API connection     |
| `npm run demo:poller` | Demo the polling system |

## Configuration

See `.env.example` for all options. Key settings:

```env
# Trader to copy
TRADER_ADDRESS=0x...

# How often to check (milliseconds)
POLLING_INTERVAL_MS=200

# Risk limits (Phase 2)
MAX_DAILY_LOSS=100
MAX_TOTAL_LOSS=500
```

## Next Steps

See `IMPLEMENTATION_GUIDE.md` for the full step-by-step build plan.

## ⚠️ Disclaimer

This bot is for educational purposes. Trading involves risk. Never trade more than you can afford to lose.

## License

MIT
