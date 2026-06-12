// ============================================================
// src/index.ts — Entry point Express + Bot
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
// src/bot/index.ts — Bot principale, registrazione comandi e bottoni
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
import { handleButton as handleScontrinoButton } from "./commands/scontrino.js";

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
          await handleScontrinoButton(interaction);
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
// src/bot/utils/embeds.ts — Embed helpers riutilizzabili
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
// src/bot/utils/key-store.ts — Persistenza API Key ERLC per guild
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
    const res = await fetch("https://api.policeroleplay.community/v1/server", { headers: { Authorization: key } });
    if (!res.ok) return { valid: false };
    const data = await res.json() as Record<string, unknown>;
    return { valid: true, serverName: String(data["Name"] ?? "Server sconosciuto") };
  } catch { return { valid: false }; }
}


// ============================================================
// src/bot/utils/mod-log.ts — Log moderazione + client singleton
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Client, EmbedBuilder, TextChannel, Colors } from "discord.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const STORE_PATH = join(DATA_DIR, "mod-log-channels.json");

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

export function setLogChannel(guildId: string, channelId: string): void { store[guildId] = channelId; saveStore(store); }
export function getLogChannel(guildId: string): string | undefined { return store[guildId]; }

export type ModAction = "BAN" | "KICK" | "TIMEOUT" | "UNTIMEOUT" | "UNBAN" | "WARN" | "PURGE" | "SLOWMODE" | "LOCK" | "UNLOCK";

const ACTION_META: Record<ModAction, { emoji: string; color: number; label: string }> = {
  BAN:       { emoji: "🔨", color: Colors.Red,     label: "Ban" },
  KICK:      { emoji: "👢", color: Colors.Orange,  label: "Kick" },
  TIMEOUT:   { emoji: "🔇", color: Colors.Yellow,  label: "Timeout" },
  UNTIMEOUT: { emoji: "🔊", color: Colors.Green,   label: "Timeout Rimosso" },
  UNBAN:     { emoji: "✅", color: Colors.Green,   label: "Unban" },
  WARN:      { emoji: "⚠️", color: Colors.Yellow,  label: "Warn" },
  PURGE:     { emoji: "🗑️", color: Colors.Blurple, label: "Purge" },
  SLOWMODE:  { emoji: "🐢", color: Colors.Blurple, label: "Slowmode" },
  LOCK:      { emoji: "🔒", color: Colors.DarkRed, label: "Lock Canale" },
  UNLOCK:    { emoji: "🔓", color: Colors.Green,   label: "Unlock Canale" },
};

export interface ModLogOptions {
  client: Client; guildId: string; action: ModAction;
  moderator: { id: string; tag: string };
  target?: { id: string; tag: string };
  reason?: string; extra?: Record<string, string>;
}

export async function sendModLog(opts: ModLogOptions): Promise<void> {
  const channelId = getLogChannel(opts.guildId);
  if (!channelId) return;
  try {
    const channel = await opts.client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) return;
    const meta = ACTION_META[opts.action];
    const embed = new EmbedBuilder()
      .setColor(meta.color).setTitle(`${meta.emoji} ${meta.label}`)
      .addFields({ name: "Moderatore", value: `<@${opts.moderator.id}> (${opts.moderator.tag})`, inline: true })
      .setTimestamp().setFooter({ text: `Server ID: ${opts.guildId}` });
    if (opts.target) embed.addFields({ name: "Utente", value: `<@${opts.target.id}> (${opts.target.tag})`, inline: true });
    if (opts.reason) embed.addFields({ name: "Motivo", value: opts.reason, inline: false });
    if (opts.extra) for (const [k, v] of Object.entries(opts.extra)) embed.addFields({ name: k, value: v, inline: true });
    await channel.send({ embeds: [embed] });
  } catch { /* canale non trovato o permessi insufficienti */ }
}

let _client: Client | null = null;
export function setClient(client: Client): void { _client = client; }
export function getClient(): Client | null { return _client; }


// ============================================================
// src/bot/utils/erlc-api.ts — Client API ERLC
// ============================================================
import { getErlcKey } from "./key-store.js";

const BASE_URL = "https://api.policeroleplay.community/v1";

async function erlcFetch(guildId: string, path: string, options: RequestInit = {}) {
  const key = getErlcKey(guildId);
  if (!key) throw new Error("Nessuna API Key configurata. Usa `/config-api-key` per impostarla.");
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: key, "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`ERLC API error ${res.status}: ${text}`); }
  return res.json();
}

export async function getServerStatus(guildId: string) { return erlcFetch(guildId, "/server"); }
export async function getPlayers(guildId: string) { return erlcFetch(guildId, "/server/players"); }
export async function getJoinLogs(guildId: string) { return erlcFetch(guildId, "/server/joinlogs"); }
export async function getKillLogs(guildId: string) { return erlcFetch(guildId, "/server/killlogs"); }
export async function getCommandLogs(guildId: string) { return erlcFetch(guildId, "/server/commandlogs"); }
export async function getModCallLogs(guildId: string) { return erlcFetch(guildId, "/server/modcalls"); }
export async function getBans(guildId: string) { return erlcFetch(guildId, "/server/bans"); }
export async function sendCommand(guildId: string, command: string) {
  return erlcFetch(guildId, "/server/command", { method: "POST", body: JSON.stringify({ command }) });
}


