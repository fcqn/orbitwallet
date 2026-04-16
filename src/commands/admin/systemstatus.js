const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const rpc = require('../../core/rpc');
const appConfig = require('../../config/appConfig');
const { adminOnly } = require('../../config/permissions');

async function checkDatabase() {
    try {
        const [rows] = await db.query('SELECT 1 AS ok');
        return rows[0]?.ok === 1 ? 'OK' : 'Unexpected response';
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

async function checkRpc() {
    try {
        await rpc.getBalance();
        return 'OK';
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

async function checkChannel(client, channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        return channel?.isTextBased?.() ? `OK (${channel.name || channel.id})` : 'Not text-based';
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

async function getOperationalCounts() {
    const [[ticketCounts]] = await db.query(
        `SELECT
            SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_tickets,
            SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS claimed_tickets,
            SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid_tickets,
            SUM(CASE WHEN status = 'DISPUTED' THEN 1 ELSE 0 END) AS disputed_tickets
         FROM tickets`
    );
    const [[pendingClaims]] = await db.query('SELECT COUNT(*) AS count FROM pending_claim_confirmations');
    const [[pendingPaymentRequests]] = await db.query('SELECT COUNT(*) AS count FROM payment_config_requests WHERE status = "PENDING"');
    const [[releaseJobsNeedingSync]] = await db.query(
        `SELECT COUNT(*) AS count
         FROM release_jobs
         WHERE status = 'CHAIN_SENT_DB_SYNC_REQUIRED'`
    );

    return {
        ticketCounts,
        pendingClaims: Number(pendingClaims?.count || 0),
        pendingPaymentRequests: Number(pendingPaymentRequests?.count || 0),
        releaseJobsNeedingSync: Number(releaseJobsNeedingSync?.count || 0)
    };
}

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('systemstatus')
        .setDescription('Check DB, RPC, and key Discord channel health')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    execute: adminOnly(async (interaction) => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const [dbStatus, rpcStatus, claimStatus, trustStatus, errorStatus, ops] = await Promise.all([
            checkDatabase(),
            checkRpc(),
            checkChannel(interaction.client, appConfig.channels.claim),
            checkChannel(interaction.client, appConfig.channels.trustFeed),
            checkChannel(interaction.client, appConfig.channels.logs.errors),
            getOperationalCounts().catch((error) => ({
                ticketCounts: null,
                pendingClaims: `Error: ${error.message}`,
                pendingPaymentRequests: `Error: ${error.message}`,
                releaseJobsNeedingSync: `Error: ${error.message}`
            }))
        ]);

        const ticketCountsText = ops.ticketCounts
            ? `OPEN: ${Number(ops.ticketCounts.open_tickets || 0)}\nCLAIMED: ${Number(ops.ticketCounts.claimed_tickets || 0)}\nPAID: ${Number(ops.ticketCounts.paid_tickets || 0)}\nDISPUTED: ${Number(ops.ticketCounts.disputed_tickets || 0)}`
            : 'Unavailable';

        const embed = new EmbedBuilder()
            .setTitle('Orbit Trade | System Status')
            .setColor(appConfig.brand.color)
            .addFields(
                { name: 'Database', value: dbStatus, inline: false },
                { name: 'Electrum RPC', value: rpcStatus, inline: false },
                { name: 'Claim Channel', value: claimStatus, inline: false },
                { name: 'Trust Feed', value: trustStatus, inline: false },
                { name: 'Error Log Channel', value: errorStatus, inline: false },
                { name: 'Ticket Counts', value: ticketCountsText, inline: false },
                { name: 'Pending Claims', value: String(ops.pendingClaims), inline: true },
                { name: 'Pending Payment Requests', value: String(ops.pendingPaymentRequests), inline: true },
                { name: 'Release Jobs Needing Sync', value: String(ops.releaseJobsNeedingSync), inline: true }
            )
            .setFooter({ text: appConfig.brand.name })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    })
};
