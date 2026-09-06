import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildSettings, upsertGuildSettings } from '../utils/supabase.js';

const configStore = new Map();
const embedDrafts = new Map();
const EMBED_DRAFT_TTL = 10 * 60 * 1000;

export async function handleInteractionCreate(client, interaction) {
  try {
    if (interaction.isChatInputCommand()) return handleSlashCommand(client, interaction);
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'agent_embed_create_modal' || interaction.customId === 'agent_embed_edit_modal') return handleEmbedModal(client, interaction);
      return;
    }
    if (interaction.isStringSelectMenu()) return handleSelectMenu(interaction);
    if (interaction.isButton()) return handleButton(client, interaction);
  } catch (error) {
    console.error('[AGENT 001] Interaction error:', error);
    const reply = { content: 'An internal error occurred. Please try again.', flags: [MessageFlags.Ephemeral] };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
}

function canManageEmbeds(interaction) {
  return isAdmin(interaction) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) === true;
}

function validUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeColor(value) {
  if (!value) return 0xffffff;
  const raw = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return parseInt(raw, 16);
}

function addOptionalInput(modal, customId, label, value = '', placeholder = '') {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false);
  if (value) input.setValue(value.slice(0, 4000));
  if (placeholder) input.setPlaceholder(placeholder);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
}

function createEmbedModal(mode, draft = {}) {
  const modal = new ModalBuilder().setCustomId(mode === 'edit' ? 'agent_embed_edit_modal' : 'agent_embed_create_modal').setTitle(mode === 'edit' ? 'EDIT PREMIUM EMBED' : 'PREMIUM EMBED BUILDER');
  addOptionalInput(modal, 'media_url', 'Main Image / GIF / Animated Banner URL', draft.media_url || '', 'https://example.com/banner.gif');
  addOptionalInput(modal, 'thumbnail_url', 'Thumbnail URL', draft.thumbnail_url || '', 'Optional small image');
  addOptionalInput(modal, 'embed_url', 'Embed / Button Link URL', draft.embed_url || '', 'https://example.com');
  addOptionalInput(modal, 'footer', 'Footer Text', draft.footer || '', 'AGENT 001 • Server Name');
  addOptionalInput(modal, 'footer_icon_url', 'Footer Icon URL', draft.footer_icon_url || '', 'Defaults to server icon');
  return modal;
}

function makeSelectRow(customId, placeholder, options) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options.slice(0, 25)));
}

function scheduleDraftCleanup(key) {
  const timer = setTimeout(() => {
    const draft = embedDrafts.get(key);
    if (draft && Date.now() - draft.createdAt >= EMBED_DRAFT_TTL) embedDrafts.delete(key);
  }, EMBED_DRAFT_TTL + 1000);
  timer.unref?.();
}