// ============================================================
// src/bot/utils/bank-store.ts — Persistenza conti bancari
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const STORE_PATH = join(DATA_DIR, "bank.json");

export type TransactionType =
  | "deposito" | "prelievo" | "bonifico_inviato" | "bonifico_ricevuto" | "impostazione_admin";

export interface Transaction {
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  timestamp: string;
  note?: string;
  counterpartId?: string;
  counterpartTag?: string;
}

export interface BankAccount {
  balance: number;
  blocked: boolean;
  transactions: Transaction[];
}

type GuildBank = Record<string, BankAccount>;
type BankData = Record<string, GuildBank>;

function loadData(): BankData {
  if (!existsSync(STORE_PATH)) return {};
  try { return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as BankData; }
  catch { return {}; }
}
function saveData(data: BankData): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch { /* best-effort */ }
}

const db = loadData();

function getGuild(guildId: string): GuildBank {
  if (!db[guildId]) db[guildId] = {};
  return db[guildId]!;
}

export function getAccount(guildId: string, userId: string): BankAccount {
  const guild = getGuild(guildId);
  if (!guild[userId]) guild[userId] = { balance: 0, blocked: false, transactions: [] };
  return guild[userId]!;
}

export function isBlocked(guildId: string, userId: string): boolean {
  return getAccount(guildId, userId).blocked;
}
export function getBalance(guildId: string, userId: string): number {
  return getAccount(guildId, userId).balance;
}

function addTransaction(account: BankAccount, tx: Omit<Transaction, "balanceAfter">) {
  account.transactions.unshift({ ...tx, balanceAfter: account.balance });
  if (account.transactions.length > 50) account.transactions = account.transactions.slice(0, 50);
}

export function deposit(guildId: string, userId: string, amount: number, note?: string): BankAccount {
  const account = getAccount(guildId, userId);
  account.balance += amount;
  addTransaction(account, { type: "deposito", amount, timestamp: new Date().toISOString(), note });
  saveData(db);
  return account;
}

export function withdraw(guildId: string, userId: string, amount: number, note?: string): { ok: boolean; account?: BankAccount; error?: string } {
  const account = getAccount(guildId, userId);
  if (account.blocked) return { ok: false, error: "Il tuo conto è bloccato. Contatta un amministratore." };
  if (account.balance < amount) return { ok: false, error: `Saldo insufficiente. Hai **€${account.balance.toLocaleString("it-IT")}** disponibili.` };
  account.balance -= amount;
  addTransaction(account, { type: "prelievo", amount, timestamp: new Date().toISOString(), note });
  saveData(db);
  return { ok: true, account };
}

export function transfer(
  guildId: string,
  fromId: string, fromTag: string,
  toId: string, toTag: string,
  amount: number, note?: string
): { ok: boolean; error?: string } {
  const from = getAccount(guildId, fromId);
  const to = getAccount(guildId, toId);
  if (from.blocked) return { ok: false, error: "Il tuo conto è bloccato. Contatta un amministratore." };
  if (to.blocked) return { ok: false, error: "Il conto del destinatario è bloccato." };
  if (from.balance < amount) return { ok: false, error: `Saldo insufficiente. Hai **€${from.balance.toLocaleString("it-IT")}** disponibili.` };
  if (fromId === toId) return { ok: false, error: "Non puoi fare un bonifico a te stesso." };
  const ts = new Date().toISOString();
  from.balance -= amount;
  addTransaction(from, { type: "bonifico_inviato", amount, timestamp: ts, note, counterpartId: toId, counterpartTag: toTag });
  to.balance += amount;
  addTransaction(to, { type: "bonifico_ricevuto", amount, timestamp: ts, note, counterpartId: fromId, counterpartTag: fromTag });
  saveData(db);
  return { ok: true };
}

export function adminSetBalance(guildId: string, userId: string, amount: number, adminTag: string): BankAccount {
  const account = getAccount(guildId, userId);
  const old = account.balance;
  account.balance = amount;
  addTransaction(account, { type: "impostazione_admin", amount: amount - old, timestamp: new Date().toISOString(), note: `Impostato da ${adminTag}` });
  saveData(db);
  return account;
}

export function adminBlock(guildId: string, userId: string, blocked: boolean): void {
  const account = getAccount(guildId, userId);
  account.blocked = blocked;
  saveData(db);
}

export function getTransactions(guildId: string, userId: string, limit = 10): Transaction[] {
  return getAccount(guildId, userId).transactions.slice(0, limit);
}

export function formatEur(n: number): string {
  return `€${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


// ============================================================
// src/bot/commands/erlc/config-api-key.ts
// ============================================================
import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ModalSubmitInteraction } from "discord.js";
import { setErlcKey, validateErlcKey } from "../../utils/key-store.js";
import { successEmbed, errorEmbed, warnEmbed } from "../../utils/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("config-api-key").setDescription("Configura la API Key del server ERLC")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId("erlc_api_key_modal").setTitle("🔑 Configura API Key ERLC");
  const keyInput = new TextInputBuilder()
   
