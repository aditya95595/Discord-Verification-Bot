import 'dotenv/config';
import { REST, Routes } from 'discord.js';

export const commands = [
  {
    name: 'panel',
    description: 'Open the AGENT 001 configuration panel',
  },
  {
    name: 'setup',
    description: 'Quick setup: set channel, roles, and security level',
    options: [
      { name: 'channel', description: 'Verification channel', type: 7, required: true },
      { name: 'verified_role', description: 'Role assigned after verification', type: 8, required: true },
      { name: 'quarantine_role', description: 'Role for unverified members', type: 8, required: true },
      { name: 'security', description: 'Security level', type: 3, required: true, choices: [
        { name: 'Image Captcha', value: 'image-captcha' },
        { name: 'hCaptcha', value: 'hcaptcha' },
        { name: 'Dual-Layer (Recommended)', value: 'dual-layer' },
      ] },
    ],
  },
  {
    name: 'autorole',
    description: 'Set the role automatically assigned to new members',
    options: [
      { name: 'role', description: 'Role to assign automatically on join', type: 8, required: true },
    ],
  },
];

export async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  console.log('[AGENT 001] Registering slash commands...');
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
  console.log('[AGENT 001] Slash commands registered successfully.');
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  registerSlashCommands().catch((error) => {
    console.error('[AGENT 001] Failed to register commands:', error);
    process.exitCode = 1;
  });
}
