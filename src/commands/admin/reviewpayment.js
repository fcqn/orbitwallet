const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { adminOnly } = require('../../config/permissions');
const logger = require('../../core/logger');
const { auditAdminAction } = require('../../core/adminTools');
const { reviewPaymentRequest, syncPaymentRequestMessage, dmPaymentRequestReview } = require('../../core/paymentConfigs');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('reviewpayment')
        .setDescription('Approve or reject a payment config request by request ID')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName('requestid')
                .setDescription('Payment config request ID')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription('Approve or reject the request')
                .setRequired(true)
                .addChoices(
                    { name: 'Approve', value: 'approve' },
                    { name: 'Reject', value: 'reject' }
                )
        )
        .addStringOption((option) =>
            option
                .setName('note')
                .setDescription('Optional admin review note')
                .setRequired(false)
        ),

    execute: adminOnly(async (interaction) => {
        const requestId = interaction.options.getString('requestid').trim().toUpperCase();
        const action = interaction.options.getString('action');
        const note = interaction.options.getString('note')?.trim() || '';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const result = await reviewPaymentRequest({
                requestId,
                reviewerDiscordId: interaction.user.id,
                action,
                note
            });

            if (!result.ok) {
                await interaction.editReply({ content: result.message });
                return;
            }

            await syncPaymentRequestMessage(interaction.client, requestId);
            await dmPaymentRequestReview(interaction.client, requestId);
            await auditAdminAction(
                interaction,
                'reviewpayment',
                `Request: ${requestId}\nAction: ${result.status}${note ? `\nNote: ${note}` : ''}`
            );
            await logger.logPaymentConfig(
                interaction.client,
                `<@${interaction.user.id}> ${result.status.toLowerCase()} payment config request \`${requestId}\`${note ? ` | ${note}` : ''}`
            );

            await interaction.editReply({
                content: `Request \`${requestId}\` ${result.status.toLowerCase()}.`
            });
        } catch (error) {
            console.error('reviewpayment failed:', error);
            await logger.logError(interaction.client, `reviewpayment failed: \`${error.message}\``);
            await interaction.editReply({
                content: `Failed to review payment request: ${error.message}`
            });
        }
    })
};
