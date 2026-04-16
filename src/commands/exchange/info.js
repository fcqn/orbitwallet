const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const appConfig = require('../../config/appConfig');
const { formatEur } = require('../../core/currency');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('walletinfo')
        .setDescription('Check user wallet and deal stats')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('User to check')
                .setRequired(true)
        ),

    async execute(interaction) {
        const target = interaction.options.getUser('user');

        try {
            const [rows] = await db.query(
                `SELECT
                    u.id,
                    u.username,
                    u.ltc_deposit_address,
                    u.balance_available,
                    u.balance_escrow,
                    u.total_deposited,
                    u.total_withdrawn,
                    COALESCE(es.total_deals, 0) AS total_deals,
                    COALESCE(es.completed_deals, 0) AS completed_deals,
                    COALESCE(es.total_volume_eur, 0) AS total_volume_eur,
                    COALESCE(cs.client_deals, 0) AS client_deals,
                    COALESCE(cs.client_net_value, 0) AS client_net_value
                 FROM users u
                 LEFT JOIN exchanger_stats es ON u.id = es.user_id
                 LEFT JOIN (
                    SELECT
                        buyer_id,
                        COUNT(*) AS client_deals,
                        COALESCE(SUM(amount_usd), 0) AS client_net_value
                    FROM tickets
                    WHERE status = 'RELEASED'
                    GROUP BY buyer_id
                 ) cs ON u.id = cs.buyer_id
                 WHERE u.discord_id = ?`,
                [target.id]
            );

            if (rows.length === 0) {
                return interaction.reply({
                    content: 'User is not registered in the database.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const u = rows[0];

            const embed = new EmbedBuilder()
                .setTitle(`Orbit Trade | ${u.username}`)
                .setDescription('> Wallet balances, exchanger performance, and client-side value totals.')
                .setColor(appConfig.brand.color)
                .addFields(
                    { name: 'LTC Address', value: `\`${u.ltc_deposit_address}\``, inline: false },
                    { name: 'Available', value: `${parseFloat(u.balance_available).toFixed(8)} LTC`, inline: true },
                    { name: 'Escrow', value: `${parseFloat(u.balance_escrow).toFixed(8)} LTC`, inline: true },
                    { name: 'Exchanger Deals', value: `${u.total_deals}`, inline: true },
                    { name: 'Exchanger Completed', value: `${u.completed_deals}`, inline: true },
                    { name: 'Exchanger Net Value', value: formatEur(parseFloat(u.total_volume_eur || 0)), inline: true },
                    { name: 'Client Deals', value: `${u.client_deals}`, inline: true },
                    { name: 'Client Net Value', value: formatEur(parseFloat(u.client_net_value || 0)), inline: true },
                    { name: 'Total Deposited', value: `${parseFloat(u.total_deposited).toFixed(8)} LTC`, inline: true },
                    { name: 'Total Withdrawn', value: `${parseFloat(u.total_withdrawn).toFixed(8)} LTC`, inline: true }
                )
                .setFooter({ text: `Orbit ID: ${u.id}` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Wallet info error:', error);
            const errorMsg = error.message.includes('Unknown column')
                ? 'Database schema mismatch. Check your columns.'
                : 'Error fetching info.';

            await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
        }
    }
};
