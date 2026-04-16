const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const { exchOnly } = require('../../config/permissions');
const logger = require('../../core/logger');
const {
    PAYMENT_METHOD_CHOICES,
    createPaymentRequestId,
    buildPaymentRequestEmbed,
    buildPaymentRequestActionRow,
    formatMethodName
} = require('../../core/paymentConfigs');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('deletepayment')
        .setDescription('Request removal of an approved payment config')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel)
        .addStringOption((option) =>
            option
                .setName('method')
                .setDescription('Payment method to remove')
                .setRequired(true)
                .addChoices(...PAYMENT_METHOD_CHOICES)
        ),

    execute: exchOnly(async (interaction) => {
        const method = interaction.options.getString('method');

        try {
            const [users] = await db.query('SELECT id FROM users WHERE discord_id = ?', [interaction.user.id]);
            if (!users.length) {
                return interaction.reply({
                    content: 'Create/register a wallet first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const userId = users[0].id;
            const [configRows] = await db.query(
                'SELECT payment_details FROM exchanger_payment_configs WHERE user_id = ? AND method_key = ? LIMIT 1',
                [userId, method]
            );
            if (!configRows.length) {
                return interaction.reply({
                    content: `No approved ${formatMethodName(method)} payment config was found.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const [pendingRows] = await db.query(
                'SELECT request_id FROM payment_config_requests WHERE user_id = ? AND method_key = ? AND status = "PENDING" LIMIT 1',
                [userId, method]
            );
            if (pendingRows.length) {
                return interaction.reply({
                    content: `You already have a pending request for ${formatMethodName(method)}: \`${pendingRows[0].request_id}\``,
                    flags: MessageFlags.Ephemeral
                });
            }

            const requestId = createPaymentRequestId();
            await db.query(
                `INSERT INTO payment_config_requests (request_id, user_id, method_key, payment_details, request_action, status)
                 VALUES (?, ?, ?, ?, 'DELETE', 'PENDING')`,
                [requestId, userId, method, configRows[0].payment_details]
            );

            const request = {
                request_id: requestId,
                method_key: method,
                payment_details: configRows[0].payment_details,
                request_action: 'DELETE',
                status: 'PENDING',
                discord_id: interaction.user.id,
                requested_at: new Date().toISOString()
            };

            const logMessage = await logger.postPaymentConfig(interaction.client, {
                embeds: [buildPaymentRequestEmbed(request)],
                components: [buildPaymentRequestActionRow(requestId)]
            });

            if (logMessage?.id) {
                await db.query(
                    'UPDATE payment_config_requests SET log_message_id = ? WHERE request_id = ?',
                    [logMessage.id, requestId]
                );
            }

            await interaction.reply({
                content: `Delete request submitted for **${formatMethodName(method)}**.\nRequest ID: \`${requestId}\``,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('deletepayment failed:', error);
            await interaction.reply({
                content: 'Failed to submit delete request.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    })
};
