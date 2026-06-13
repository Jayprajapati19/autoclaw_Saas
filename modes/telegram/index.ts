import { Telegraf } from "telegraf";
import chalk from "chalk";
import { WELCOME } from "./constants";
import { registerHandlers } from "./handlers";
import { createNewsScheduler } from "./news-scheduler";

export async function runTelegramMode() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.TELEGRAM_OWNER_ID;

  if (!token || token.includes("YOUR_TELEGRAM_BOT_TOKEN_HERE")) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing or still set to the placeholder value.");
  }

  const bot = new Telegraf(token!);
  const newsControls = createNewsScheduler(bot, ownerId);
  registerHandlers(bot, newsControls);

  if (!ownerId || ownerId.includes("YOUR_TELEGRAM_USER_ID_HERE")) {
    console.log(chalk.yellow("TELEGRAM_OWNER_ID is missing or still set to the placeholder value. Telegram messages will be disabled until you set a real chat ID."));
  } else {
    bot.telegram
      .sendMessage(ownerId, WELCOME)
      .then(() => console.log(chalk.green("Sent welcome message to Telegram.\n")))
      .catch((error) => {
        console.error("Failed to send welcome message to Telegram:", error);
        console.log(chalk.yellow("Open a chat with the bot and send /start, then try again."));
      });
  }

  if (process.env.FIRECRAWL_API_KEY && ownerId && !ownerId.includes("YOUR_TELEGRAM_USER_ID_HERE")) {
    console.log(chalk.dim("Tech news is ready for /news_now. Scheduled sending stays off until you start it manually."));
  } else {
    console.log(chalk.yellow("FIRECRAWL_API_KEY is missing; tech news digest is disabled."));
  }

  bot.launch();
  console.log(chalk.green("Telegram bot is running. Press Ctrl+C to stop.\n"));

  await new Promise<void>((resolve) => {
    const stop = () => {
      bot.stop("SIGINT");
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
