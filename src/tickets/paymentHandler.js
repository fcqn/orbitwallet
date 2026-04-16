const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const session = require('../core/session');
const appConfig = require('../config/appConfig');
const { makeTicketContainer } = require('../core/ticketVisuals');
const { formatMethodLabel } = require('../core/displayLabels');
const {
    AMOUNT_MODAL_CONFIG,
    getPaymentOptions,
    getPaymentOptionsForExchangeType,
    getPaymentSubOptions,
    getPaymentNetworkOptions,
    getReceiveOptions,
    getReceiveOptionsForExchangeType,
    getReceiveSubOptions,
    getReceiveNetworkOptions
} = require('../core/paymentMethods');

module.exports = {
    async execute(interaction) {
        const customId = interaction.customId;
        const selected = interaction.values[0];

        let sessionId;
        let step;

        if (customId.startsWith('sendasset_')) {
            sessionId = customId.replace('sendasset_', '');
            step = 'sendingasset';
        } else if (customId.startsWith('receiveasset_')) {
            sessionId = customId.replace('receiveasset_', '');
            step = 'receivingasset';
        } else if (customId.startsWith('currencymenu_')) {
            sessionId = customId.replace('currencymenu_', '');
            step = 'currency';
        } else if (customId.startsWith('paymenu_')) {
            sessionId = customId.replace('paymenu_', '');
            step = 'payment';
        } else if (customId.startsWith('paysub_')) {
            sessionId = customId.replace('paysub_', '');
            step = 'paymentsub';
        } else if (customId.startsWith('cryptomenu_')) {
            sessionId = customId.replace('cryptomenu_', '');
            step = 'cryptopay';
        } else if (customId.startsWith('usdtnet_')) {
            sessionId = customId.replace('usdtnet_', '');
            step = 'usdtpaynet';
        } else if (customId.startsWith('receivemenu_')) {
            sessionId = customId.replace('receivemenu_', '');
            step = 'receive';
        } else if (customId.startsWith('receivesub_')) {
            sessionId = customId.replace('receivesub_', '');
            step = 'receivesub';
        } else if (customId.startsWith('cryptorec_')) {
            sessionId = customId.replace('cryptorec_', '');
            step = 'cryptorec';
        } else if (customId.startsWith('recnet_')) {
            sessionId = customId.replace('recnet_', '');
            step = 'receivenet';
        } else {
            return interaction.reply({
                content: 'Invalid interaction.',
                flags: MessageFlags.Ephemeral
            });
        }

        const sessionData = await session.get(sessionId);
        if (!sessionData) {
            return interaction.reply({
                content: 'Session expired. Please start again.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (step === 'sendingasset') {
            sessionData.sendingOption = selected;
            sessionData.paymentMethod = selected;
            sessionData.paymentSub = null;
            sessionData.paymentNetwork = null;
            await session.set(sessionId, interaction.user.id, sessionData);

            return interaction.update({
                components: [
                    makeTicketContainer(
                        this.getExchangeTitle(sessionData.exchangeType),
                        [
                            '> Select a receiving option',
                            '> Choose the asset you want to receive'
                        ],
                        [new ActionRowBuilder().addComponents(this.buildAssetMenu(`receiveasset_${sessionId}`, 'Select a receiving option'))]
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (step === 'receivingasset') {
            sessionData.receivingOption = selected;
            sessionData.receiveMethod = selected;
            sessionData.receiveSub = null;
            sessionData.receiveNetwork = null;
            await session.set(sessionId, interaction.user.id, sessionData);

            return interaction.update({
                components: [
                    makeTicketContainer(
                        this.getExchangeTitle(sessionData.exchangeType),
                        [
                            '> Select the currency you want to exchange',
                            '> Choose the market or currency for this request'
                        ],
                        [new ActionRowBuilder().addComponents(this.buildAssetMenu(`currencymenu_${sessionId}`, 'Select the currency you want to exchange'))]
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (step === 'currency') {
            sessionData.currency = selected;
            sessionData.sourceCurrency = selected.toUpperCase();
            await session.set(sessionId, interaction.user.id, sessionData);
            return this.showAmountModal(interaction, sessionId, true);
        }

        if (step === 'payment') {
            sessionData.paymentMethod = selected;
            await session.set(sessionId, interaction.user.id, sessionData);

            if (selected === 'paypal') {
                return this.showSubMenu(
                    interaction,
                    'Step 1b: PayPal Option',
                    'Choose how you want to pay with PayPal:',
                    `paysub_${sessionId}`,
                    'Choose PayPal option...',
                    getPaymentSubOptions('paypal')
                );
            }

            if (selected === 'crypto') {
                return this.showSubMenu(
                    interaction,
                    'Step 1b: Select Cryptocurrency',
                    'Which cryptocurrency will you pay with?',
                    `cryptomenu_${sessionId}`,
                    'Choose crypto...',
                    getPaymentSubOptions('crypto')
                );
            }

            return this.showReceiveMenu(interaction, sessionId, sessionData);
        }

        if (step === 'paymentsub') {
            sessionData.paymentSub = selected;
            await session.set(sessionId, interaction.user.id, sessionData);
            return this.showReceiveMenu(interaction, sessionId, sessionData);
        }

        if (step === 'cryptopay') {
            sessionData.paymentSub = selected;
            await session.set(sessionId, interaction.user.id, sessionData);

            if (selected === 'usdt') {
                return this.showSubMenu(
                    interaction,
                    'Step 1c: Select USDT Network',
                    'Which network for USDT payment?',
                    `usdtnet_${sessionId}`,
                    'Choose network...',
                    getPaymentNetworkOptions('crypto', 'usdt')
                );
            }

            return this.showReceiveMenu(interaction, sessionId, sessionData);
        }

        if (step === 'usdtpaynet') {
            sessionData.paymentNetwork = selected;
            await session.set(sessionId, interaction.user.id, sessionData);
            return this.showReceiveMenu(interaction, sessionId, sessionData);
        }

        if (step === 'receive') {
            sessionData.receiveMethod = selected;
            await session.set(sessionId, interaction.user.id, sessionData);

            if (selected === 'paypal') {
                return this.showSubMenu(
                    interaction,
                    'Step 2b: PayPal Receive Option',
                    'Choose how you want to receive with PayPal:',
                    `receivesub_${sessionId}`,
                    'Choose PayPal option...',
                    getReceiveSubOptions('paypal')
                );
            }

            if (selected === 'crypto') {
                return this.showSubMenu(
                    interaction,
                    'Step 2b: Select Cryptocurrency to Receive',
                    'Which cryptocurrency do you want to receive?',
                    `cryptorec_${sessionId}`,
                    'Choose crypto...',
                    getReceiveSubOptions('crypto')
                );
            }

            return this.showAmountModal(interaction, sessionId);
        }

        if (step === 'receivesub') {
            sessionData.receiveSub = selected;
            await session.set(sessionId, interaction.user.id, sessionData);
            return this.showAmountModal(interaction, sessionId);
        }

        if (step === 'cryptorec') {
            sessionData.receiveSub = selected;
            await session.set(sessionId, interaction.user.id, sessionData);

            const networkOptions = getReceiveNetworkOptions('crypto', selected);
            if (!networkOptions.length) {
                return this.showAmountModal(interaction, sessionId);
            }

            const networkConfig = {
                btc: ['Step 2c: Bitcoin Network', 'Which Bitcoin network to receive?'],
                eth: ['Step 2c: Ethereum Network', 'Which Ethereum network to receive?'],
                usdt: ['Step 2c: USDT Network', 'Which network to receive USDT?']
            }[selected];

            return this.showSubMenu(
                interaction,
                networkConfig[0],
                networkConfig[1],
                `recnet_${sessionId}`,
                'Choose network...',
                networkOptions
            );
        }

        sessionData.receiveNetwork = selected;
        await session.set(sessionId, interaction.user.id, sessionData);
        return this.showAmountModal(interaction, sessionId);
    },

    async showSubMenu(interaction, title, description, customId, placeholder, options) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .addOptions(options);

        return interaction.update({
            content: null,
            embeds: [],
            attachments: [],
            components: [
                makeTicketContainer(
                    title,
                    description.split('\n'),
                    [new ActionRowBuilder().addComponents(menu)]
                )
            ],
            flags: MessageFlags.IsComponentsV2
        });
    },

    async showReceiveMenu(interaction, sessionId, sessionData) {
        const receiveOptions = this.getReceiveOptionsForExchangeType(sessionData.exchangeType);
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`receivemenu_${sessionId}`)
            .setPlaceholder('Choose receive method...')
            .addOptions(receiveOptions);

        return interaction.update({
            content: null,
            embeds: [],
            attachments: [],
            components: [
                makeTicketContainer(
                    'Step 2: What do you want to receive?',
                    [
                        `> You are paying with: **${this.getPaymentLabel(sessionData)}**`,
                        '> Select how you want to receive'
                    ],
                    [new ActionRowBuilder().addComponents(menu)]
                )
            ],
            flags: MessageFlags.IsComponentsV2
        });
    },

    async showAmountModal(interaction, sessionId, includeAdditionalInfo = false) {
        try {
            const modal = new ModalBuilder()
                .setCustomId(`amountmodal_${sessionId}`)
                .setTitle(includeAdditionalInfo ? 'Exchange Request' : AMOUNT_MODAL_CONFIG.title);

            const amountInput = new TextInputBuilder()
                .setCustomId(includeAdditionalInfo ? 'amount' : AMOUNT_MODAL_CONFIG.fieldId)
                .setLabel(includeAdditionalInfo ? 'Enter the amount you want to exchange' : AMOUNT_MODAL_CONFIG.label)
                .setPlaceholder(includeAdditionalInfo ? 'Example: 250' : AMOUNT_MODAL_CONFIG.placeholder)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(10);

            modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

            if (includeAdditionalInfo) {
                const additionalInfoInput = new TextInputBuilder()
                    .setCustomId('additional_info')
                    .setLabel('Additional Information')
                    .setPlaceholder('Add any extra details here')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(1000);

                modal.addComponents(new ActionRowBuilder().addComponents(additionalInfoInput));
            }

            await interaction.showModal(modal);
        } catch (err) {
            console.error('Modal error:', err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'Error opening amount form. Please try again.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    },

    getPaymentLabel(sessionData) {
        let label = formatMethodLabel(sessionData.paymentMethod || 'UNKNOWN');
        if (sessionData.paymentSub) {
            label += ` (${formatMethodLabel(sessionData.paymentSub)})`;
        }
        if (sessionData.paymentNetwork) {
            const net = sessionData.paymentNetwork.split('_').pop();
            label += ` [${formatMethodLabel(net)}]`;
        }
        return label;
    },

    getPaymentOptionsForExchangeType(exchangeType) {
        return getPaymentOptionsForExchangeType(exchangeType);
    },

    getReceiveOptionsForExchangeType(exchangeType) {
        return getReceiveOptionsForExchangeType(exchangeType);
    },

    getExchangeTitle(exchangeType) {
        return {
            buy: 'Buy Exchange',
            sell: 'Sell Exchange',
            swap: 'Swap Exchange',
            fiat_to_fiat: 'Fiat to Fiat Exchange'
        }[exchangeType] || 'Exchange Request';
    },

    buildAssetMenu(customId, placeholder) {
        return new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .addOptions([
                { label: 'Litecoin', value: 'ltc', description: 'Litecoin' },
                { label: 'USDT', value: 'usdt', description: 'USDT' },
                { label: 'Solana', value: 'sol', description: 'Solana' },
                { label: 'BNB', value: 'bnb', description: 'BNB' },
                { label: 'Bitcoin', value: 'btc', description: 'Bitcoin' },
                { label: 'Ethereum', value: 'eth', description: 'Ethereum' }
            ]);
    }
};
