const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { auditAdminAction } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('unhold')
        .setDescription('Release a hold on an exchanger wallet')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Exchanger to unhold')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('note')
                .setDescription('Release note')
                .setRequired(false)
        ),

    execute: adminOnly(async (interaction) => {
        const target = interaction.options.getUser('user');
        const note = interaction.options.getString('note')?.trim() || 'No note provided';

        try {
            const [rows] = await db.query(
                'SELECT id, is_held, username, held_reason FROM users WHERE discord_id = ?',
                [target.id]
            );

            if (!rows.length) {
                return interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
            }

            const user = rows[0];
            if (!Boolean(user.is_held)) {
                return interaction.reply({ content: 'Wallet is not on hold.', flags: MessageFlags.Ephemeral });
            }

            await db.query(
                'UPDATE users SET is_held = FALSE, held_reason = NULL, held_by = NULL, held_at = NULL WHERE id = ?',
                [user.id]
            );

            await auditAdminAction(
                interaction,
                'unhold',
                `Target: ${target.id}\nOrbit ID: ${user.id}\nPrevious reason: ${user.held_reason || 'n/a'}\nNote: ${note}`
            );

            return interaction.reply({
                content:
                    `**${user.username || target.username}**'s wallet has been released.\n` +
                    `Previous reason: ${user.held_reason || 'n/a'}\n` +
                    `Note: ${note}`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('unhold failed:', error);
            return interaction.reply({ content: 'Error releasing hold.', flags: MessageFlags.Ephemeral });
        }
    })
};
