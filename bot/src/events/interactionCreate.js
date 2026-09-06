import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { getGuildSettings, upsertGuildSettings, getPendingSession, getVerifiedSession } from '../utils/supabase.js';

const configStore = new Map();
const activePollers = new Map();

export async function handleInteractionCreate(client, interaction) {
  try {
    if (interaction.isChatInputCommand()) return handleSlashCommand(client, interaction);
    if (interaction.isStringSelectMenu()) return handleSelectMenu(interaction);
    if (interaction.isButton()) return handleButton(client, interaction);
  } catch (error) {
    console.error('[Verify Hydra] Interaction error:', error.message);
    const reply = { content: 'An internal error occurred. Please try again.', flags: [MessageFlags.Ephemeral] };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  }
}

async function handleSlashCommand(client, interaction) {
  if (interaction.commandName === 'panel') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Server Administrator required.', flags: [MessageFlags.Ephemeral] });
    const embed = new EmbedBuilder().setTitle('VERIFY HYDRA | CONTROL PANEL').setDescription('Configure the verification system for this server.\nAll settings are restricted to the Server Owner.\n\n-> Step 1: Select the public verification channel\n-> Step 2: Select the role granted upon verification\n-> Step 3: Select the quarantine role for new members\n-> Step 4: Choose the security intensity level\n-> Step 5: Click "Save and Initialize"').setColor(0xffffff).addFields(
      { name: '\u2588 TARGET CHANNEL', value: 'Select the channel where the verification prompt will be posted.', inline: false },
      { name: '\u2588 VERIFIED ROLE', value: 'Select the role assigned to verified members.', inline: false },
      { name: '\u2588 QUARANTINE ROLE', value: 'Select the role assigned to new unverified members.', inline: false },
      { name: '\u2588 SECURITY LEVEL', value: '`image-captcha` | Image-based challenge\n`hcaptcha` | hCaptcha widget integration\n`dual-layer` | Both captcha layers (Recommended)', inline: false }
    ).setFooter({ text: 'Verify Hydra | Automated Security Perimeter' }).setTimestamp();
    const channels = interaction.guild.channels.cache.filter((ch) => ch.type === 0);
    const roles = interaction.guild.roles.cache.filter((r) => !r.managed && r.id !== interaction.guild.id);
    const components = [];
    if (channels.size > 0) {
      const channelSelect = new StringSelectMenuBuilder().setCustomId('hydra_select_channel').setPlaceholder('Select verification channel').addOptions(channels.first(25).map((ch) => ({ label: ch.name, value: ch.id, description: `#${ch.name}` })));
      components.push(new ActionRowBuilder().addComponents(channelSelect));
    }
    if (roles.size > 0) {
      const verifiedRoleSelect = new StringSelectMenuBuilder().setCustomId('hydra_select_role').setPlaceholder('Select verified role').addOptions(roles.first(25).map((r) => ({ label: r.name, value: r.id, description: `Role: ${r.name}` })));
      components.push(new ActionRowBuilder().addComponents(verifiedRoleSelect));
      const unverifiedRoleSelect = new StringSelectMenuBuilder().setCustomId('hydra_select_unverified_role').setPlaceholder('Select quarantine role').addOptions(roles.first(25).map((r) => ({ label: r.name, value: r.id, description: `Role: ${r.name}` })));
      components.push(new ActionRowBuilder().addComponents(unverifiedRoleSelect));
    }
    const securitySelect = new StringSelectMenuBuilder().setCustomId('hydra_select_security').setPlaceholder('Select security intensity').addOptions(
      { label: 'Image Captcha', value: 'image-captcha', description: 'Visual challenge verification' },
      { label: 'hCaptcha', value: 'hcaptcha', description: 'hCaptcha widget verification' },
      { label: 'Dual-Layer (Recommended)', value: 'dual-layer', description: 'Maximum security - both captcha types' }
    );
    components.push(new ActionRowBuilder().addComponents(securitySelect));
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hydra_save_config').setLabel('Save and Initialize').setStyle(ButtonStyle.Success)));
    return interaction.reply({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
  }

  if (interaction.commandName === 'setup') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Server Administrator required.', flags: [MessageFlags.Ephemeral] });
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    try {
      const channel = interaction.options.getChannel('channel');
      const verifiedRole = interaction.options.getRole('verified_role');
      const quarantineRole = interaction.options.getRole('quarantine_role');
      const security = interaction.options.getString('security');
      if (!channel || channel.type !== 0) return interaction.editReply({ content: 'Channel must be a text channel.' });
      if (!verifiedRole || verifiedRole.managed || verifiedRole.id === interaction.guild.id) return interaction.editReply({ content: 'Invalid verified role.' });
      if (!quarantineRole || quarantineRole.managed || quarantineRole.id === interaction.guild.id) return interaction.editReply({ content: 'Invalid quarantine role.' });
      if (verifiedRole.id === quarantineRole.id) return interaction.editReply({ content: 'Verified role and quarantine role must be different.' });
      await upsertGuildSettings({ guild_id: interaction.guildId, control_channel_id: interaction.channelId, public_verify_channel_id: channel.id, verified_role_id: verifiedRole.id, unverified_role_id: quarantineRole.id, security_level: security });
      const verifyEmbed = new EmbedBuilder().setTitle('ACCESS VERIFICATION REQUIRED').setDescription('This server is protected by **Verify Hydra**.\n\n' + `**Server**\n\`\`\`\n${interaction.guild.name}\n\`\`\`\n` + '**How it works**\n' + '1. Click the button below to start\n' + '2. Complete the captcha challenge on the secure page\n' + '3. Return here — your role will be assigned automatically\n\n' + '*Verification expires in 5 minutes.*').setColor(0xffffff).setThumbnail(interaction.guild.iconURL({ size: 128 })).setFooter({ text: `${interaction.guild.name} | Verify Hydra` }).setTimestamp();
      const verifyButton = new ButtonBuilder().setCustomId('hydra_verify_button').setLabel('Verify My Account').setStyle(ButtonStyle.Primary);
      await channel.send({ embeds: [verifyEmbed], components: [new ActionRowBuilder().addComponents(verifyButton)] });
      const successEmbed = new EmbedBuilder().setTitle('CONFIGURATION SAVED').setDescription(`**Channel:** <#${channel.id}>\n**Verified Role:** <@&${verifiedRole.id}>\n**Quarantine Role:** <@&${quarantineRole.id}>\n**Security:** \`${security}\``).setColor(0xffffff).setFooter({ text: 'Verify Hydra | System Initialized' });
      return interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
      console.error('[Verify Hydra] Setup error:', error.message);
      return interaction.editReply({ content: 'Failed to complete setup. Check the Wispbyte console for details.' });
    }
  }
}