async function handleSlashCommand(client, interaction) {
  if (!interaction.guildId || !interaction.guild) return interaction.reply({ content: 'This command can only be used inside a server.', flags: [MessageFlags.Ephemeral] });

  if (interaction.commandName === 'autorole') {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Server Administrator required.', flags: [MessageFlags.Ephemeral] });
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    try {
      const role = interaction.options.getRole('role');
      if (!role || role.managed || role.id === interaction.guild.id) return interaction.editReply({ content: 'Invalid role. Select a normal, non-managed role.' });
      const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(client.user.id).catch(() => null);
      if (botMember && botMember.roles.highest.position <= role.position) return interaction.editReply({ content: 'I cannot assign that role. Move the role below AGENT 001 in Server Settings → Roles.' });
      const current = await getGuildSettings(interaction.guildId);
      await upsertGuildSettings({ guild_id: interaction.guildId, control_channel_id: current?.control_channel_id || interaction.channelId, public_verify_channel_id: current?.public_verify_channel_id || null, verified_role_id: current?.verified_role_id || null, unverified_role_id: current?.unverified_role_id || null, autorole_id: role.id, security_level: current?.security_level || 'dual-layer' });
      return interaction.editReply({ content: `✅ Autorole enabled. New members will automatically receive <@&${role.id}>.` });
    } catch (error) {
      console.error('[AGENT 001] Autorole setup error:', error);
      return interaction.editReply({ content: 'Failed to save autorole configuration.' });
    }
  }

  if (interaction.commandName === 'embed') {
    if (!canManageEmbeds(interaction)) return interaction.reply({ content: 'Administrator or Manage Messages permission required.', flags: [MessageFlags.Ephemeral] });
    const channel = interaction.options.getChannel('channel');
    if (!channel || !channel.isTextBased() || !channel.isSendable?.()) return interaction.reply({ content: 'Select a text channel where AGENT 001 can send messages.', flags: [MessageFlags.Ephemeral] });
    const color = normalizeColor(interaction.options.getString('color'));
    if (color === null) return interaction.reply({ content: 'Invalid color. Use a 6-digit hex value such as `#5865F2`.', flags: [MessageFlags.Ephemeral] });
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const guildIcon = interaction.guild.iconURL({ extension: 'png', size: 512 }) || '';
    embedDrafts.set(key, { mode: 'create', channelId: channel.id, title: interaction.options.getString('title'), description: interaction.options.getString('description'), color, media_url: guildIcon, thumbnail_url: client.user.displayAvatarURL({ extension: 'png', size: 256 }) || '', embed_url: '', footer: `AGENT 001 • ${interaction.guild.name}`, footer_icon_url: interaction.guild.iconURL({ extension: 'png', size: 128 }) || '', createdAt: Date.now() });
    scheduleDraftCleanup(key);
    return interaction.showModal(createEmbedModal('create', embedDrafts.get(key)));
  }

  if (interaction.commandName === 'embed-edit') {
    if (!canManageEmbeds(interaction)) return interaction.reply({ content: 'Administrator or Manage Messages permission required.', flags: [MessageFlags.Ephemeral] });
    const channel = interaction.options.getChannel('channel');
    if (!channel || !channel.isTextBased()) return interaction.reply({ content: 'Select a text channel.', flags: [MessageFlags.Ephemeral] });
    const messageId = interaction.options.getString('message_id')?.trim();
    if (!/^\d{17,20}$/.test(messageId || '')) return interaction.reply({ content: 'Invalid Discord message ID.', flags: [MessageFlags.Ephemeral] });
    try {
      const message = await channel.messages.fetch(messageId);
      const existing = message.embeds[0];
      if (!existing) return interaction.reply({ content: 'That message does not contain an embed.', flags: [MessageFlags.Ephemeral] });
      if (message.author.id !== client.user.id) return interaction.reply({ content: 'I can only edit embeds sent by AGENT 001.', flags: [MessageFlags.Ephemeral] });
      const colorOption = interaction.options.getString('color');
      const color = colorOption ? normalizeColor(colorOption) : (existing.color ?? 0xffffff);
      if (color === null) return interaction.reply({ content: 'Invalid color. Use a 6-digit hex value such as `#5865F2`.', flags: [MessageFlags.Ephemeral] });
      const key = `${interaction.guildId}:${interaction.user.id}`;
      embedDrafts.set(key, { mode: 'edit', channelId: channel.id, messageId: message.id, title: interaction.options.getString('title') || existing.title || 'AGENT 001', description: interaction.options.getString('description') || existing.description || '', color, media_url: existing.image?.url || '', thumbnail_url: existing.thumbnail?.url || '', embed_url: existing.url || '', footer: existing.footer?.text || `AGENT 001 • ${interaction.guild.name}`, footer_icon_url: existing.footer?.iconURL || interaction.guild.iconURL({ extension: 'png', size: 128 }) || '', createdAt: Date.now() });
      scheduleDraftCleanup(key);
      return interaction.showModal(createEmbedModal('edit', embedDrafts.get(key)));
    } catch (error) {
      console.error('[AGENT 001] Embed edit preparation error:', error);
      return interaction.reply({ content: 'Could not fetch that message. Make sure the message ID and channel are correct.', flags: [MessageFlags.Ephemeral] });
    }
  }

  if (interaction.commandName === 'panel') {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Server Administrator required.', flags: [MessageFlags.Ephemeral] });
    const embed = new EmbedBuilder().setTitle('AGENT 001 | CONTROL PANEL').setDescription('Configure the verification system for this server.\n\n→ Step 1: Select the public verification channel\n→ Step 2: Select the role granted upon verification\n→ Step 3: Select the quarantine role for new members\n→ Step 4: Choose the security intensity level\n→ Step 5: Click **Save and Initialize**').setColor(0xffffff).addFields(
      { name: '█ TARGET CHANNEL', value: 'Select the channel where the verification prompt will be posted.', inline: false },
      { name: '█ VERIFIED ROLE', value: 'Select the role assigned to verified members.', inline: false },
      { name: '█ QUARANTINE ROLE', value: 'Select the role assigned to new unverified members.', inline: false },
      { name: '█ SECURITY LEVEL', value: '`image-captcha` | Image-based challenge\n`hcaptcha` | hCaptcha widget integration\n`dual-layer` | Both captcha layers (Recommended)', inline: false },
    ).setFooter({ text: 'AGENT 001 | Automated Security Perimeter' }).setTimestamp();

    const channels = interaction.guild.channels.cache.filter((channel) => channel.type === 0).sort((a, b) => a.rawPosition - b.rawPosition);
    const roles = interaction.guild.roles.cache.filter((role) => !role.managed && role.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
    const components = [];
    if (channels.size > 0) {
      const channelOptions = channels.map((channel) => ({ label: channel.name.slice(0, 100), value: channel.id, description: `#${channel.name}`.slice(0, 100) }));
      components.push(makeSelectRow('hydra_select_channel', 'Select verification channel', channelOptions));
    }
    if (roles.size > 0) {
      const roleOptions = roles.map((role) => ({ label: role.name.slice(0, 100), value: role.id, description: `Role: ${role.name}`.slice(0, 100) }));
      components.push(makeSelectRow('hydra_select_role', 'Select verified role', roleOptions));
      components.push(makeSelectRow('hydra_select_unverified_role', 'Select quarantine role', roleOptions));
    }
    components.push(makeSelectRow('hydra_select_security', 'Select security intensity', [
      { label: 'Image Captcha', value: 'image-captcha', description: 'Visual challenge verification' },
      { label: 'hCaptcha', value: 'hcaptcha', description: 'hCaptcha widget verification' },
      { label: 'Dual-Layer (Recommended)', value: 'dual-layer', description: 'Maximum security - both captcha types' },
    ]));
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hydra_save_config').setLabel('Save and Initialize').setStyle(ButtonStyle.Success)));
    return interaction.reply({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
  }

  if (interaction.commandName === 'setup') {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'Server Administrator required.', flags: [MessageFlags.Ephemeral] });
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    try {
      const channel = interaction.options.getChannel('channel');
      const verifiedRole = interaction.options.getRole('verified_role');
      const quarantineRole = interaction.options.getRole('quarantine_role');
      const security = interaction.options.getString('security');
      if (!channel || channel.type !== 0 || !channel.isSendable?.()) return interaction.editReply({ content: 'Channel must be a sendable text channel.' });
      if (!verifiedRole || verifiedRole.managed || verifiedRole.id === interaction.guild.id) return interaction.editReply({ content: 'Invalid verified role.' });
      if (!quarantineRole || quarantineRole.managed || quarantineRole.id === interaction.guild.id) return interaction.editReply({ content: 'Invalid quarantine role.' });
      if (verifiedRole.id === quarantineRole.id) return interaction.editReply({ content: 'Verified role and quarantine role must be different.' });
      const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(client.user.id).catch(() => null);
      if (botMember && (botMember.roles.highest.position <= verifiedRole.position || botMember.roles.highest.position <= quarantineRole.position)) return interaction.editReply({ content: 'Both selected roles must be below AGENT 001 in Server Settings → Roles.' });
      const current = await getGuildSettings(interaction.guildId);
      await upsertGuildSettings({ guild_id: interaction.guildId, control_channel_id: interaction.channelId, public_verify_channel_id: channel.id, verified_role_id: verifiedRole.id, unverified_role_id: quarantineRole.id, autorole_id: current?.autorole_id || null, security_level: security });
      const verifyEmbed = new EmbedBuilder().setTitle('ACCESS VERIFICATION REQUIRED').setDescription(`This server is protected by **AGENT 001**.\n\n**Server**\n\`\`\`\n${interaction.guild.name}\n\`\`\`\n\n**How it works**\n1. Click the button below to start\n2. Complete the captcha challenge on the secure page\n3. Return here — your role will be assigned automatically\n\n*Verification expires in 5 minutes.*`).setColor(0xffffff).setThumbnail(interaction.guild.iconURL({ size: 128 })).setFooter({ text: `${interaction.guild.name} | AGENT 001` }).setTimestamp();
      await channel.send({ embeds: [verifyEmbed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hydra_verify_button').setLabel('Verify My Account').setStyle(ButtonStyle.Primary))] });
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('CONFIGURATION SAVED').setDescription(`**Channel:** <#${channel.id}>\n**Verified Role:** <@&${verifiedRole.id}>\n**Quarantine Role:** <@&${quarantineRole.id}>\n**Security:** \`${security}\``).setColor(0xffffff).setFooter({ text: 'AGENT 001 | System Initialized' })] });
    } catch (error) {
      console.error('[AGENT 001] Setup error:', error);
      return interaction.editReply({ content: 'Failed to complete setup. Check the Wispbyte console for details.' });
    }
  }
}

async function handleEmbedModal(client, interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const draft = embedDrafts.get(key);
  if (!draft || Date.now() - draft.createdAt > EMBED_DRAFT_TTL) {
    embedDrafts.delete(key);
    return interaction.reply({ content: 'Embed draft expired. Run the command again.', flags: [MessageFlags.Ephemeral] });
  }
  if (!canManageEmbeds(interaction)) return interaction.reply({ content: 'Administrator or Manage Messages permission required.', flags: [MessageFlags.Ephemeral] });

  const mediaUrl = interaction.fields.getTextInputValue('media_url').trim();
  const thumbnailUrl = interaction.fields.getTextInputValue('thumbnail_url').trim();
  const embedUrl = interaction.fields.getTextInputValue('embed_url').trim();
  const footer = interaction.fields.getTextInputValue('footer').trim();
  const footerIconUrl = interaction.fields.getTextInputValue('footer_icon_url').trim();
  if (![mediaUrl, thumbnailUrl, embedUrl, footerIconUrl].every(validUrl)) return interaction.reply({ content: 'One or more URLs are invalid. Use full `https://` or `http://` URLs.', flags: [MessageFlags.Ephemeral] });

  try {
    const embed = new EmbedBuilder().setTitle(draft.title || 'AGENT 001').setDescription(draft.description || '').setColor(draft.color ?? 0xffffff).setTimestamp();
    if (embedUrl) embed.setURL(embedUrl);
    if (mediaUrl) embed.setImage(mediaUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    embed.setFooter({ text: footer || `AGENT 001 • ${interaction.guild.name}`, ...(footerIconUrl ? { iconURL: footerIconUrl } : {}) });
    const payload = { embeds: [embed], components: [] };
    if (embedUrl) payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Link').setStyle(ButtonStyle.Link).setURL(embedUrl))];

    if (draft.mode === 'create') {
      const channel = interaction.guild.channels.cache.get(draft.channelId);
      if (!channel || !channel.isTextBased() || !channel.isSendable?.()) return interaction.reply({ content: 'Target channel is unavailable.', flags: [MessageFlags.Ephemeral] });
      const sent = await channel.send(payload);
      embedDrafts.delete(key);
      return interaction.reply({ content: `✅ Premium embed sent to <#${channel.id}>. Message ID: \`${sent.id}\``, flags: [MessageFlags.Ephemeral] });
    }

    const channel = interaction.guild.channels.cache.get(draft.channelId);
    if (!channel || !channel.isTextBased() || !channel.isSendable?.()) return interaction.reply({ content: 'Target channel is unavailable.', flags: [MessageFlags.Ephemeral] });
    const message = await channel.messages.fetch(draft.messageId);
    if (message.author.id !== client.user.id) return interaction.reply({ content: 'I can only edit embeds sent by AGENT 001.', flags: [MessageFlags.Ephemeral] });
    await message.edit(payload);
    embedDrafts.delete(key);
    return interaction.reply({ content: `✅ Embed updated successfully. [Jump to message](https://discord.com/channels/${interaction.guildId}/${channel.id}/${message.id})`, flags: [MessageFlags.Ephemeral] });
  } catch (error) {
    console.error('[AGENT 001] Embed send/edit error:', error);
    return interaction.reply({ content: 'Failed to send or edit the embed. Check that AGENT 001 can view, send messages, embed links and manage the target message.', flags: [MessageFlags.Ephemeral] });
  }
}

async function handleSelectMenu(interaction) {
  if (!interaction.guildId) return;
  if (!isAdmin(interaction)) return interaction.reply({ content: 'Insufficient permissions. Server Administrator required.', flags: [MessageFlags.Ephemeral] });
  if (!configStore.has(interaction.guildId)) configStore.set(interaction.guildId, {});
  const config = configStore.get(interaction.guildId);
  const value = interaction.values[0];
  if (interaction.customId === 'hydra_select_channel') { config.channelId = value; return interaction.reply({ content: `Verification channel set to <#${value}>.`, flags: [MessageFlags.Ephemeral] }); }
  if (interaction.customId === 'hydra_select_role') { config.roleId = value; return interaction.reply({ content: `Verified role set to <@&${value}>.`, flags: [MessageFlags.Ephemeral] }); }
  if (interaction.customId === 'hydra_select_unverified_role') { config.unverifiedRoleId = value; return interaction.reply({ content: `Quarantine role set to <@&${value}>.`, flags: [MessageFlags.Ephemeral] }); }
  if (interaction.customId === 'hydra_select_security') { config.securityLevel = value; return interaction.reply({ content: `Security level set to \`${value}\`.`, flags: [MessageFlags.Ephemeral] }); }
}

async function handleButton(client, interaction) {
  if (interaction.customId === 'hydra_save_config') return handleSaveConfig(client, interaction);
  if (interaction.customId === 'hydra_verify_button') return handleVerifyButton(client, interaction);
}

async function handleSaveConfig(client, interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: 'Insufficient permissions. Server Administrator required.', flags: [MessageFlags.Ephemeral] });
  const config = configStore.get(interaction.guildId);
  if (!config?.channelId || !config?.roleId || !config?.unverifiedRoleId || !config?.securityLevel) return interaction.reply({ content: 'Configuration incomplete. Please select all four options.', flags: [MessageFlags.Ephemeral] });
  if (config.roleId === config.unverifiedRoleId) return interaction.reply({ content: 'Verified role and quarantine role must be different.', flags: [MessageFlags.Ephemeral] });
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  try {
    const verifiedRole = interaction.guild.roles.cache.get(config.roleId);
    const quarantineRole = interaction.guild.roles.cache.get(config.unverifiedRoleId);
    if (!verifiedRole || verifiedRole.managed || !quarantineRole || quarantineRole.managed) return interaction.editReply({ content: 'One or more selected roles are no longer valid.' });
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(client.user.id).catch(() => null);
    if (botMember && (botMember.roles.highest.position <= verifiedRole.position || botMember.roles.highest.position <= quarantineRole.position)) return interaction.editReply({ content: 'Both selected roles must be below AGENT 001 in Server Settings → Roles.' });
    const current = await getGuildSettings(interaction.guildId);
    await upsertGuildSettings({ guild_id: interaction.guildId, control_channel_id: interaction.channelId, public_verify_channel_id: config.channelId, verified_role_id: config.roleId, unverified_role_id: config.unverifiedRoleId, autorole_id: current?.autorole_id || null, security_level: config.securityLevel });
    const verifyChannel = interaction.guild.channels.cache.get(config.channelId);
    if (!verifyChannel || !verifyChannel.isTextBased() || !verifyChannel.isSendable?.()) return interaction.editReply({ content: 'Error: Target verification channel is not available or not sendable.' });
    const verifyEmbed = new EmbedBuilder().setTitle('ACCESS VERIFICATION REQUIRED').setDescription(`This server is protected by **AGENT 001**.\n\n**Server**\n\`\`\`\n${interaction.guild.name}\n\`\`\`\n\n**How it works**\n1. Click the button below to start\n2. Complete the captcha challenge on the secure page\n3. Return here — your role will be assigned automatically\n\n*Verification expires in 5 minutes.*`).setColor(0xffffff).setThumbnail(interaction.guild.iconURL({ size: 128 })).setFooter({ text: `${interaction.guild.name} | AGENT 001` }).setTimestamp();
    await verifyChannel.send({ embeds: [verifyEmbed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hydra_verify_button').setLabel('Verify My Account').setStyle(ButtonStyle.Primary))] });
    configStore.delete(interaction.guildId);
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('CONFIGURATION SAVED').setDescription(`**Channel:** <#${config.channelId}>\n**Verified Role:** <@&${config.roleId}>\n**Quarantine Role:** <@&${config.unverifiedRoleId}>\n**Security:** \`${config.securityLevel}\``).setColor(0xffffff).setFooter({ text: 'AGENT 001 | System Initialized' })] });
  } catch (error) {
    console.error('[AGENT 001] Save config error:', error);
    return interaction.editReply({ content: 'Failed to save configuration. Check the Wispbyte console for details.' });
  }
}

