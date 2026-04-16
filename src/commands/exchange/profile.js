const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const env = require('../../config/env');
const { exchOnly } = require('../../config/permissions');
const appConfig = require('../../config/appConfig');
const { formatEur } = require('../../core/currency');
const demoStore = require('../../core/demoStore');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your exchanger profile and stats')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),

    execute: exchOnly(async (interaction) => {
        try {
            let rows;
            if (env.DB_ENABLED) {
                [rows] = await db.query(
                    `SELECT
                        u.id,
                        u.balance_available,
                        u.balance_escrow,
                        u.total_deposited,
                        u.total_withdrawn,
                        COALESCE(es.total_deals, 0) as total_deals,
                        COALESCE(es.completed_deals, 0) as completed_deals,
                        COALESCE(es.disputed_deals, 0) as disputed_deals,
                        COALESCE(es.total_volume_ltc, 0) as total_volume_ltc,
                        COALESCE(es.total_volume_eur, 0) as total_volume_eur
                     FROM users u
                     LEFT JOIN exchanger_stats es ON es.user_id = u.id
                     WHERE u.discord_id = ?`,
                    [interaction.user.id]
                );
            } else {
                const demoUser = demoStore.ensureUser(interaction.user.id, interaction.user.username);
                rows = demoUser ? [demoUser] : [];
            }

            if (!rows.length) {
                return interaction.reply({
                    content: 'No exchanger wallet found. Use `/register` first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const p = rows[0];
            const available = `${parseFloat(p.balance_available).toFixed(8)} LTC`;
            const escrow = `${parseFloat(p.balance_escrow).toFixed(8)} LTC`;
            const totalValue = formatEur(parseFloat(p.total_volume_eur || 0));
            const lifetimeLtc = `${parseFloat(p.total_volume_ltc).toFixed(8)} LTC`;
            const totalDeals = `${p.total_deals}`;
            const completedDeals = `${p.completed_deals}`;
            const disputedDeals = `${p.disputed_deals}`;
            const completionRate = p.total_deals > 0
                ? `${((Number(p.completed_deals) / Number(p.total_deals)) * 100).toFixed(1)}%`
                : '0.0%';

            const embed = new EmbedBuilder()
                .setTitle(`Orbit Trade | ${interaction.user.username}`)
                .setDescription(
                    [
                        '`WALLET`',
                        `> Available: **${available}**`,
                        `> Escrow: **${escrow}**`,
                        '',
                        '`PERFORMANCE`',
                        `> Net Value: **${totalValue}**`,
                        `> Lifetime LTC: **${lifetimeLtc}**`,
                        `> Completion Rate: **${completionRate}**`,
                        '',
                        '`DEALS`',
                        `> Total: **${totalDeals}**`,
                        `> Completed: **${completedDeals}**`,
                        `> Disputed: **${disputedDeals}**`
                    ].join('\n')
                )
                .setColor(appConfig.brand.color)
                .addFields(
                    { name: 'Balance', value: `Available\n**${available}**`, inline: true },
                    { name: 'Locked', value: `Escrow\n**${escrow}**`, inline: true },
                    { name: 'Volume', value: `${totalValue}\n${lifetimeLtc}`, inline: true }
                )
                .setFooter({ text: `${env.DB_ENABLED ? 'Orbit' : 'Orbit Demo'} Exchanger ID: ${p.id}` })
                .setTimestamp();

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('profile command failed:', error);
            return interaction.reply({
                content: 'Failed to fetch profile.',
                flags: MessageFlags.Ephemeral
            });
        }
    })
};
