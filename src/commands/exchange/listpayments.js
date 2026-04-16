const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../core/database');
const { exchOnly } = require('../../config/permissions');
const appConfig = require('../../config/appConfig');
const {
    listApprovedPaymentConfigs,
    listPendingPaymentRequests,
    formatMethodName
} = require('../../core/paymentConfigs');

function trimBlock(text, limit = 180) {
    const value = String(text || '').trim();
    if (value.length <= limit) return value || 'n/a';
    return `${value.slice(0, limit - 3)}...`;
}

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('listpayments')
        .setDescription('View your approved payment configs and pending payment requests')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),

    execute: exchOnly(async (interaction) => {
        try {
            const [users] = await db.query('SELECT id FROM users WHERE discord_id = ?', [interaction.user.id]);
            if (!users.length) {
                return interaction.reply({
                    content: 'Create/register a wallet first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const userId = users[0].id;
            const [approvedConfigs, pendingRequests] = await Promise.all([
                listApprovedPaymentConfigs(userId),
                listPendingPaymentRequests(userId)
            ]);

            const approvedText = approvedConfigs.length
                ? approvedConfigs
                    .map((row) => `**${formatMethodName(row.method_key)}**\n${trimBlock(row.payment_details)}`)
                    .join('\n\n')
                : 'No approved payment configs.';

            const pendingText = pendingRequests.length
                ? pendingRequests
                    .map((row) => `\`${row.request_id}\` | **${formatMethodName(row.method_key)}** | ${row.request_action}`)
                    .join('\n')
                : 'No pending requests.';

            const embed = new EmbedBuilder()
                .setTitle(`Orbit Trade | ${interaction.user.username} Payment Configs`)
                .setColor(appConfig.brand.color)
                .addFields(
                    { name: 'Approved Configs', value: approvedText, inline: false },
                    { name: 'Pending Requests', value: pendingText, inline: false }
                )
                .setFooter({ text: appConfig.brand.name })
                .setTimestamp();

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('listpayments failed:', error);
            return interaction.reply({
                content: 'Failed to load payment configs.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    })
};
