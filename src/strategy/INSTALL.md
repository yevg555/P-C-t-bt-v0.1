# Phase 2: Strategy Engine - Installation Guide

## 📦 Files to Add

Add these files to your existing project:

```
copy-trading-bot_v2_v2/
├── src/
│   └── strategy/              ← CREATE THIS FOLDER
│       ├── index.ts           ← Add this
│       ├── copy-size.ts       ← Add this
│       ├── risk-checker.ts    ← Add this
│       └── price-adjuster.ts  ← Add this
│
├── tests/
│   └── copy-size.test.ts      ← Add this
│
├── scripts/
│   └── demo-strategy.ts       ← Add this
│
└── package.json               ← Update scripts section
```

## 🔧 Step-by-Step

### 1. Create the strategy folder

```bash
mkdir src/strategy
```

### 2. Copy the files

Download and copy each file from this folder:

- `copy-size.ts` → `src/strategy/copy-size.ts`
- `risk-checker.ts` → `src/strategy/risk-checker.ts`
- `price-adjuster.ts` → `src/strategy/price-adjuster.ts`
- `index.ts` → `src/strategy/index.ts`
- `copy-size.test.ts` → `tests/copy-size.test.ts`
- `demo-strategy.ts` → `scripts/demo-strategy.ts`

### 3. Update package.json scripts

Add these new scripts to your package.json:

```json
"scripts": {
  ...existing scripts...,
  "test:copysize": "ts-node tests/copy-size.test.ts",
  "demo:strategy": "ts-node scripts/demo-strategy.ts"
}
```

### 4. (Optional) Add YOUR_BALANCE to .env

```env
YOUR_BALANCE=1000
```

## ✅ Test It

### Run the copy size tests:

```bash
npm run test:copysize
```

### Run the strategy demo:

```bash
npm run demo:strategy
```

This will:

1. Watch your trader (like before)
2. When they trade → calculate how much YOU should buy
3. Check risk limits
4. Show the order that WOULD be placed

## 🎯 What You'll See

When the trader makes a move:

```
═══════════════════════════════════════════════════════
🔔 TRADE DETECTED
═══════════════════════════════════════════════════════

📈 Market Price: $0.5000

📐 Size Calculation:
   5.0% of $1000.00 = $50.00 → 100.00 shares @ $0.5000
   → 100 shares @ ~$50.00

💰 Price Adjustment:
   Price adjusted higher by 50bps: $0.5000 → $0.5025

🛡️  Risk Check:
   Status: ✅ APPROVED
   Risk Level: LOW

────────────────────────────────────────────────────────
📋 ORDER READY (not placed - Phase 3 needed):
   BUY 100 shares
   Token: abc123...
   Price: $0.5025
   Est. Cost: $50.25
────────────────────────────────────────────────────────
```

## 🚀 Next: Phase 3

Once this works, we'll add actual order execution:

- EIP-712 signing
- POST to Polymarket CLOB API
- Fill tracking
