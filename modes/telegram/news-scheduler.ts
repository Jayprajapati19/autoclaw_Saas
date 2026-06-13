import { Telegraf } from "telegraf";
import chalk from "chalk";
import { buildTechNewsDigest } from "./news";

export interface NewsSchedulerControls {
  sendNow(): Promise<void>;
  start(): void;
  stop(): boolean;
  isRunning(): boolean;
}

const NEWS_INTERVAL_MS = 2 * 60 * 60 * 1000;

function isValidOwnerId(ownerId: string | undefined): ownerId is string {
  return Boolean(ownerId && !ownerId.includes("YOUR_TELEGRAM_USER_ID_HERE"));
}

export function createNewsScheduler(bot: Telegraf, ownerId: string | undefined): NewsSchedulerControls {
  let interval: ReturnType<typeof setInterval> | null = null;

  async function sendDigest() {
    if (!isValidOwnerId(ownerId)) {
      throw new Error("TELEGRAM_OWNER_ID is missing or invalid.");
    }

    const digest = await buildTechNewsDigest();
    await bot.telegram.sendMessage(ownerId, [digest.title, "", digest.body].join("\n"));
    console.log(chalk.green("Sent tech news digest to Telegram."));
  }

  function start() {
    if (interval || !isValidOwnerId(ownerId) || !process.env.FIRECRAWL_API_KEY) return;
    interval = setInterval(() => {
      void sendDigest().catch((error) => {
        console.error("Failed to send tech news digest:", error);
      });
    }, NEWS_INTERVAL_MS);
  }

  function stop(): boolean {
    if (!interval) return false;
    clearInterval(interval);
    interval = null;
    return true;
  }

  return {
    sendNow: async () => {
      await sendDigest();
    },
    start,
    stop,
    isRunning: () => interval !== null,
  };
}
