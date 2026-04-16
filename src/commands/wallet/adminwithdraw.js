const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { sendLtc } = require('../../core/walletOps');
const logger = require('../../core/logger');
const {
    reserveWithdrawal,
    completeWithdrawal,
    failWithdrawal
} = require('../../core/payoutSafety');
const { auditAdminAction } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('adminwithdraw')
        .setDescription('Admin: withdraw from any exchanger wallet ledger identity')
        .setDefaultMemberPermissions('0')
        .addUserOption((option) =>
            option.setName('user').setDescription('Exchanger user').setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('address').setDescription('Destination LTC address').setRequired(true)
        )
        .addNumberOption((option) =>
            option.setName('amount').setDescription('Amount LTC').setRequired(true).setMinValue(0.001)
        ),

    execute: adminOnly(async (interaction) => {
        const targetUser = interaction.options.getUser('user');
        const address = interaction.options.getString('address').trim();
        const amount = interaction.options.getNumber('amount');
        const fee = 0.0001;
        const total = amount + fee;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const [rows] = await db.query(
                'SELECT id, balance_available FROM users WHERE discord_id = ?',
                [targetUser.id]
            );
            if (!rows.length) {
                return interaction.editReply('Target exchanger wallet not found.');
            }
            const user = rows[0];
            if (parseFloat(user.balance_available) < total) {
                return interaction.editReply('Insufficient target wallet balance.');
            }

            const reservation = await reserveWithdrawal({
                userId: user.id,
                amountLtc: amount,
                feeLtc: fee,
                toAddress: address,
                processedBy: interaction.user.id,
                requestKey: `adminwithdraw:${interaction.id}`,
                enforceCooldown: false
            });

            try {
                const { txid } = await sendLtc({
                    destination: address,
                    amount
                });

                await completeWithdrawal({
                    reservationId: reservation.reservationId,
                    txid,
                    actionType: 'WITHDRAWAL'
                });

                await interaction.editReply(`Admin withdrawal sent. txid: \`${txid}\``);
                await logger.logWithdraw(
                    interaction.client,
                    `ADMIN WITHDRAW | admin <@${interaction.user.id}> | source <@${targetUser.id}> | ${amount.toFixed(8)} LTC | tx \`${txid}\``
                );
                await auditAdminAction(
                    interaction,
                    'adminwithdraw',
                    `Source: ${targetUser.id}\nAmount: ${amount.toFixed(8)} LTC\nAddress: ${address}\nTXID: ${txid}`
                );
                await logger.logTransaction(
                    interaction.client,
                    `ADMIN_WITHDRAWAL | source <@${targetUser.id}> | ${amount.toFixed(8)} LTC | tx \`${txid}\``
                );
            } catch (sendError) {
                await failWithdrawal({ reservationId: reservation.reservationId }).catch(() => {});
                throw sendError;
            }
        } catch (error) {
            console.error('adminwithdraw failed:', error);
            await logger.logError(interaction.client, `adminwithdraw failed: \`${error.message}\``);
            await interaction.editReply(`Admin withdrawal failed: ${error.message}`);
        }
    })
};
