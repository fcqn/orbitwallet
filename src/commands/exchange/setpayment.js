const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const { exchOnly } = require('../../config/permissions');
const logger = require('../../core/logger');
const {
    PAYMENT_METHOD_CHOICES,
    createPaymentRequestId,
    buildPaymentRequestEmbed,
    buildPaymentRequestActionRow
} = require('../../core/paymentConfigs');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('setpayment')
        .setDescription('Request a payment method or payment details update for admin approval')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel)
        .addStringOption((option) =>
            option
                .setName('method')
                .setDescription('Payment method to configure')
                .setRequired(true)
                .addChoices(...PAYMENT_METHOD_CHOICES)
        )
        .addStringOption((option) =>
            option
                .setName('details')
                .setDescription('The payment details to send to buyers after claim lock')
                .setRequired(true)
        ),

    execute: exchOnly(async (interaction) => {
        const method = interaction.options.getString('method');
        const details = interaction.options.getString('details').trim();

        if (details.length < 5 || details.length > 1500) {
            return interaction.reply({
                content: 'Payment details must be between 5 and 1500 characters.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const [users] = await db.query('SELECT id FROM users WHERE discord_id = ?', [interaction.user.id]);
            if (!users.length) {
                return interaction.reply({
                    content: 'Create/register a wallet first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const userId = users[0].id;
            const [pendingRows] = await db.query(
                'SELECT request_id FROM payment_config_requests WHERE user_id = ? AND method_key = ? AND status = "PENDING" LIMIT 1',
                [userId, method]
            );
            if (pendingRows.length) {
                return interaction.reply({
                    content: `You already have a pending request for ${method.toUpperCase()}: \`${pendingRows[0].request_id}\``,
                    flags: MessageFlags.Ephemeral
                });
            }

            const requestId = createPaymentRequestId();
            await db.query(
                `INSERT INTO payment_config_requests (request_id, user_id, method_key, payment_details, request_action, status)
                 VALUES (?, ?, ?, ?, 'UPSERT', 'PENDING')`,
                [requestId, userId, method, details]
            );

            const request = {
                request_id: requestId,
                method_key: method,
                payment_details: details,
                request_action: 'UPSERT',
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
                content: `Payment config request submitted for **${method.toUpperCase()}**.\nRequest ID: \`${requestId}\`\nAn admin must approve it before buyers will receive these payment details.`,
                flags: MessageFlags.Ephemeral
            });

            await logger.logPaymentConfig(
                interaction.client,
                `<@${interaction.user.id}> requested payment config approval for **${method.toUpperCase()}** | request \`${requestId}\``
            );
        } catch (error) {
            console.error('setpayment failed:', error);
            await logger.logError(interaction.client, `setpayment failed: \`${error.message}\``);
            await interaction.reply({
                content: 'Failed to submit payment config request.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    })
};
