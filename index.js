require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  ownerId: process.env.OWNER_ID,
  address: process.env.LTC_ADDRESS,
  alertChannelId: process.env.ALERT_CHANNEL_ID || "",
  checkInterval: Math.max(15, Number(process.env.CHECK_INTERVAL || 30))
};

if (!CONFIG.token || !CONFIG.clientId || !CONFIG.ownerId) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or OWNER_ID in Railway Variables");
  process.exit(1);
}

if (!CONFIG.address) {
  console.error("Missing LTC_ADDRESS in .env");
  process.exit(1);
}

const API_BASE = "https://api.blockcypher.com/v1/ltc/main";
const STATE_FILE = path.join(__dirname, "wallet-state.json");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Show your current Litecoin wallet balance"),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show recent Litecoin wallet transactions")
    .addIntegerOption(option =>
      option
        .setName("count")
        .setDescription("Number of transactions to show (1-10)")
        .setMinValue(1)
        .setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("address")
    .setDescription("Show your tracked Litecoin address"),

  new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh wallet data now"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show wallet monitoring status")
].map(command => command.toJSON());

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      initialized: false,
      knownTransactions: []
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

function isOwner(interaction) {
  return interaction.user.id === CONFIG.ownerId;
}

function litoshiToLtc(value) {
  return Number(value || 0) / 100000000;
}

