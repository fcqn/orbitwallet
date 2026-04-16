const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { requireExactConfirmation, auditAdminAction } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('purgeuser')
        .setDescription('Permanently delete all database records for a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('User to purge from the database')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('confirm')
                .setDescription('Type DELETE to confirm the purge')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const targetUser = interaction.options.getUser('user');
        const confirmation = interaction.options.getString('confirm').trim();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!(await requireExactConfirmation(interaction, confirmation, 'DELETE', 'Purge'))) {
            return;
        }

        const connection = await db.getConnection();

        try {
            const [tableRows] = await connection.query(
                `SELECT TABLE_NAME
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE()`
            );
            const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));

            const [users] = await connection.query(
                'SELECT id, username, discord_id FROM users WHERE discord_id = ? LIMIT 1',
                [targetUser.id]
            );

            if (!users.length) {
                await interaction.editReply('No database user record was found for that Discord account.');
                return;
            }

            const user = users[0];

            const [ticketRows] = await connection.query(
                'SELECT ticket_id FROM tickets WHERE buyer_id = ? OR seller_id = ?',
                [user.id, user.id]
            );

            const ticketIds = ticketRows.map((row) => row.ticket_id);
            const placeholders = ticketIds.map(() => '?').join(', ');
            const deletedCounts = {};

            const deleteAndTrack = async (label, sql, params) => {
                const [result] = await connection.query(sql, params);
                deletedCounts[label] = result.affectedRows || 0;
            };

            const deleteIfTableExists = async (tableName, label, sql, params) => {
                if (!existingTables.has(tableName)) {
                    deletedCounts[label] = 0;
                    return;
                }

                await deleteAndTrack(label, sql, params);
            };

            await connection.beginTransaction();

            if (ticketIds.length > 0) {
                await deleteIfTableExists(
                    'release_confirmations',
                    'release_confirmations',
                    `DELETE FROM release_confirmations WHERE ticket_id IN (${placeholders})`,
                    ticketIds
                );
                await deleteIfTableExists(
                    'pending_claim_confirmations',
                    'pending_claim_confirmations_by_ticket',
                    `DELETE FROM pending_claim_confirmations WHERE ticket_id IN (${placeholders})`,
                    ticketIds
                );
                await deleteIfTableExists(
                    'release_jobs',
                    'release_jobs',
                    `DELETE FROM release_jobs WHERE ticket_id IN (${placeholders})`,
                    ticketIds
                );
                await deleteIfTableExists(
                    'owner_commission_ledger',
                    'owner_commission_ledger',
                    `DELETE FROM owner_commission_ledger WHERE ticket_id IN (${placeholders})`,
                    ticketIds
                );
                await deleteIfTableExists(
                    'tickets',
                    'tickets',
                    `DELETE FROM tickets WHERE ticket_id IN (${placeholders})`,
                    ticketIds
                );
            }

            await deleteIfTableExists(
                'pending_claim_confirmations',
                'pending_claim_confirmations_by_seller',
                'DELETE FROM pending_claim_confirmations WHERE seller_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'exchanger_owner_balances',
                'exchanger_owner_balances',
                'DELETE FROM exchanger_owner_balances WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'exchanger_payment_configs',
                'exchanger_payment_configs',
                'DELETE FROM exchanger_payment_configs WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'payment_config_requests',
                'payment_config_requests',
                'DELETE FROM payment_config_requests WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'exchanger_payment_terms',
                'exchanger_payment_terms',
                'DELETE FROM exchanger_payment_terms WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'exchanger_stats',
                'exchanger_stats',
                'DELETE FROM exchanger_stats WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'withdrawal_queue',
                'withdrawal_queue',
                'DELETE FROM withdrawal_queue WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'pending_deposits',
                'pending_deposits',
                'DELETE FROM pending_deposits WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'wallet_ledger',
                'wallet_ledger',
                'DELETE FROM wallet_ledger WHERE user_id = ?',
                [user.id]
            );
            await deleteIfTableExists(
                'ticket_temp_data',
                'ticket_temp_data',
                'DELETE FROM ticket_temp_data WHERE user_id = ?',
                [user.discord_id]
            );
            await deleteIfTableExists(
                'admins',
                'admins',
                'DELETE FROM admins WHERE discord_id = ?',
                [user.discord_id]
            );
            await deleteIfTableExists(
                'users',
                'users',
                'DELETE FROM users WHERE id = ?',
                [user.id]
            );

            await connection.commit();

            await auditAdminAction(
                interaction,
                'purgeuser',
                `User: ${user.discord_id}\nOrbit ID: ${user.id}\nTickets removed: ${ticketIds.length}`
            );

            const summary = Object.entries(deletedCounts)
                .filter(([, count]) => count > 0)
                .map(([label, count]) => `${label}: ${count}`)
                .join('\n');

            await interaction.editReply(
                `Purged database records for **${user.username || targetUser.username}** (\`${user.discord_id}\`).\n` +
                `Deleted shared ticket history for ${ticketIds.length} ticket(s).\n\n` +
                `Deleted rows:\n${summary || 'No related rows were found beyond the user record.'}`
            );
        } catch (error) {
            await connection.rollback().catch(() => {});
            console.error('purgeuser failed:', error);
            await interaction.editReply(`Purge failed: ${error.message}`);
        } finally {
            connection.release();
        }
    })
};
