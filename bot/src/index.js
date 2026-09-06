import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { handleGuildCreate } from './events/guildCreate.js';
import { handleInteractionCreate } from './events/interactionCreate.js';
import { handleGuildMemberAdd } from './events/guildMemberAdd.js';
import { registerSlashCommands } from './deploy-commands.js';
import { processVerifiedSessions } from './services/verificationProcessor.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

let verificationProcessorRunning = false;

async function runVerificationProcessor() {
  if (verificationProcessorRunning) return;
  verificationProcessorRunning = true;
  try {
    await processVerifiedSessions(client);
  } catch (error) {
    console.error('[AGENT 001] Verification processor error:', error.message);
  } finally {
    verificationProcessorRunning = false;
  }
}

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

  await runVerificationProcessor();
  setInterval(runVerificationProcessor, 3000).unref?.();
});

client.on('guildCreate', (guild) => {
  handleGuildCreate(client, guild);
  const count = client.guilds.cache.size;
  client.user.setActivity(`${count} servers`, { type: ActivityType.Playing });
});

client.on('guildMemberAdd', (member) => handleGuildMemberAdd(client, member));
client.on('interactionCreate', (interaction) => handleInteractionCreate(client, interaction));

client.login(process.env.DISCORD_TOKEN);
