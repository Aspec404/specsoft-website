require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
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
};

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`💀 Terminal troll mode ready.\n`);
  console.log(`   PLAIN MODE:`);
  console.log(`     hello world                → plain message`);
  console.log(`     @username hi               → plain message with mention`);
  console.log(`     r:ID hey                   → plain reply\n`);
  console.log(`   EMBED MODE (prefix with /e):`);
  console.log(`     /e hello world             → embed with description`);
  console.log(`     /e Title | Body text       → embed with title + description`);
  console.log(`     /e red Title | Body        → embed with red color`);
  console.log(`     /e r:ID Title | Body       → embed reply\n`);
  console.log(`   REACT MODE:`);
  console.log(`     react:ID 💀                 → react to specific message`);
  console.log(`     reactlast 💀                → react to most recent message\n`);
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

      if (isEmbed) {
        let color = 0x5865F2; // blurple default
        const firstWord = text.split(/\s+/)[0]?.toLowerCase();
        if (COLOR_MAP[firstWord]) {
          color = COLOR_MAP[firstWord];
          text = text.slice(firstWord.length).trim();
        }

        const embed = new EmbedBuilder().setColor(color);

        if (text.includes('|')) {
          const [titlePart, ...rest] = text.split('|');
          embed.setTitle(titlePart.trim() || null);
          const desc = rest.join('|').trim();
          if (desc) embed.setDescription(desc);
        } else {
          embed.setDescription(text || '​');
        }

        payload.embeds = [embed];

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
      console.log(`✅ Sent ${isEmbed ? '[EMBED]' : '[PLAIN]'}: ${text}${replyTo ? ' (reply)' : ''}`);
    } catch (err) {
      console.error('❌ Failed:', err.message);
    }

    rl.prompt();
  });
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