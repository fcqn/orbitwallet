const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const appConfig = require('../../config/appConfig');
const { adminOnly } = require('../../config/permissions');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('ticketinfo')
        .setDescription('Inspect a ticket and its current workflow state')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName('ticketid')
                .setDescription('Ticket ID')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const ticketId = interaction.options.getString('ticketid').trim().toUpperCase();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const [rows] = await db.query(
            `SELECT
                t.*,
                bu.discord_id AS buyer_discord_id,
                bu.username AS buyer_username,
                su.discord_id AS seller_discord_id,
                su.username AS seller_username,
                pc.seller_id AS pending_claim_seller_id,
                pc.message_id AS pending_claim_message_id,
                rc.message_id AS release_message_id,
                rc.exchanger_confirmed,
                rc.buyer_confirmed
             FROM tickets t
             JOIN users bu ON bu.id = t.buyer_id
             LEFT JOIN users su ON su.id = t.seller_id
             LEFT JOIN pending_claim_confirmations pc ON pc.ticket_id = t.ticket_id
             LEFT JOIN release_confirmations rc ON rc.ticket_id = t.ticket_id
             WHERE t.ticket_id = ?
             LIMIT 1`,
            [ticketId]
        );

        if (!rows.length) {
            await interaction.editReply({ content: 'Ticket not found.' });
            return;
        }

        const ticket = rows[0];
        const ticketChannel = ticket.channel_id
            ? await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null)
            : null;
        const guildId = interaction.guild.id;
        const channelUrl = ticket.channel_id ? `https://discord.com/channels/${guildId}/${ticket.channel_id}` : null;
        const claimMessageUrl = (ticket.channel_id && ticket.claim_message_id)
            ? `https://discord.com/channels/${guildId}/${appConfig.channels.claim}/${ticket.claim_message_id}`
            : null;
        const pendingClaimMessageUrl = (ticket.channel_id && ticket.pending_claim_message_id)
            ? `https://discord.com/channels/${guildId}/${ticket.channel_id}/${ticket.pending_claim_message_id}`
            : null;
        const releaseMessageUrl = (ticket.channel_id && ticket.release_message_id)
            ? `https://discord.com/channels/${guildId}/${ticket.channel_id}/${ticket.release_message_id}`
            : null;
        const accessSummary = ticketChannel
            ? (
                ticketChannel.isThread?.()
                    ? `Type: Thread\nArchived: ${Boolean(ticketChannel.archived)}\nLocked: ${Boolean(ticketChannel.locked)}\nMember Count: ${ticketChannel.memberCount ?? 'Unknown'}`
                    : `Type: Channel\nViewable: ${ticketChannel.viewable ? 'Yes' : 'No'}`
            )
            : 'Channel not found';
        const timestampValue = ticket.released_at || ticket.paid_at || ticket.claimed_at || ticket.created_at;
        const embed = new EmbedBuilder()
            .setTitle(`Orbit Trade | ${ticket.ticket_id}`)
            .setColor(appConfig.brand.color)
            .setDescription(
                `> Status: **${ticket.status}**\n` +
                `> Buyer: <@${ticket.buyer_discord_id}> (${ticket.buyer_username || 'Unknown'})\n` +
                `> Seller: ${ticket.seller_discord_id ? `<@${ticket.seller_discord_id}> (${ticket.seller_username || 'Unknown'})` : 'Unassigned'}\n` +
                `> Payment: **${ticket.payment_method || 'Unknown'} -> ${ticket.receive_method || 'Unknown'}**`
            )
            .addFields(
                { name: 'Amounts', value: `From: ${ticket.amount_from ?? 'n/a'}\nTo: ${ticket.amount_to ?? 'n/a'}\nEscrow: ${ticket.total_ltc} LTC`, inline: false },
                { name: 'Discord Links', value: `Channel: ${channelUrl || `\`${ticket.channel_id || 'n/a'}\``}\nClaim Message: ${claimMessageUrl || `\`${ticket.claim_message_id || 'n/a'}\``}`, inline: false },
                { name: 'Pending Claim', value: ticket.pending_claim_seller_id ? `Seller ID: ${ticket.pending_claim_seller_id}\nMessage: \`${ticket.pending_claim_message_id || 'n/a'}\`` : 'None', inline: false },
                { name: 'Pending Claim URL', value: pendingClaimMessageUrl || 'None', inline: false },
                { name: 'Release Confirmation', value: ticket.release_message_id ? `Message: ${releaseMessageUrl || `\`${ticket.release_message_id}\``}\nExchanger: ${Boolean(ticket.exchanger_confirmed)}\nBuyer: ${Boolean(ticket.buyer_confirmed)}` : 'None', inline: false },
                { name: 'Access / Thread State', value: accessSummary, inline: false },
                { name: 'Finalization', value: `Buyer LTC Address: \`${ticket.buyer_ltc_address || 'n/a'}\`\nTXID: \`${ticket.final_txid || 'n/a'}\``, inline: false }
            )
            .setFooter({ text: appConfig.brand.name })
            .setTimestamp(timestampValue ? new Date(timestampValue) : new Date());

        await interaction.editReply({ embeds: [embed] });
    })
};
