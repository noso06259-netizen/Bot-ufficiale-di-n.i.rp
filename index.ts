// ============================================================
// src/index.ts
// ============================================================
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startBot } from "./bot/index.js";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

app.listen(port, (err) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port }, "Server listening");
});

startBot().catch((err) => {
  logger.error({ err }, "Errore avvio bot Discord");
});


// ============================================================
// src/bot/index.ts
// ============================================================
import { Client, Collection, Events, GatewayIntentBits, ChatInputCommandInteraction, REST, Routes } from "discord.js";
import { logger } from "../lib/logger.js";
import { setClient } from "./utils/mod-log.js";

import * as erlcStatus from "./commands/erlc/status.js";
import * as erlcPlayers from "./commands/erlc/players.js";
import * as erlcLogs from "./commands/erlc/logs.js";
import * as erlcCommand from "./commands/erlc/command.js";
import * as erlcBan from "./commands/erlc/erlc-ban.js";
import * as erlcKick from "./commands/erlc/erlc-kick.js";
import * as erlcUnban from "./commands/erlc/erlc-unban.js";
import * as erlcStaff from "./commands/erlc/erlc-staff.js";
import * as configApiKey from "./commands/erlc/config-api-key.js";

import * as modBan from "./commands/moderation/ban.js";
import * as modKick from "./commands/moderation/kick.js";
import * as modTimeout from "./commands/moderation/timeout.js";
import * as modUntimeout from "./commands/moderation/untimeout.js";
import * as modUnban from "./commands/moderation/unban.js";
import * as modWarn from "./commands/moderation/warn.js";
import * as modWarnings from "./commands/moderation/warnings.js";
import * as modClearwarnings from "./commands/moderation/clearwarnings.js";
import * as modPurge from "./commands/moderation/purge.js";
import * as modSlowmode from "./commands/moderation/slowmode.js";
import * as modLock from "./commands/moderation/lock.js";
import * as modUnlock from "./commands/moderation/unlock.js";
import * as modUserinfo from "./commands/moderation/userinfo.js";
import * as modServerinfo from "./commands/moderation/serverinfo.js";
import * as configLog from "./commands/moderation/config-log.js";

import * as banca from "./commands/banking/banca.js";
import * as bancaAdmin from "./commands/banking/banca-admin.js";
import * as scontrino from "./commands/scontrino.js";

type Command = {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
};

const ALL_COMMANDS: Command[] = [
  erlcStatus, erlcPlayers, erlcLogs, erlcCommand, erlcBan, erlcKick, erlcUnban, erlcStaff, configApiKey,
  modBan, modKick, modTimeout, modUntimeout, modUnban, modWarn, modWarnings, modClearwarnings,
  modPurge, modSlowmode, modLock, modUnlock, modUserinfo, modServerinfo, configLog,
  banca, bancaAdmin,
  scontrino,
];

async function registerCommands(token: string, clientId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  const commandData = ALL_COMMANDS.map(cmd => cmd.data.toJSON());
  logger.info({ count: commandData.length }, "Registrazione comandi slash...");
  await rest.put(Routes.applicationCommands(clientId), { body: commandData });
  logger.info("Comandi slash registrati globalmente.");
}

export async function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) { logger.warn("DISCORD_BOT_TOKEN non trovato — bot non avviato."); return; }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildModeration],
  });

  const commands = new Collection<string, Command>();
  for (const cmd of ALL_COMMANDS) commands.set(cmd.data.name, cmd);

  client.once(Events.ClientReady, async (c) => {
    setClient(client);
    logger.info({ tag: c.user.tag }, "Bot Discord online!");
    try { await registerCommands(token, c.user.id); }
    catch (err) { logger.error({ err }, "Errore registrazione comandi"); }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("scontrino_")) {
        try {
          await scontrino.handleButton(interaction);
        } catch (err) {
          logger.error({ err }, "Errore gestione bottone scontrino");
          const errMsg = { content: "Si è verificato un errore durante l'elaborazione.", ephemeral: true };
          if (interaction.replied || interaction.deferred) await interaction.followUp(errMsg);
          else await interaction.reply(errMsg);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try { await command.execute(interaction); }
    catch (err) {
      logger.error({ err, command: interaction.commandName }, "Errore esecuzione comando");
      const errMsg = { content: "Si è verificato un errore durante l'esecuzione del comando.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(errMsg);
      else await interaction.reply(errMsg);
    }
  });

  client.on(Events.Error, (err) => logger.error({ err }, "Errore client Discord"));
  await client.login(token);
}


// ============================================================
// src/bot/utils/embeds.ts
// ============================================================
import { EmbedBuilder, Colors } from "discord.js";

export function successEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(Colors.Green).setTitle(`✅ ${title}`).setDescription(description).setTimestamp();
}
export function errorEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(Colors.Red).setTitle(`❌ ${title}`).setDescription(description).setTimestamp();
}
export function infoEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(0x5865f2).setTitle(`📋 ${title}`).setDescription(description).setTimestamp();
}
export function warnEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(Colors.Yellow).setTitle(`⚠️ ${title}`).setDescription(description).setTimestamp();
}


// ============================================================
// src/bot/utils/key-store.ts
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../../lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const STORE_PATH = join(DATA_DIR, "erlc-keys.json");

function loadStore(): Record<string, string> {
  if (!existsSync(STORE_PATH)) return {};
  try { return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as Record<string, string>; }
  catch { return {}; }
}
function saveStore(data: Record<string, string>) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch { /* best-effort */ }
}

const store = loadStore();

export function getErlcKey(guildId: string): string | undefined {
  return store[guildId] ?? process.env["ERLC_SERVER_KEY"];
}
export function setErlcKey(guildId: string, key: string): void {
  store[guildId] = key; saveStore(store);
}
export async function validateErlcKey(key: string): Promise<{ valid: boolean; serverName?: string }> {
  try {
    const res = await fetch("https://api.policeroleplay.community
