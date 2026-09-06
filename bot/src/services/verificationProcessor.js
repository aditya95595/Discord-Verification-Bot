import { getGuildSettings, getLatestVerifiedSession } from '../utils/supabase.js';

const processedTokens = new Set();

export async function processVerifiedSessions(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const settings = await getGuildSettings(guild.id);
      if (!settings?.verified_role_id) continue;

      const session = await getLatestVerifiedSession(guild.id);
      if (!session || processedTokens.has(session.token)) continue;

      const member = await guild.members.fetch(session.user_id).catch(() => null);
      if (!member) {
        processedTokens.add(session.token);
        continue;
      }

      const verifiedRole = guild.roles.cache.get(settings.verified_role_id) || await guild.roles.fetch(settings.verified_role_id).catch(() => null);
      if (!verifiedRole || verifiedRole.managed || verifiedRole.id === guild.id) {
        console.error(`[AGENT 001] Verified role is missing/invalid in ${guild.name}`);
        continue;
      }

      const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
      if (botMember && botMember.roles.highest.position <= verifiedRole.position) {
        console.error(`[AGENT 001] Cannot assign verified role in ${guild.name}: role is above the bot.`);
        continue;
      }

      if (!member.roles.cache.has(verifiedRole.id)) {
        await member.roles.add(verifiedRole, 'AGENT 001 - Verification completed');
        console.log(`[AGENT 001] Verified role assigned to ${member.user.tag} in ${guild.name}`);
      }

      if (settings.unverified_role_id && member.roles.cache.has(settings.unverified_role_id)) {
        const unverifiedRole = guild.roles.cache.get(settings.unverified_role_id) || await guild.roles.fetch(settings.unverified_role_id).catch(() => null);
        if (unverifiedRole && !unverifiedRole.managed && unverifiedRole.id !== guild.id && (!botMember || botMember.roles.highest.position > unverifiedRole.position)) {
          await member.roles.remove(unverifiedRole, 'AGENT 001 - Verification completed');
        }
      }

      processedTokens.add(session.token);
      if (processedTokens.size > 5000) processedTokens.clear();
    } catch (error) {
      console.error(`[AGENT 001] Verification role processing error in ${guild.name}:`, error.message);
    }
  }
}
