const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { sendLtc } = require('../../core/walletOps');
const logger = require('../../core/logger');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('ocw')
        .setDescription('Admin: withdraw all pending owner LTC commission')
        .setDefaultMemberPermissions('0')
        .addStringOption((option) =>
            option.setName('address').setDescription('Destination LTC address').setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const address = interaction.options.getString('address').trim();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const [pendingRows] = await db.query(
                `SELECT id, user_id, owner_commission_amount
                 FROM owner_commission_ledger
                 WHERE status = 'PENDING' AND currency_code = 'LTC'
                 ORDER BY created_at ASC`
            );

            if (!pendingRows.length) {
                return interaction.editReply('No pending LTC owner commission is available to withdraw.');
            }

            const total = pendingRows
                .reduce((sum, row) => sum + parseFloat(row.owner_commission_amount || 0), 0)
                .toFixed(8);

            const { txid } = await sendLtc({
                destination: address,
                amount: total
            });

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                const balanceByUser = new Map();
                for (const row of pendingRows) {
                    const current = balanceByUser.get(row.user_id) || 0;
                    balanceByUser.set(row.user_id, current + parseFloat(row.owner_commission_amount || 0));
                }

                for (const [userId, amount] of balanceByUser.entries()) {
                    await connection.query(
                        `UPDATE exchanger_owner_balances
                         SET hidden_owner_balance = GREATEST(hidden_owner_balance - ?, 0),
                             last_withdrawn_at = NOW(),
                             updated_at = NOW()
                         WHERE user_id = ? AND currency_code = 'LTC'`,
                        [amount.toFixed(8), userId]
                    );
                }

                await connection.query(
                    `UPDATE owner_commission_ledger
                     SET status = 'TRANSFERRED',
                         transferred_at = NOW()
                     WHERE status = 'PENDING' AND currency_code = 'LTC'`
                );

                await connection.commit();
            } catch (dbError) {
                await connection.rollback();
                throw new Error(`Commission withdrawal broadcast succeeded (txid: ${txid}) but database sync failed: ${dbError.message}`);
            } finally {
                connection.release();
            }

            await interaction.editReply(`Owner commission withdrawn: \`${total}\` LTC\nTXID: \`${txid}\``);
            await logger.logTransaction(
                interaction.client,
                `OWNER_COMMISSION_WITHDRAWAL | admin <@${interaction.user.id}> | ${total} LTC | tx \`${txid}\``
            );
        } catch (error) {
            console.error('ownercommissionwithdraw failed:', error);
            await logger.logError(interaction.client, `ownercommissionwithdraw failed: \`${error.message}\``);
            await interaction.editReply(`Owner commission withdrawal failed: ${error.message}`);
        }
    })
};
