import { getGuildSettings } from '../utils/supabase.js';

export async function handleGuildMemberAdd(client, member) {
  try {
    if (member.user.bot) return;

    const guildSettings = await getGuildSettings(member.guild.id);
    if (!guildSettings) return;

    const botMember = member.guild.members.cache.get(client.user.id);

    if (guildSettings.autorole_id) {
      const autorole = member.guild.roles.cache.get(guildSettings.autorole_id);
      if (autorole && !autorole.managed && autorole.id !== member.guild.id && (!botMember || botMember.roles.highest.position > autorole.position)) {
        await member.roles.add(autorole, 'AGENT 001 - Autorole on join');
      }
    }

    if (guildSettings.unverified_role_id) {
      const quarantineRole = member.guild.roles.cache.get(guildSettings.unverified_role_id);
      if (quarantineRole && !quarantineRole.managed && quarantineRole.id !== member.guild.id && (!botMember || botMember.roles.highest.position > quarantineRole.position)) {
        await member.roles.add(quarantineRole, 'AGENT 001 - New member quarantine');
      }
    }
  } catch (error) {
    console.error('[AGENT 001] Failed to process new member roles:', error.message);
  }
}
