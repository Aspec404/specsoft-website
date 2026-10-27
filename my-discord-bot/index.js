// ============================================================
//  Terminal → Discord sender (self-bot style)
//  Usage:  node index.js
//  Requires ../.env with DISCORD_TOKEN and TROLL_CHANNEL_ID
// ============================================================

require('dotenv').config({ path: '../.env' });

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// ---------- colors ----------
const COLOR_MAP = {
  red: 0xED4245, green: 0x57F287, blue: 0x3498DB, yellow: 0xFEE75C,
  purple: 0x9B59B6, pink: 0xEB459E, orange: 0xE67E22, gold: 0xF1C40F,
  black: 0x000000, white: 0xFFFFFF, blurple: 0x5865F2,
  gray: 0x95A5A6, grey: 0x95A5A6,
};

const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const pendingButtons = new Map();

// ---------- env check ----------
if (!process.env.DISCORD_TOKEN || !process.env.TROLL_CHANNEL_ID) {
  console.error('\n[X] Missing DISCORD_TOKEN or TROLL_CHANNEL_ID in ../.env\n');
  process.exit(1);
}

// ============================================================
//  INPUT — works in any real terminal
// ============================================================
const readline = require('readline');

let rl = null;
let quitting = false;

function startInput(onLine) {
  // Tell Node the keyboard is UTF-8 (fixes garbled emoji).
  try { process.stdin.setEncoding('utf8'); } catch {}

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', async (line) => {
    try {
      await onLine(line);
    } catch (err) {
      console.error('[ERR]', err?.message || err);
    } finally {
      if (!quitting) rl.prompt();
    }
  });

  rl.on('SIGINT', () => rl.close());
}

// ============================================================
//  READY
// ============================================================
client.once(Events.ClientReady, async (me) => {
  console.log(`Logged in as ${me.user.tag}`);

  let channel = null;
  try {
    channel = await client.channels.fetch(process.env.TROLL_CHANNEL_ID.trim());
    if (!channel || !channel.isTextBased()) throw new Error('not a text channel');
    console.log(`Target channel: #${channel.name || channel.id}\n`);
  } catch (err) {
    console.error(`[X] Cannot use channel ${process.env.TROLL_CHANNEL_ID}: ${err.message}\n`);
  }

  console.log('Commands:');
  console.log('  hello world                     -> plain message');
  console.log('  @username hi                    -> mention');
  console.log('  r:MESSAGE_ID hey                -> reply');
  console.log('  /e red Title | Body             -> embed');
  console.log('  /e white T | D | button:GO | ok | clickcolor:green');
  console.log('  react:MESSAGE_ID emoji          -> react');
  console.log('  reactlast emoji                 -> react to newest');
  console.log('  exit                            -> quit\n');

  startInput(async (line) => {
    const raw = line.trim();
    if (!raw) return;

    if (raw.toLowerCase() === 'exit') {
      quitting = true;
      console.log('Bye');
      rl.close();
      try { client.destroy(); } catch {}
      process.exit(0);
      return;
    }

    if (!channel) {
      console.log('[X] No channel loaded. Fix TROLL_CHANNEL_ID.');
      return;
    }

    // ---------- react:ID emoji ----------
    let m = raw.match(/^react:(\d+)\s+(.+)$/);
    if (m) {
      try {
        const msg = await channel.messages.fetch(m[1]);
        await msg.react(m[2].trim());
        console.log(`Reacted ${m[2].trim()} -> ${m[1]}`);
      } catch (err) {
        console.error('[X] React failed:', err.message);
      }
      return;
    }

    // ---------- reactlast emoji ----------
    m = raw.match(/^reactlast\s+(.+)$/);
    if (m) {
      try {
        const msgs = await channel.messages.fetch({ limit: 1 });
        const last = msgs.first();
        if (!last) console.log('[X] No messages.');
        else {
          await last.react(m[1].trim());
          console.log(`Reacted ${m[1].trim()} -> newest`);
        }
      } catch (err) {
        console.error('[X] React failed:', err.message);
      }
      return;
    }

    // ---------- embed or plain ----------
    const isEmbed = raw.startsWith('/e ');
    let text = isEmbed ? raw.slice(3).trim() : raw;

    // mentions
    for (const mm of [...text.matchAll(/@(\S+)/g)]) {
      const name = mm[1].toLowerCase();
      const member = channel.guild.members.cache.find(
        (x) => x.user.username.toLowerCase() === name || x.displayName.toLowerCase() === name
      );
      if (member) text = text.replace(mm[0], `<@${member.id}>`);
    }

    // reply
    let replyTo = null;
    const rm = text.match(/r:(\d+)/);
    if (rm) {
      replyTo = rm[1];
      text = text.replace(rm[0], '').trim();
    }

    const payload = {};
    let btnLabel = null, btnResponse = null, clickColor = 0xED4245, btnStyle = ButtonStyle.Primary;

    if (isEmbed) {
      let color = 0x5865F2;
      const first = text.split(/\s+/)[0]?.toLowerCase();
      if (COLOR_MAP[first]) {
        color = COLOR_MAP[first];
        text = text.slice(first.length).trim();
      }

      const parts = text.split('|').map((p) => p.trim());
      const title = parts[0] || null;
      const desc = parts[1] || null;

      for (let i = 2; i < parts.length; i++) {
        const p = parts[i];
        if (!p) continue;
        const bm = p.match(/^button(?:\.(primary|secondary|success|danger))?:\s*(.+)$/i);
        if (bm) {
          if (bm[1]) btnStyle = STYLES[bm[1].toLowerCase()] ?? ButtonStyle.Primary;
          btnLabel = bm[2].trim();
          continue;
        }
        const cm = p.match(/^clickcolor:\s*(\w+)$/i);
        if (cm) {
          const c = cm[1].toLowerCase();
          if (COLOR_MAP[c]) clickColor = COLOR_MAP[c];
          continue;
        }
        if (btnLabel && !btnResponse) btnResponse = p;
      }

      const embed = new EmbedBuilder().setColor(color);
      if (title) embed.setTitle(title);
      if (desc) embed.setDescription(desc);
      payload.embeds = [embed];

      if (btnLabel) {
        const id = `btn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        payload.components = [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(id).setLabel(btnLabel).setStyle(btnStyle)
          ),
        ];
        pendingButtons.set(id, {
          clickColor,
          response: btnResponse || 'OK',
          embed: embed.toJSON(),
        });
      }

      if (/<@!?\d+>|<@&\d+>|<@everyone>|<@here>/.test(text)) payload.content = '\u200b';
    } else {
      payload.content = text;
    }

    if (replyTo) payload.reply = { messageReference: replyTo, failIfNotExists: false };

    try {
      await channel.send(payload);
      console.log(`Sent${isEmbed ? ' [embed]' : ''}${btnLabel ? ' [button]' : ''}: ${text}`);
    } catch (err) {
      console.error('[X] Send failed:', err.message);
    }
  });
});

// ============================================================
//  BUTTON CLICKS
// ============================================================
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton()) return;
  const cfg = pendingButtons.get(i.customId);
  if (!cfg) return i.reply({ content: 'Stale button.', ephemeral: true });
  try {
    await i.reply({ content: cfg.response, ephemeral: true });
    const updated = EmbedBuilder.from(cfg.embed).setColor(cfg.clickColor);
    await i.message.edit({ embeds: [updated] });
  } catch (err) {
    console.error('[X] Button failed:', err.message);
  }
});

// ============================================================
//  EXIT
// ============================================================
process.on('SIGINT', () => {
  quitting = true;
  console.log('\nBye');
  try { client.destroy(); } catch {}
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);