const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const rpc = require('../../core/rpc');
const env = require('../../config/env');
const { exchOnly } = require('../../config/permissions');
const demoStore = require('../../core/demoStore');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register as an exchanger and create your wallet')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),

    execute: exchOnly(async (interaction) => {
        let existingUsers;
        if (env.DB_ENABLED) {
            [existingUsers] = await db.query(
                'SELECT id, ltc_deposit_address FROM users WHERE discord_id = ?',
                [interaction.user.id]
            );
        } else {
            const demoUser = demoStore.getUserByDiscordId(interaction.user.id);
            existingUsers = demoUser ? [demoUser] : [];
        }

        if (existingUsers.length > 0 && existingUsers[0].ltc_deposit_address) {
            return interaction.reply({
                content: 'You already have a registered wallet!\nUse `/balance` to check your wallet.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const newAddress = env.DB_ENABLED
                ? await rpc.createNewAddress()
                : `demo-ltc-${String(interaction.user.id).slice(-8)}`;

            if (env.DB_ENABLED) {
                if (existingUsers.length > 0) {
                    await db.query(
                        'UPDATE users SET username = ?, ltc_deposit_address = ? WHERE id = ?',
                        [interaction.user.username, newAddress, existingUsers[0].id]
                    );
                } else {
                    await db.query(
                        `INSERT INTO users (
                            discord_id,
                            username,
                            ltc_deposit_address,
                            balance_available,
                            balance_escrow,
                            total_deposited,
                            total_withdrawn,
                            created_at
                        ) VALUES (?, ?, ?, 0.00000000, 0.00000000, 0.00000000, 0.00000000, NOW())`,
                        [interaction.user.id, interaction.user.username, newAddress]
                    );
                }
            } else {
                demoStore.registerWallet(interaction.user.id, interaction.user.username, newAddress);
            }

            await interaction.editReply({
                content: `**Registration Successful!**\n\n` +
                    `**Your LTC Deposit Address:**\n\`${newAddress}\`\n\n` +
                    `${env.DB_ENABLED ? 'Send LTC to this address to fund your exchanger wallet.' : 'Demo mode: this is a preview wallet address for testing UI flows.'}\n` +
                    `Use \`/balance\` to check your balance.`
            });
        } catch (error) {
            console.error('Registration error:', error);
            await interaction.editReply({
                content: 'Failed to create wallet. Please check if the LTC Node is online.'
            });
        }
    })
};
