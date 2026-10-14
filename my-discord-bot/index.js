require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const readline = require('readline');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const COLOR_MAP = {
  red: 0xED4245,
  green: 0x57F287,
  blue: 0x3498DB,
  yellow: 0xFEE75C,
  purple: 0x9B59B6,
  pink: 0xEB459E,
  orange: 0xE67E22,
  gold: 0xF1C40F,
  black: 0x000000,
  white: 0xFFFFFF,
  blurple: 0x5865F2,
  gray: 0x95A5A6,
  grey: 0x95A5A6,
};

const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

// Store pending button configs (in-memory only)
const pendingButtons = new Map();

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`💀 Terminal troll mode ready.\n`);
  console.log(`   PLAIN:`);
  console.log(`     hello world                → plain message`);
  console.log(`     @username hi               → plain message with mention`);
  console.log(`     r:ID hey                   → plain reply\n`);
  console.log(`   EMBED (instant, no cooldown):`);
  console.log(`     /e red Title | Body        → simple embed`);
  console.log(`     /e white T | D | button:LABEL | RESPONSE | clickcolor:red`);
  console.log(`                                → embed + button that recolors on click\n`);
  console.log(`   REACT:`);
  console.log(`     react:ID 💀                 → react to message`);
  console.log(`     reactlast 💀                → react to latest message\n`);
  console.log(`   exit                          → quit\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🗣️  > ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const raw = line.trim();

    if (raw.toLowerCase() === 'exit') {
      console.log('👋 Bye!');
      rl.close();
      client.destroy();
      process.exit(0);
    }
    if (!raw) return rl.prompt();

    try {
      const channel = await client.channels.fetch(process.env.TROLL_CHANNEL_ID);
      if (!channel || !channel.isTextBased()) {
        console.log('❌ Channel not found or not text-based.');
        return rl.prompt();
      }

      // ============================================
      // ⌨️ TYPING INDICATOR (conditional delay)
      // - Plain messages: short natural delay
      // - Embed commands (/e): INSTANT, no delay
      // - React commands: no typing at all
      // ============================================
      const isReactCommand = /^react:|^reactlast/.test(raw);
      const isEmbedCommand = raw.startsWith('/e ');

      if (!isReactCommand) {
        await channel.sendTyping().catch(() => {});

        if (isEmbedCommand) {
          // Embeds fire instantly
          console.log('   ⚡ embed mode — instant send');
        } else {
          // Plain messages get a short natural delay
          process.stdout.write('   ⌨️  typing...');
          const delay = Math.min(300 + raw.length * 15, 1800);
          await new Promise((r) => setTimeout(r, delay));
          process.stdout.write('\r                \r');
        }
      }

      // ============================================
      // 🎯 REACT to specific message: react:ID emoji
      // ============================================
      const reactMatch = raw.match(/^react:(\d+)\s+(.+)$/);
      if (reactMatch) {
        const [, msgId, emoji] = reactMatch;
        try {
          const targetMsg = await channel.messages.fetch(msgId);
          await targetMsg.react(emoji.trim());
          console.log(`✅ Reacted ${emoji.trim()} to ${msgId}`);
        } catch (err) {
          console.error('❌ React failed:', err.message);
        }
        return rl.prompt();
      }

      // ============================================
      // 🎯 REACT to last message: reactlast emoji
      // ============================================
      const reactLastMatch = raw.match(/^reactlast\s+(.+)$/);
      if (reactLastMatch) {
        const emoji = reactLastMatch[1].trim();
        try {
          const messages = await channel.messages.fetch({ limit: 1 });
          const lastMsg = messages.first();
          if (!lastMsg) {
            console.log('❌ No messages found.');
          } else {
            await lastMsg.react(emoji);
            console.log(`✅ Reacted ${emoji} to last message`);
          }
        } catch (err) {
          console.error('❌ React failed:', err.message);
        }
        return rl.prompt();
      }

      // ============================================
      // 📝 MESSAGE MODE (plain or embed)
      // ============================================
      const isEmbed = raw.startsWith('/e ');
      let text = isEmbed ? raw.slice(3).trim() : raw;

      // --- Parse mentions: @username → <@id> ---
      const mentionMatches = [...text.matchAll(/@(\S+)/g)];
      for (const match of mentionMatches) {
        const username = match[1];
        const member = channel.guild.members.cache.find(
          (m) =>
            m.user.username.toLowerCase() === username.toLowerCase() ||
            m.displayName.toLowerCase() === username.toLowerCase()
        );
        if (member) text = text.replace(match[0], `<@${member.id}>`);
      }

      // --- Parse reply: r:ID ---
      let replyTo = null;
      const replyMatch = text.match(/r:(\d+)/);
      if (replyMatch) {
        replyTo = replyMatch[1];
        text = text.replace(replyMatch[0], '').trim();
      }

      // --- Build payload ---
      const payload = {};

      // Declared OUTSIDE embed block so both branches can use them
      let buttonLabel = null;
      let buttonResponse = null;
      let clickColor = 0xED4245;
      let buttonStyle = ButtonStyle.Primary;

      if (isEmbed) {
        // Check for color keyword
        let color = 0x5865F2;
        const firstWord = text.split(/\s+/)[0]?.toLowerCase();
        if (COLOR_MAP[firstWord]) {
          color = COLOR_MAP[firstWord];
          text = text.slice(firstWord.length).trim();
        }

        // Split by | for parts
        const parts = text.split('|').map((p) => p.trim());
        const title = parts[0] || null;
        const desc = parts[1] || null;

        for (let i = 2; i < parts.length; i++) {
          const part = parts[i];
          if (!part) continue;

          const btnMatch = part.match(
            /^button(?:\.(primary|secondary|success|danger))?:\s*(.+)$/i
          );
          if (btnMatch) {
            if (btnMatch[1]) {
              buttonStyle = BUTTON_STYLES[btnMatch[1].toLowerCase()] ?? ButtonStyle.Primary;
            }
            buttonLabel = btnMatch[2].trim();
            continue;
          }

          const colorMatch = part.match(/^clickcolor:\s*(\w+)$/i);
          if (colorMatch) {
            const c = colorMatch[1].toLowerCase();
            if (COLOR_MAP[c]) clickColor = COLOR_MAP[c];
            continue;
          }

          if (buttonLabel && !buttonResponse) {
            buttonResponse = part;
          }
        }

        const embed = new EmbedBuilder().setColor(color);
        if (title) embed.setTitle(title);
        if (desc) embed.setDescription(desc);

        payload.embeds = [embed];

        if (buttonLabel) {
          const customId = `btn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const button = new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(buttonLabel)
            .setStyle(buttonStyle);

          const row = new ActionRowBuilder().addComponents(button);
          payload.components = [row];

          pendingButtons.set(customId, {
            clickColor,
            buttonResponse: buttonResponse || '▸ ACKNOWLEDGED.',
            originalEmbed: embed.toJSON(),
            channelId: channel.id,
          });
        }

        // Keep mentions pinging even inside embeds
        if (text.match(/<@!?\d+>|<@&\d+>|<@everyone>|<@here>/)) {
          payload.content = '​';
        }
      } else {
        payload.content = text;
      }

      if (replyTo) {
        payload.reply = { messageReference: replyTo, failIfNotExists: false };
      }

      await channel.send(payload);
      console.log(
        `✅ Sent ${isEmbed ? '[EMBED]' : '[PLAIN]'}${buttonLabel ? ' [BUTTON]' : ''}: ${text}`
      );
    } catch (err) {
      console.error('❌ Failed:', err.message);
    }

    rl.prompt();
  });
});

// ============================================
// 🖱️ BUTTON INTERACTION HANDLER
// ============================================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const config = pendingButtons.get(interaction.customId);
  if (!config) {
    return interaction.reply({
      content: '▸ STALE BUTTON. NO CONFIG FOUND.',
      ephemeral: true,
    });
  }

  try {
    await interaction.reply({ content: config.buttonResponse, ephemeral: true });

    const updatedEmbed = EmbedBuilder.from(config.originalEmbed).setColor(config.clickColor);
    await interaction.message.edit({ embeds: [updatedEmbed] });

    // Uncomment to remove the button after one click:
    // await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
  } catch (err) {
    console.error('❌ Button interaction failed:', err.message);
  }
});

// ============================================
// 🤖 DISCORD-SIDE COMMANDS (no auto-reactions)
// ============================================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') return message.reply('🏓 Pong!');
  if (message.content === '!hello') return message.reply(`Hey ${message.author.username}! 👋`);
});

client.login(process.env.DISCORD_TOKEN);