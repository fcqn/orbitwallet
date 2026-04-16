const { MessageFlags } = require('discord.js');
const logger = require('../core/logger');
const { reviewPaymentRequest, syncPaymentRequestMessage, dmPaymentRequestReview } = require('../core/paymentConfigs');
const { hasAdmin } = require('../config/permissions');

module.exports = {
    customId: 'paymentcfgreview',

    async execute(interaction) {
        const isAdminUser = hasAdmin(interaction.member);
        if (!isAdminUser) {
            return interaction.reply({
                content: 'Only administrators can review payment config requests.',
                flags: MessageFlags.Ephemeral
            });
        }

        const isApprove = interaction.customId.startsWith('paymentcfgapprove_');
        const requestId = interaction.customId.replace(isApprove ? 'paymentcfgapprove_' : 'paymentcfgreject_', '');
        const action = isApprove ? 'approve' : 'reject';

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const result = await reviewPaymentRequest({
                requestId,
                reviewerDiscordId: interaction.user.id,
                action
            });

            if (!result.ok) {
                return interaction.editReply({ content: result.message });
            }

            await syncPaymentRequestMessage(interaction.client, requestId);
            await dmPaymentRequestReview(interaction.client, requestId);
            await logger.logPaymentConfig(
                interaction.client,
                `<@${interaction.user.id}> ${result.status.toLowerCase()} payment config request \`${requestId}\` via button`
            );

            return interaction.editReply({
                content: `Request \`${requestId}\` ${result.status.toLowerCase()}.`
            });
        } catch (error) {
            console.error('payment config review button failed:', error);
            await logger.logError(interaction.client, `payment config review button failed: \`${error.message}\``);
            return interaction.editReply({
                content: 'Failed to review payment config request.'
            }).catch(() => {});
        }
    }
};
