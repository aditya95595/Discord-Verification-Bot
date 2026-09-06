import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { handleGuildCreate } from './events/guildCreate.js';
import { handleInteractionCreate } from './events/interactionCreate.js';
import { handleGuildMemberAdd } from './events/guildMemberAdd.js';
import { registerSlashCommands } from './deploy-commands.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('clientReady', async () => {
  const count = client.guilds.cache.size;
  client.user.setActivity(`${count} servers`, { type: ActivityType.Playing });
  console.log(`[AGENT 001] Bot online: ${client.user.tag}`);
  console.log(`[AGENT 001] Serving ${count} guild(s)`);

  try {
    await registerSlashCommands();
  } catch (error) {
    console.error('[AGENT 001] Slash command registration failed:', error.message);
  }
});

client.on('guildCreate', (guild) => {
  handleGuildCreate(client, guild);
  const count = client.guilds.cache.size;
  client.user.setActivity(`${count} servers`, { type: ActivityType.Playing });
});

client.on('guildMemberAdd', (member) => handleGuildMemberAdd(client, member));
client.on('interactionCreate', (interaction) => handleInteractionCreate(client, interaction));

client.login(process.env.DISCORD_TOKEN);