async function handleSelectMenu(interaction) {
  const { customId, values, guildId } = interaction;
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Insufficient permissions. Server Administrator required.', flags: [MessageFlags.Ephemeral] });
  if (!configStore.has(guildId)) configStore.set(guildId, {});
  const config = configStore.get(guildId);
  if (customId === 'hydra_select_channel') { config.channelId = values[0]; configStore.set(guildId, config); return interaction.reply({ content: `Verification channel set to <#${values[0]}>.`, flags: [MessageFlags.Ephemeral] }); }
  if (customId === 'hydra_select_role') { config.roleId = values[0]; configStore.set(guildId, config); return interaction.reply({ content: `Verified role set to <@&${values[0]}>.`, flags: [MessageFlags.Ephemeral] }); }
  if (customId === 'hydra_select_security') { config.securityLevel = values[0]; configStore.set(guildId, config); return interaction.reply({ content: `Security level set to \`${values[0]}\`.`, flags: [MessageFlags.Ephemeral] }); }
  if (customId === 'hydra_select_unverified_role') { config.unverifiedRoleId = values[0]; configStore.set(guildId, config); return interaction.reply({ content: `Quarantine role set to <@&${values[0]}>.`, flags: [MessageFlags.Ephemeral] }); }
}

async function handleButton(client, interaction) {
  if (interaction.customId === 'hydra_save_config') return handleSaveConfig(client, interaction);
  if (interaction.customId === 'hydra_verify_button') return handleVerifyButton(client, interaction);
}

