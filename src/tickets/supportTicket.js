const {
    ActionRowBuilder,
    ButtonBuilder,
    ChannelType,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const db = require('../core/database');
const env = require('../config/env');
const appConfig = require('../config/appConfig');
const logger = require('../core/logger');
const emojis = require('../config/emojis');
const demoStore = require('../core/demoStore');

function disableSupportButton(rows) {
    return rows.map((row) => {
        const components = row.components.map((component) => {
            const button = ButtonBuilder.from(component);
            if (button.data.custom_id?.startsWith('support_')) {
                button.setDisabled(true);
                button.setLabel('Support Requested');
                button.setEmoji(emojis.getComponent('supportButton'));
            }
            return button;
        });
        return new ActionRowBuilder().addComponents(components);
    });
}

module.exports = {
    customId: 'support',

    async execute(interaction) {
        const ticketId = interaction.customId.replace('support_', '');

        try {
            let tickets;
            if (env.DB_ENABLED) {
                [tickets] = await db.query(
                    `SELECT t.ticket_id, t.channel_id, t.seller_id, t.status, bu.discord_id AS buyer_discord_id, su.discord_id AS seller_discord_id
                     FROM tickets t
                     JOIN users bu ON bu.id = t.buyer_id
                     LEFT JOIN users su ON su.id = t.seller_id
                     WHERE t.ticket_id = ?`,
                    [ticketId]
                );
            } else {
                const ticket = demoStore.getSupportTicketView(ticketId);
                tickets = ticket ? [ticket] : [];
            }

            if (tickets.length === 0) {
                return interaction.reply({
                    content: 'Ticket not found.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticket = tickets[0];
            if (ticket.status !== 'OPEN') {
                return interaction.reply({
                    content: 'Support button is only available before claim. Use staff commands after claim.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const supportChannel = await interaction.guild.channels.fetch(appConfig.channels.support);
            if (!supportChannel?.threads) {
                return interaction.reply({
                    content: 'Support channel is not thread-enabled.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const supportThread = await supportChannel.threads.create({
                name: `support-${ticketId.toLowerCase()}`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Support requested for ${ticketId}`
            });

            const memberIds = [
                ticket.buyer_discord_id,
                ticket.seller_discord_id,
                interaction.user.id
            ].filter(Boolean);

            for (const memberId of [...new Set(memberIds)]) {
                await supportThread.members.add(memberId).catch(() => {});
            }

            const supportEmbed = new EmbedBuilder()
                .setTitle(emojis.withEmoji('supportOpened', `Support Opened - ${ticketId}`))
                .setDescription(
                    `Support has been requested for this deal.\n\n` +
                    `Deal Thread: <#${ticket.channel_id}>\n` +
                    `Support Thread: <#${supportThread.id}>`
                )
                .setColor(appConfig.brand.color)
                .setTimestamp();

            await supportThread.send({
                content: appConfig.roles.support ? `<@&${appConfig.roles.support}>` : null,
                embeds: [supportEmbed]
            });

            if (interaction.message?.components?.length) {
                await interaction.message.edit({
                    components: disableSupportButton(interaction.message.components)
                }).catch(() => {});
            }

            await interaction.reply({
                content: `Support thread created: <#${supportThread.id}>`,
                flags: MessageFlags.Ephemeral
            });

            await logger.logTransaction(
                interaction.client,
                `Support requested for **${ticketId}** by <@${interaction.user.id}> | Support thread <#${supportThread.id}>`
            );
        } catch (error) {
            console.error('support request failed:', error);
            await logger.logError(
                interaction.client,
                `supportTicket failed for **${ticketId}**: \`${error.message}\``
            );
            await interaction.reply({
                content: 'Could not create support thread right now.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
};
