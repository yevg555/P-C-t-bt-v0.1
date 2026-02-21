/**
 * ALERT / NOTIFICATION SERVICE
 * ============================
 * Sends notifications via Telegram and/or Discord webhooks
 * when important bot events occur.
 *
 * Supports severity levels: critical, high, medium, low
 * Rate-limits per-channel to avoid flooding.
 */

import { Agent, fetch as undiciFetch, Dispatcher } from "undici";

/** Keep-alive dispatcher for alert HTTP connections (~20-50ms savings per request) */
const alertDispatcher = new Agent({
  keepAliveTimeout: 30_000,
  connections: 2,
});

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export interface AlertConfig {
  /** Telegram bot token (from @BotFather) */
  telegramBotToken?: string;
  /** Telegram chat ID to send messages to */
  telegramChatId?: string;
  /** Discord webhook URL */
  discordWebhookUrl?: string;
  /** Minimum severity to send: critical, high, medium, low (default: high) */
  minSeverity?: AlertSeverity;
}

interface RateLimitState {
  lastSentAt: number;
  count: number;
  windowStart: number;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  critical: "🚨",
  high: "⚠️",
  medium: "ℹ️",
  low: "📝",
};

// Rate limit: max 20 messages per minute, minimum 2s between messages
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 20;
const RATE_LIMIT_MIN_INTERVAL_MS = 2_000;

export class AlertService {
  private config: AlertConfig;
  private telegramRateLimit: RateLimitState = { lastSentAt: 0, count: 0, windowStart: 0 };
  private discordRateLimit: RateLimitState = { lastSentAt: 0, count: 0, windowStart: 0 };
  private minSeverityLevel: number;
  private dispatcher: Dispatcher;
  private timeProvider: () => number;

  constructor(config: AlertConfig, dispatcher?: Dispatcher, timeProvider: () => number = Date.now) {
    this.config = config;
    this.minSeverityLevel = SEVERITY_ORDER[config.minSeverity || "high"];
    this.dispatcher = dispatcher || alertDispatcher;
    this.timeProvider = timeProvider;
  }

  get enabled(): boolean {
    return this.hasTelegram() || this.hasDiscord();
  }

  private hasTelegram(): boolean {
    return !!(this.config.telegramBotToken && this.config.telegramChatId);
  }

  private hasDiscord(): boolean {
    return !!this.config.discordWebhookUrl;
  }

  /**
   * Send an alert if it meets the minimum severity threshold.
   */
  async send(severity: AlertSeverity, title: string, details?: string): Promise<void> {
    if (SEVERITY_ORDER[severity] > this.minSeverityLevel) return;
    if (!this.enabled) return;

    const emoji = SEVERITY_EMOJI[severity];
    const now = this.timeProvider();

    const promises: Promise<void>[] = [];

    if (this.hasTelegram() && this.checkRateLimit(this.telegramRateLimit, now)) {
      promises.push(this.sendTelegram(emoji, title, details));
    }

    if (this.hasDiscord() && this.checkRateLimit(this.discordRateLimit, now)) {
      promises.push(this.sendDiscord(emoji, severity, title, details));
    }

    await Promise.allSettled(promises);
  }

  // === Convenience methods for common bot events ===

  async tradeFilled(side: string, size: number, price: number, pnl?: number): Promise<void> {
    const pnlStr = pnl != null ? ` | P&L: $${pnl.toFixed(2)}` : "";
    await this.send("medium", `Trade Filled: ${side} ${size.toFixed(2)} @ $${price.toFixed(4)}${pnlStr}`);
  }

  async tradeRejected(reason: string): Promise<void> {
    await this.send("high", "Trade Rejected", reason);
  }

  async tradeFailed(error: string): Promise<void> {
    await this.send("critical", "Trade Execution Failed", error);
  }

  async tpSlTriggered(type: string, tokenId: string, entryPrice: number, currentPrice: number, pctChange: number): Promise<void> {
    await this.send("high",
      `${type.toUpperCase()} Triggered`,
      `Token: ${tokenId.slice(0, 16)}...\nEntry: $${entryPrice.toFixed(4)} → Current: $${currentPrice.toFixed(4)}\nChange: ${(pctChange * 100).toFixed(2)}%`
    );
  }

  async killSwitchActivated(reason: string): Promise<void> {
    await this.send("critical", "KILL SWITCH ACTIVATED", reason);
  }

  async pollerDegraded(consecutiveErrors: number): Promise<void> {
    await this.send("critical", "Poller Degraded", `${consecutiveErrors} consecutive errors`);
  }

  async pollerRecovered(): Promise<void> {
    await this.send("medium", "Poller Recovered");
  }

  async oneClickSellActivated(positionCount: number): Promise<void> {
    await this.send("critical", "1-Click Sell Activated", `Selling ${positionCount} positions`);
  }

  async sessionStarted(mode: string, balance: number): Promise<void> {
    await this.send("low", "Bot Started", `Mode: ${mode.toUpperCase()} | Balance: $${balance.toFixed(2)}`);
  }

  async sessionEnded(trades: number, pnl: number): Promise<void> {
    await this.send("low", "Bot Stopped", `Trades: ${trades} | P&L: $${pnl.toFixed(2)}`);
  }

  // === Channel implementations ===

  private async sendTelegram(emoji: string, title: string, details?: string): Promise<void> {
    const text = details
      ? `${emoji} <b>${escapeHtml(title)}</b>\n<pre>${escapeHtml(details)}</pre>`
      : `${emoji} <b>${escapeHtml(title)}</b>`;

    try {
      const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;
      const res = await undiciFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.telegramChatId,
          text,
          parse_mode: "HTML",
          disable_notification: false,
        }),
        dispatcher: this.dispatcher,
      });
      if (!res.ok) {
        console.warn(`[ALERT] Telegram send failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      console.warn(`[ALERT] Telegram error: ${err}`);
    }
  }

  private async sendDiscord(emoji: string, severity: AlertSeverity, title: string, details?: string): Promise<void> {
    const colors: Record<AlertSeverity, number> = {
      critical: 0xf85149, // red
      high: 0xd29922,     // yellow
      medium: 0x58a6ff,   // blue
      low: 0x8b949e,      // gray
    };

    try {
      const res = await undiciFetch(this.config.discordWebhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: `${emoji} ${title}`,
            description: details || undefined,
            color: colors[severity],
            timestamp: new Date().toISOString(),
            footer: { text: "Copy Trading Bot" },
          }],
        }),
        dispatcher: this.dispatcher,
      });
      if (!res.ok) {
        console.warn(`[ALERT] Discord send failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      console.warn(`[ALERT] Discord error: ${err}`);
    }
  }

  // === Rate limiting ===

  private checkRateLimit(state: RateLimitState, now: number): boolean {
    // Reset window if expired
    if (now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
      state.count = 0;
      state.windowStart = now;
    }

    // Check per-window limit
    if (state.count >= RATE_LIMIT_MAX_PER_WINDOW) return false;

    // Check minimum interval
    if (now - state.lastSentAt < RATE_LIMIT_MIN_INTERVAL_MS) return false;

    state.lastSentAt = now;
    state.count++;
    return true;
  }

  getStatus(): string {
    const channels: string[] = [];
    if (this.hasTelegram()) channels.push("Telegram");
    if (this.hasDiscord()) channels.push("Discord");
    if (channels.length === 0) return "DISABLED (no channels configured)";
    return `ENABLED (${channels.join(", ")}) | min severity: ${this.config.minSeverity || "high"}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
