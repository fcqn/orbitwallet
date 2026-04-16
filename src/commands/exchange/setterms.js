const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../core/database');
const { exchOnly } = require('../../config/permissions');
const logger = require('../../core/logger');

const TERM_METHODS = [
    { name: 'Default', value: 'default' },
    { name: 'PayPal', value: 'paypal' },
    { name: 'CashApp', value: 'cashapp' },
    { name: 'Zelle', value: 'zelle' },
    { name: 'Wise', value: 'wise' },
    { name: 'Revolut', value: 'revolut' },
    { name: 'Bank', value: 'bank' },
    { name: 'PaysafeCard', value: 'paysafecard' },
    { name: 'Crypto', value: 'crypto' },
    { name: 'LTC', value: 'ltc' },
    { name: 'USDT', value: 'usdt' },
    { name: 'BTC', value: 'btc' },
    { name: 'ETH', value: 'eth' },
    { name: 'SOL', value: 'sol' }
];

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('setterms')
        .setDescription('Set the terms text buyers must accept when you claim')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel)
        .addStringOption((option) =>
            option
                .setName('text')
                .setDescription('The terms text shown to buyers')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('method')
                .setDescription('Save terms for one payment method or as your default')
                .setRequired(false)
                .addChoices(...TERM_METHODS)
        ),

    execute: exchOnly(async (interaction) => {
        const method = interaction.options.getString('method') || 'default';
        const text = interaction.options.getString('text').trim();

        if (text.length < 10 || text.length > 1500) {
            return interaction.reply({
                content: 'Terms text must be between 10 and 1500 characters.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const [users] = await db.query('SELECT id FROM users WHERE discord_id = ?', [interaction.user.id]);
            if (!users.length) {
                return interaction.reply({
                    content: 'Create/register a wallet first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (method === 'default') {
                await db.query(
                    'UPDATE users SET exchanger_terms = ? WHERE id = ?',
                    [text, users[0].id]
                );
            } else {
                await db.query(
                    `INSERT INTO exchanger_payment_terms (user_id, method_key, terms_text)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE terms_text = VALUES(terms_text), updated_at = NOW()`,
                    [users[0].id, method, text]
                );
            }

            await interaction.reply({
                content: method === 'default'
                    ? 'Your default exchanger terms were saved.'
                    : `Your ${method.toUpperCase()} terms were saved.`,
                flags: MessageFlags.Ephemeral
            });
            await logger.logPaymentConfig(
                interaction.client,
                method === 'default'
                    ? `<@${interaction.user.id}> updated default exchanger terms`
                    : `<@${interaction.user.id}> updated exchanger terms for **${method.toUpperCase()}**`
            );
        } catch (error) {
            console.error('setterms failed:', error);
            await logger.logError(interaction.client, `setterms failed: \`${error.message}\``);
            await interaction.reply({
                content: 'Failed to save exchanger terms.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    })
};