async function isAlreadyVerified(client, interaction) {
  const settings = await getGuildSettings(interaction.guildId);
  if (!settings?.verified_role_id) return false;
  const guild = client.guilds.cache.get(interaction.guildId);
  if (!guild) return false;
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  return !!member?.roles.cache.has(settings.verified_role_id);
}

async function handleVerifyButton(client, interaction) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  try {
    if (await isAlreadyVerified(client, interaction)) return interaction.editReply({ content: 'Your account is already verified within this server.' });
    const settings = await getGuildSettings(interaction.guildId);
    const internalKey = (process.env.INTERNAL_API_KEY || '').trim();
    let workerUrl = (process.env.HYDRA_WORKER_URL || '').trim().replace(/\/$/, '');
    if (!workerUrl || !internalKey) return interaction.editReply({ content: 'Verification service is not configured.' });
    if (!/^https?:\/\//i.test(workerUrl)) workerUrl = `https://${workerUrl}`;
    const response = await fetch(`${workerUrl}/api/request-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${internalKey}` }, body: JSON.stringify({ user_id: interaction.user.id, guild_id: interaction.guildId, guild_name: interaction.guild.name, security_level: settings?.security_level || 'dual-layer' }) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!response.ok || !data?.verification_url || typeof data.verification_url !== 'string') {
      console.error('[AGENT 001] Worker request failed:', response.status, text.slice(0, 500));
      return interaction.editReply({ content: 'Verification service is temporarily unavailable. Please try again.' });
    }
    const verificationUrl = data.verification_url.trim();
    if (!/^https?:\/\//i.test(verificationUrl)) return interaction.editReply({ content: 'Verification service returned an invalid verification link.' });
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('VERIFICATION CHALLENGE').setDescription('Complete the secure captcha challenge using the button below.\n\n**Link expires in 5 minutes.**').setColor(0xffffff).setFooter({ text: 'AGENT 001 | Secure Verification' })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Verification').setStyle(ButtonStyle.Link).setURL(verificationUrl))] });
  } catch (error) {
    console.error('[AGENT 001] Verification request error:', error);
    return interaction.editReply({ content: 'Unable to start verification. Please try again.' });
  }
}
