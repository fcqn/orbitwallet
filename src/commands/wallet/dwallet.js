const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../core/database');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('deletewallet')
        .setDescription('Delete a user wallet (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('User to delete wallet for')
                .setRequired(true)
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [users] = await connection.query(
                'SELECT * FROM users WHERE discord_id = ? FOR UPDATE',
                [targetUser.id]
            );

            if (users.length === 0) {
                await connection.rollback();
                return interaction.editReply({
                    content: `No wallet found for ${targetUser.username}.`
                });
            }

            const user = users[0];
            const available = parseFloat(user.balance_available || 0);
            const escrow = parseFloat(user.balance_escrow || 0);

            if (available > 0 || escrow > 0) {
                await connection.rollback();
                return interaction.editReply({
                    content:
                        `Cannot delete wallet.\n\n` +
                        `**${targetUser.username}** still has funds:\n` +
                        `- Available: ${available.toFixed(8)} LTC\n` +
                        `- Escrow: ${escrow.toFixed(8)} LTC\n\n` +
                        `The wallet must be emptied before deletion.`
                });
            }

            const [pendingTickets] = await connection.query(
                `SELECT COUNT(*) AS count
                 FROM tickets
                 WHERE (buyer_id = ? OR seller_id = ?)
                 AND status IN ('OPEN', 'CLAIMED', 'PAID', 'DISPUTED')`,
                [user.id, user.id]
            );

            if (Number(pendingTickets[0]?.count || 0) > 0) {
                await connection.rollback();
                return interaction.editReply({
                    content:
                        `Cannot delete wallet.\n` +
                        `**${targetUser.username}** still has ${pendingTickets[0].count} active ticket(s).\n` +
                        `Close those tickets before deletion.`
                });
            }

            const [historicalTickets] = await connection.query(
                `SELECT COUNT(*) AS count
                 FROM tickets
                 WHERE buyer_id = ? OR seller_id = ?`,
                [user.id, user.id]
            );

            if (Number(historicalTickets[0]?.count || 0) > 0) {
                await connection.rollback();
                return interaction.editReply({
                    content:
                        `Cannot delete wallet.\n` +
                        `**${targetUser.username}** is still linked to ${historicalTickets[0].count} ticket record(s).\n` +
                        `Use \`/purgeuser\` if you want to fully erase their database history.`
                });
            }

            await connection.query('DELETE FROM exchanger_owner_balances WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM exchanger_payment_configs WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM payment_config_requests WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM exchanger_payment_terms WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM exchanger_stats WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM owner_commission_ledger WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM pending_claim_confirmations WHERE seller_id = ?', [user.id]);
            await connection.query('DELETE FROM wallet_ledger WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM pending_deposits WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM withdrawal_queue WHERE user_id = ?', [user.id]);
            await connection.query('DELETE FROM users WHERE id = ?', [user.id]);

            await connection.commit();

            await interaction.editReply({
                content:
                    `Wallet deleted successfully.\n\n` +
                    `User: ${targetUser.username}\n` +
                    `Address: \`${user.ltc_deposit_address || 'No address'}\`\n\n` +
                    `All wallet-linked rows were removed.`
            });
        } catch (error) {
            await connection.rollback().catch(() => {});
            console.error('deletewallet failed:', error);
            await interaction.editReply({
                content: `Failed to delete wallet: ${error.message}`
            });
        } finally {
            connection.release();
        }
    }
};