function fmtLtc(value) {
  return `${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8
  })} LTC`;
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function explorerUrl(hash) {
  return `https://litecoinspace.org/tx/${hash}`;
}

async function fetchWallet() {
  const url = `${API_BASE}/addrs/${encodeURIComponent(CONFIG.address)}?limit=10`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`BlockCypher HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function fetchTransaction(hash) {
  const response = await fetch(`${API_BASE}/txs/${hash}`);

  if (!response.ok) {
    throw new Error(`Transaction lookup failed: HTTP ${response.status}`);
  }

  return response.json();
}

function getTxRefs(wallet) {
  return [
    ...(wallet.unconfirmed_txrefs || []),
    ...(wallet.txrefs || [])
  ];
}

function classifyRef(ref) {
  // BlockCypher's address endpoint marks an address's input/output
  // with tx_input_n / tx_output_n.
  if (Number(ref.tx_input_n) >= 0 && Number(ref.tx_output_n) < 0) {
    return "sent";
  }

  if (Number(ref.tx_output_n) >= 0 && Number(ref.tx_input_n) < 0) {
    return "received";
  }

  // Fallback for unusual/self-transfer records.
  if (Number(ref.tx_output_n) >= 0) return "received";
  if (Number(ref.tx_input_n) >= 0) return "sent";

  return "unknown";
}

function buildBalanceEmbed(wallet) {
  const confirmed = litoshiToLtc(wallet.final_balance);
  const unconfirmed = litoshiToLtc(wallet.unconfirmed_balance);
  const totalReceived = litoshiToLtc(wallet.total_received);
  const totalSent = litoshiToLtc(wallet.total_sent);

  return new EmbedBuilder()
    .setTitle("Litecoin Wallet")
    .setDescription(`[${CONFIG.address}](https://litecoinspace.org/address/${CONFIG.address})`)
    .addFields(
      { name: "Balance", value: `**${fmtLtc(confirmed)}**`, inline: true },
      { name: "Unconfirmed", value: fmtLtc(unconfirmed), inline: true },
      { name: "Transactions", value: String(wallet.final_n_tx ?? wallet.n_tx ?? 0), inline: true },
      { name: "Total Received", value: fmtLtc(totalReceived), inline: true },
      { name: "Total Sent", value: fmtLtc(totalSent), inline: true }
    )
    .setFooter({ text: "Read-only wallet monitor" })
    .setTimestamp();
}

async function sendNewTransactionAlert(ref) {
  if (!CONFIG.alertChannelId) return;

  const channel = await client.channels.fetch(CONFIG.alertChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const type = classifyRef(ref);
  const amount = litoshiToLtc(ref.value);

  let title = "New Litecoin Transaction";
  let description = `Transaction: [${shortHash(ref.tx_hash)}](${explorerUrl(ref.tx_hash)})`;

  if (type === "received") {
    title = "LTC Received";
    description = `**+${fmtLtc(amount)}**\n${description}`;
  } else if (type === "sent") {
    title = "LTC Sent";
    description = `**-${fmtLtc(amount)}**\n${description}`;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "Status", value: Number(ref.confirmations || 0) > 0 ? "Confirmed" : "Unconfirmed", inline: true },
      { name: "Confirmations", value: String(ref.confirmations || 0), inline: true }
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(console.error);
}

async function monitorWallet() {
  try {
    const wallet = await fetchWallet();
    const refs = getTxRefs(wallet);

    const currentHashes = [...new Set(refs.map(r => r.tx_hash).filter(Boolean))];

    if (!state.initialized) {
      state.initialized = true;
      state.knownTransactions = currentHashes.slice(0, 100);
      saveState(state);
      console.log(`Wallet initialized. ${currentHashes.length} transaction(s) currently visible.`);
      return wallet;
    }

    const newRefs = refs.filter(ref => !state.knownTransactions.includes(ref.tx_hash));

    for (const ref of newRefs) {
      await sendNewTransactionAlert(ref);
    }

    state.knownTransactions = [
      ...new Set([...currentHashes, ...state.knownTransactions])
    ].slice(0, 100);

    saveState(state);
    return wallet;
  } catch (error) {
    console.error("Wallet monitor error:", error.message);
    return null;
  }
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);

  // Global commands work in DMs as well as servers.
  // Discord can take a little while to propagate global commands.
  await rest.put(
    Routes.applicationCommands(CONFIG.clientId),
    { body: commands }
  );

  console.log("Global slash commands registered (server + DMs).");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Tracking LTC address: ${CONFIG.address}`);
  console.log(`Checking every ${CONFIG.checkInterval}s`);

  await registerCommands().catch(error => {
    console.error("Command registration failed:", error.message);
  });

  await monitorWallet();
  setInterval(monitorWallet, CONFIG.checkInterval * 1000);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!isOwner(interaction)) {
    return interaction.reply({
      content: "You are not authorized to use this personal wallet manager.",
      ephemeral: true
    });
  }

  try {
    if (interaction.commandName === "balance") {
      await interaction.deferReply({ ephemeral: true });
      const wallet = await fetchWallet();
      return interaction.editReply({ embeds: [buildBalanceEmbed(wallet)] });
    }

    if (interaction.commandName === "address") {
      return interaction.reply({
        content: `**Tracked LTC address:**\n\`${CONFIG.address}\`\n\nhttps://litecoinspace.org/address/${CONFIG.address}`,
        ephemeral: true
      });
    }

    if (interaction.commandName === "refresh") {
      await interaction.deferReply({ ephemeral: true });
      const wallet = await monitorWallet();

      if (!wallet) {
        return interaction.editReply("Could not refresh the wallet right now.");
      }

      return interaction.editReply({
        content: "Wallet refreshed.",
        embeds: [buildBalanceEmbed(wallet)]
      });
    }

    if (interaction.commandName === "status") {
      const wallet = await fetchWallet();

      return interaction.reply({
        content:
          `**LTC Manager Status**\n` +
          `Monitoring: \`ONLINE\`\n` +
          `Check interval: \`${CONFIG.checkInterval}s\`\n` +
          `Known transactions: \`${state.knownTransactions.length}\`\n` +
          `Wallet transactions: \`${wallet.final_n_tx ?? wallet.n_tx ?? 0}\``,
        ephemeral: true
      });
    }

    if (interaction.commandName === "history") {
      await interaction.deferReply({ ephemeral: true });

      const count = interaction.options.getInteger("count") || 5;
      const wallet = await fetchWallet();
      const refs = getTxRefs(wallet);

      const seen = new Set();
      const unique = [];

      for (const ref of refs) {
        if (!ref.tx_hash || seen.has(ref.tx_hash)) continue;
        seen.add(ref.tx_hash);
        unique.push(ref);
        if (unique.length >= count) break;
      }

      if (!unique.length) {
        return interaction.editReply("No transactions found for this address.");
      }

      const lines = unique.map((ref, i) => {
        const type = classifyRef(ref);
        const amount = litoshiToLtc(ref.value);
        const sign = type === "received" ? "+" : type === "sent" ? "-" : "";
        const status = Number(ref.confirmations || 0) > 0
          ? `${ref.confirmations} conf.`
          : "unconfirmed";

        return `**${i + 1}. ${type.toUpperCase()}** ${sign}${fmtLtc(amount)} — ${status}\n` +
               `[${shortHash(ref.tx_hash)}](${explorerUrl(ref.tx_hash)})`;
      });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Recent LTC Transactions")
            .setDescription(lines.join("\n\n"))
            .setTimestamp()
        ]
      });
    }
  } catch (error) {
    console.error(error);

    const message = `Error: ${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

client.login(CONFIG.token);
