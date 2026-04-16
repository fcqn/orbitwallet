const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { auditAdminAction } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('hold')
        .setDescription('Hold/freeze an exchanger wallet')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Exchanger to hold')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('reason')
                .setDescription('Reason for holding')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason').trim();

        try {
            const [rows] = await db.query(
                'SELECT id, is_held, username FROM users WHERE discord_id = ?',
                [target.id]
            );

            if (!rows.length) {
                return interaction.reply({ content: 'User has no wallet.', flags: MessageFlags.Ephemeral });
            }

            const user = rows[0];
            if (Boolean(user.is_held)) {
                return interaction.reply({ content: 'Wallet is already on hold.', flags: MessageFlags.Ephemeral });
            }

            await db.query(
                'UPDATE users SET is_held = TRUE, held_reason = ?, held_by = ?, held_at = NOW() WHERE id = ?',
                [reason, interaction.user.id, user.id]
            );

            await auditAdminAction(
                interaction,
                'hold',
                `Target: ${target.id}\nOrbit ID: ${user.id}\nReason: ${reason}`
            );

            return interaction.reply({
                content: `**${user.username || target.username}**'s wallet has been held.\nReason: ${reason}`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('hold failed:', error);
            return interaction.reply({ content: 'Error holding wallet.', flags: MessageFlags.Ephemeral });
        }
    })
};