async function handleSaveConfig(client, interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Insufficient permissions. Server Administrator required.', flags: [MessageFlags.Ephemeral] });
  const config = configStore.get(interaction.guildId);
  if (!config || !config.channelId || !config.roleId || !config.unverifiedRoleId || !config.securityLevel) return interaction.reply({ content: 'Configuration incomplete. Please select all four options:\n-> Verification Channel\n-> Verified Role\n-> Quarantine Role\n-> Security Level', flags: [MessageFlags.Ephemeral] });
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  try {
    await upsertGuildSettings({ guild_id: interaction.guildId, control_channel_id: interaction.channelId, public_verify_channel_id: config.channelId, verified_role_id: config.roleId, unverified_role_id: config.unverifiedRoleId, security_level: config.securityLevel });
    const verifyChannel = interaction.guild.channels.cache.get(config.channelId);
    if (!verifyChannel) return interaction.editReply({ content: 'Error: Target verification channel not found. Reconfigure and try again.' });
    const verifyEmbed = new EmbedBuilder().setTitle('ACCESS VERIFICATION REQUIRED').setDescription('This server is protected by **Verify Hydra**.\n\n' + `**Server**\n\`\`\`\n${interaction.guild.name}\n\`\`\`\n` + '**How it works**\n' + '1. Click the button below to start\n' + '2. Complete the captcha challenge on the secure page\n' + '3. Return here — your role will be assigned automatically\n\n' + '*Verification expires in 5 minutes.*').setColor(0xffffff).setThumbnail(interaction.guild.iconURL({ size: 128 })).setFooter({ text: `${interaction.guild.name} | Verify Hydra` }).setTimestamp();
    const verifyButton = new ButtonBuilder().setCustomId('hydra_verify_button').setLabel('Verify My Account').setStyle(ButtonStyle.Primary);
    await verifyChannel.send({ embeds: [verifyEmbed], components: [new ActionRowBuilder().addComponents(verifyButton)] });
    configStore.delete(interaction.guildId);
    const successEmbed = new EmbedBuilder().setTitle('CONFIGURATION SAVED').setDescription(`**Channel:** <#${config.channelId}>\n**Verified Role:** <@&${config.roleId}>\n**Quarantine Role:** <@&${config.unverifiedRoleId}>\n**Security:** \`${config.securityLevel}\``).setColor(0xffffff).setFooter({ text: 'Verify Hydra | System Initialized' });
    await interaction.editReply({ embeds: [successEmbed] });
    console.log(`[Verify Hydra] Config saved for guild ${interaction.guildId}`);
  } catch (error) {
    console.error('[Verify Hydra] Save config error:', error.message);
    await interaction.editReply({ content: 'Failed to save configuration. Check console for details.' });
  }
}

async function isAlreadyVerified(client, interaction) {
  const guildSettings = await getGuildSettings(interaction.guildId);
  if (!guildSettings) return false;
  const guild = client.guilds.cache.get(interaction.guildId);
  if (!guild) return false;
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  const verifiedRole = guild.roles.cache.get(guildSettings.verified_role_id);
  if (!verifiedRole) return false;
  return member.roles.cache.has(verifiedRole.id);
}

async function handleVerifyButton(client, interaction) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  try {
    if (await isAlreadyVerified(client, interaction)) {
      const alreadyEmbed = new EmbedBuilder().setTitle('ACCOUNT STATUS').setDescription('Your account is already verified within this server. Full access is granted.').setColor(0x1a1a1a).setFooter({ text: 'Verify Hydra | Access Confirmed' }).setTimestamp();
      return interaction.editReply({ embeds: [alreadyEmbed] });
    }
    const guildSettings = await getGuildSettings(interaction.guildId);
    const securityLevel = guildSettings ? guildSettings.security_level : 'dual-layer';
    let workerUrl = (process.env.HYDRA_WORKER_URL || '').trim().replace(/\/$/, '');
    if (!workerUrl) return interaction.editReply({ content: 'Verification service is not configured.' });
    if (!/^https?:\/\//i.test(workerUrl)) workerUrl = `https://${workerUrl}`;
    const response = await fetch(`${workerUrl}/api/request-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.INTERNAL_API_KEY}` }, body: JSON.stringify({ user_id: interaction.user.id, guild_id: interaction.guildId, guild_name: interaction.guild.name, security_level: securityLevel }) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!response.ok || !data?.verification_url) { console.error('[Verify Hydra] Worker verification request failed:', response.status, text); return interaction.editReply({ content: 'Verification service is temporarily unavailable. Please try again.' }); }
    const verificationUrl = data.verification_url;
    if (!/^https?:\/\//i.test(verificationUrl)) return interaction.editReply({ content: 'Verification service returned an invalid verification link.' });
    const verifyEmbed = new EmbedBuilder().setTitle('VERIFICATION CHALLENGE').setDescription('Complete the secure captcha challenge using the button below.\n\n**Link expires in 5 minutes.**').setColor(0xffffff).setFooter({ text: 'Verify Hydra | Secure Verification' });
    const verifyButton = new ButtonBuilder().setLabel('Open Verification').setStyle(ButtonStyle.Link).setURL(verificationUrl);
    return interaction.editReply({ embeds: [verifyEmbed], components: [new ActionRowBuilder().addComponents(verifyButton)] });
  } catch (error) {
    console.error('[Verify Hydra] Verification request error:', error.message);
    return interaction.editReply({ content: 'Unable to start verification. Please try again.' });
  }
}
