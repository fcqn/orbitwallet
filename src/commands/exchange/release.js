const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const { exchOnly } = require('../../config/permissions');
const appConfig = require('../../config/appConfig');
const { makeTicketContainer } = require('../../core/ticketVisuals');
const emojis = require('../../config/emojis');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('release')
        .setDescription('Release escrowed LTC to buyer (Exchanger only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel)
        .addStringOption(option => 
            option.setName('ticketid')
                .setDescription('Ticket ID to release')
                .setRequired(true)),

    execute: exchOnly(async (interaction) => {
        const ticketId = interaction.options.getString('ticketid');

        try {
            // Get ticket
            const [tickets] = await db.query(
                'SELECT * FROM tickets WHERE ticket_id = ?',
                [ticketId]
            );

            if (tickets.length === 0) {
                return interaction.reply({ 
                    content: 'Ticket not found', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            const ticket = tickets[0];

            // Check if already released or not paid
            if (ticket.status !== 'CLAIMED' && ticket.status !== 'PAID') {
                return interaction.reply({ 
                    content: `Cannot release. Ticket status is: ${ticket.status}. Must be CLAIMED or PAID.`, 
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Verify caller is the exchanger (seller)
            const [exchangerRows] = await db.query(
                'SELECT id, discord_id FROM users WHERE discord_id = ?',
                [interaction.user.id]
            );

            if (exchangerRows.length === 0 || exchangerRows[0].id !== ticket.seller_id) {
                return interaction.reply({ 
                    content: 'Only the assigned exchanger can release this ticket.', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Get buyer discord id
            const [buyerRows] = await db.query(
                'SELECT discord_id FROM users WHERE id = ?',
                [ticket.buyer_id]
            );

            if (buyerRows.length === 0) {
                return interaction.reply({ 
                    content: 'Buyer not found.', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            const buyerDiscordId = buyerRows[0].discord_id;

            // Create confirmation embed
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`confirmrelease_${ticketId}_exchanger`)
                        .setLabel('Confirm Release (Exchanger)')
                        .setEmoji(emojis.getComponent('releaseConfirmExchanger'))
                        .setStyle(appConfig.brand.buttonStyle),
                    new ButtonBuilder()
                        .setCustomId(`confirmrelease_${ticketId}_buyer`)
                        .setLabel('Confirm Release (Buyer)')
                        .setEmoji(emojis.getComponent('releaseConfirmBuyer'))
                        .setStyle(appConfig.brand.buttonStyle)
                );

            // Send to ticket channel
            const ticketChannel = await interaction.guild.channels.fetch(ticket.channel_id);
            
            const confirmMsg = await ticketChannel.send({
                components: [
                    makeTicketContainer(
                        emojis.withEmoji('releaseWarning', 'Release Confirmation'),
                        [
                            `> Ticket: \`${ticketId}\``,
                            `> Amount: **${parseFloat(ticket.amount_ltc).toFixed(8)} LTC**`,
                            `> Fee: **${parseFloat(ticket.fee_ltc).toFixed(8)} LTC**`,
                            `> Total from Escrow: **${parseFloat(ticket.total_ltc).toFixed(8)} LTC**`,
                            `> Buyer: <@${buyerDiscordId}>`,
                            `> Exchanger: <@${interaction.user.id}>`
                        ],
                        [confirmRow]
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            });

            // Store confirmation state in database
            await db.query(
                'INSERT INTO release_confirmations (ticket_id, message_id, exchanger_confirmed, buyer_confirmed, created_at) VALUES (?, ?, FALSE, FALSE, NOW()) ON DUPLICATE KEY UPDATE message_id = ?, created_at = NOW()',
                [ticketId, confirmMsg.id, confirmMsg.id]
            );

            await interaction.reply({ 
                content: 'Release confirmation sent. Waiting for both parties.', 
                flags: MessageFlags.Ephemeral 
            });

        } catch (error) {
            console.error('Release command error:', error);
            await interaction.reply({ 
                content: 'Error initiating release.', 
                flags: MessageFlags.Ephemeral 
            });
        }
    })
};
