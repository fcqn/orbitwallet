const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { requireExactConfirmation, auditAdminAction } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('transferprofile')
        .setDescription('Transfer an exchanger profile and wallet identity to another Discord account')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('from')
                .setDescription('Current Discord account that owns the exchanger profile')
                .setRequired(true)
        )
        .addUserOption((option) =>
            option.setName('to')
                .setDescription('New Discord account that should receive the exchanger profile')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('confirm')
                .setDescription('Type TRANSFER to confirm')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const fromUser = interaction.options.getUser('from');
        const toUser = interaction.options.getUser('to');
        const confirmation = interaction.options.getString('confirm').trim();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!(await requireExactConfirmation(interaction, confirmation, 'TRANSFER', 'Transfer profile'))) {
            return;
        }

        if (fromUser.id === toUser.id) {
            await interaction.editReply('Transfer cancelled. The source and target accounts are the same.');
            return;
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [sourceRows] = await connection.query(
                'SELECT id, discord_id, username, ltc_deposit_address, balance_available, balance_escrow FROM users WHERE discord_id = ? FOR UPDATE',
                [fromUser.id]
            );

            if (!sourceRows.length) {
                await connection.rollback();
                await interaction.editReply('No exchanger profile was found for the source account.');
                return;
            }

            const sourceProfile = sourceRows[0];

            const [targetRows] = await connection.query(
                'SELECT id, discord_id, username, ltc_deposit_address, balance_available, balance_escrow, total_deposited, total_withdrawn FROM users WHERE discord_id = ? FOR UPDATE',
                [toUser.id]
            );

            if (targetRows.length > 0) {
                const targetProfile = targetRows[0];
                const [linkCounts] = await connection.query(
                    `SELECT
                        (SELECT COUNT(*) FROM tickets WHERE buyer_id = ? OR seller_id = ?) AS ticket_count,
                        (SELECT COUNT(*) FROM wallet_ledger WHERE user_id = ?) AS wallet_ledger_count,
                        (SELECT COUNT(*) FROM pending_deposits WHERE user_id = ?) AS pending_deposit_count,
                        (SELECT COUNT(*) FROM withdrawal_queue WHERE user_id = ?) AS withdrawal_count,
                        (SELECT COUNT(*) FROM exchanger_stats WHERE user_id = ?) AS stats_count,
                        (SELECT COUNT(*) FROM exchanger_payment_terms WHERE user_id = ?) AS terms_count,
                        (SELECT COUNT(*) FROM exchanger_owner_balances WHERE user_id = ?) AS owner_balance_count,
                        (SELECT COUNT(*) FROM exchanger_payment_configs WHERE user_id = ?) AS payment_config_count,
                        (SELECT COUNT(*) FROM payment_config_requests WHERE user_id = ?) AS payment_request_count`,
                    [
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id,
                        targetProfile.id
                    ]
                );
                const usage = linkCounts[0];
                const hasBalances =
                    parseFloat(targetProfile.balance_available || 0) > 0 ||
                    parseFloat(targetProfile.balance_escrow || 0) > 0 ||
                    parseFloat(targetProfile.total_deposited || 0) > 0 ||
                    parseFloat(targetProfile.total_withdrawn || 0) > 0;
                const hasLinks =
                    Number(usage.ticket_count || 0) > 0 ||
                    Number(usage.wallet_ledger_count || 0) > 0 ||
                    Number(usage.pending_deposit_count || 0) > 0 ||
                    Number(usage.withdrawal_count || 0) > 0 ||
                    Number(usage.stats_count || 0) > 0 ||
                    Number(usage.terms_count || 0) > 0 ||
                    Number(usage.owner_balance_count || 0) > 0 ||
                    Number(usage.payment_config_count || 0) > 0 ||
                    Number(usage.payment_request_count || 0) > 0;

                if (hasBalances || hasLinks || targetProfile.ltc_deposit_address) {
                    await connection.rollback();
                    await interaction.editReply(
                        `Transfer cancelled. ${toUser.username} already has a non-empty profile row in the database.`
                    );
                    return;
                }

                await connection.query('DELETE FROM users WHERE id = ?', [targetProfile.id]);
            }

            await connection.query(
                'UPDATE users SET discord_id = ?, username = ? WHERE id = ?',
                [toUser.id, toUser.username, sourceProfile.id]
            );

            await connection.query(
                'UPDATE ticket_temp_data SET user_id = ? WHERE user_id = ?',
                [toUser.id, fromUser.id]
            );

            await connection.commit();

            await auditAdminAction(
                interaction,
                'transferprofile',
                `Orbit ID: ${sourceProfile.id}\nFrom: ${fromUser.id}\nTo: ${toUser.id}`
            );

            await interaction.editReply(
                `Profile transferred successfully.\n\n` +
                `Orbit ID: **${sourceProfile.id}**\n` +
                `From: <@${fromUser.id}> (\`${fromUser.id}\`)\n` +
                `To: <@${toUser.id}> (\`${toUser.id}\`)\n` +
                `Wallet address: \`${sourceProfile.ltc_deposit_address || 'No address'}\`\n` +
                `Available: **${parseFloat(sourceProfile.balance_available || 0).toFixed(8)} LTC**\n` +
                `Escrow: **${parseFloat(sourceProfile.balance_escrow || 0).toFixed(8)} LTC**\n\n` +
                `The same internal profile, balances, stats, terms, and ticket links were preserved.`
            );
        } catch (error) {
            await connection.rollback().catch(() => {});
            console.error('transferprofile failed:', error);
            await interaction.editReply(`Transfer failed: ${error.message}`);
        } finally {
            connection.release();
        }
    })
};
