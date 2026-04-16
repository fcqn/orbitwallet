const {
    Events,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MessageFlags
} = require('discord.js');
const session = require('../core/session');
const appConfig = require('../config/appConfig');
const { calculateMarketplaceAmounts } = require('../core/marketplaceFees');
const {
    getPaymentOptions,
    getPaymentOptionsForExchangeType,
    getReceiveOptions,
    getReceiveOptionsForExchangeType,
    getPaymentFeeRate
} = require('../core/paymentMethods');
const { formatFiat } = require('../core/currency');
const { makeTicketContainer } = require('../core/ticketVisuals');
const emojis = require('../config/emojis');

const EXCHANGE_MENU_ID = 'novaswap_exchange_type_menu';
const EXCHANGE_MODAL_ID_PREFIX = 'novaswap_exchange_modal';

const PAYMENT_METHOD_LABELS = Object.fromEntries(getPaymentOptions().map((option) => [option.value, option.label]));
const RECEIVE_METHOD_LABELS = Object.fromEntries(getReceiveOptions().map((option) => [option.value, option.label]));
const CURRENCY_OPTIONS = [
    { label: 'EUR', value: 'eur', description: 'Euro', emoji: emojis.getComponent('currencyOption') },
    { label: 'USD', value: 'usd', description: 'US Dollar', emoji: emojis.getComponent('currencyOption') }
];
const CURRENCY_LABELS = Object.fromEntries(CURRENCY_OPTIONS.map((option) => [option.value, option.label]));
const EXCHANGE_TYPES = {
    buy: {
        label: 'Buy',
        description: 'Exchange fiat currency for crypto',
        title: 'Buy Exchange',
        emoji: emojis.getComponent('exchangeTypeBuy')
    },
    sell: {
        label: 'Sell',
        description: 'Exchange crypto for fiat currency',
        title: 'Sell Exchange',
        emoji: emojis.getComponent('exchangeTypeSell')
    },
    swap: {
        label: 'Swap',
        description: 'Trade one cryptocurrency for another',
        title: 'Swap Exchange',
        emoji: emojis.getComponent('exchangeTypeSwap')
    },
    fiat_to_fiat: {
        label: 'Fiat to Fiat',
        description: 'Exchange fiat currency for another fiat currency',
        title: 'Fiat to Fiat Exchange',
        emoji: emojis.getComponent('exchangeTypeFiat')
    }
};

function buildExchangeTypeMenu() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(EXCHANGE_MENU_ID)
        .setPlaceholder('Choose your exchange type');

    for (const [value, config] of Object.entries(EXCHANGE_TYPES)) {
        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(config.label)
                .setDescription(config.description)
                .setEmoji(config.emoji)
                .setValue(value)
        );
    }

    return new ActionRowBuilder().addComponents(menu);
}

function buildExchangeTypeEmbed() {
    return new EmbedBuilder()
        .setColor(0xb68ced)
        .setTitle(emojis.withEmoji('exchangeTypeTitle', 'Choose Your Exchange Type'))
        .setDescription(
            "Select the type of exchange you'd like to start. Each option opens a dedicated flow tailored to your needs."
        )
        .addFields(
            {
                name: emojis.withEmoji('exchangeTypeBuy', 'Buy'),
                value: 'Exchange fiat currency for crypto'
            },
            {
                name: emojis.withEmoji('exchangeTypeSell', 'Sell'),
                value: 'Exchange crypto for fiat currency'
            },
            {
                name: emojis.withEmoji('exchangeTypeSwap', 'Swap'),
                value: 'Trade one cryptocurrency for another'
            },
            {
                name: emojis.withEmoji('exchangeTypeFiat', 'Fiat to Fiat'),
                value: 'Exchange fiat currency for another fiat currency'
            }
        )
}

function buildExchangeTypeContainer() {
    return new ContainerBuilder()
        .setAccentColor(0xb68ced)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${emojis.withEmoji('exchangeTypeTitle', 'Choose Your Exchange Type')}`)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "Select the type of exchange you'd like to start. Each option opens a dedicated flow tailored to your needs."
            )
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `> **${emojis.withEmoji('exchangeTypeBuy', 'Buy')}**`,
                    '> Exchange fiat currency for crypto',
                    '',
                    `> **${emojis.withEmoji('exchangeTypeSell', 'Sell')}**`,
                    '> Exchange crypto for fiat currency',
                    '',
                    `> **${emojis.withEmoji('exchangeTypeSwap', 'Swap')}**`,
                    '> Trade one cryptocurrency for another',
                    '',
                    `> **${emojis.withEmoji('exchangeTypeFiat', 'Fiat to Fiat')}**`,
                    '> Exchange fiat currency for another fiat currency'
                ].join('\n')
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(buildExchangeTypeMenu())
}

function buildSelectOptions(options) {
    return options.map((option) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(option.label)
            .setDescription(option.description)
            .setEmoji(option.emoji || undefined)
            .setValue(option.value)
    );
}

function buildModalSelect(customId, placeholder, options) {
    return new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setRequired(true)
        .addOptions(buildSelectOptions(options));
}

function buildStepMenu(customId, placeholder, options) {
    return new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .addOptions(buildSelectOptions(options));
}

function buildExchangeModal(exchangeType, sessionId) {
    const exchange = EXCHANGE_TYPES[exchangeType];
    const paymentOptions = getPaymentOptionsForExchangeType(exchangeType);
    const receiveOptions = getReceiveOptionsForExchangeType(exchangeType);

    return new ModalBuilder()
        .setCustomId(`${EXCHANGE_MODAL_ID_PREFIX}:${exchangeType}:${sessionId}`)
        .setTitle(exchange?.title ?? 'Exchange Request')
        .addLabelComponents(
            new LabelBuilder()
                .setLabel('Select a sending option')
                .setDescription('Choose the payment method you are sending')
                .setStringSelectMenuComponent(
                    buildModalSelect('sending_option', 'Select a sending option', paymentOptions)
                ),
            new LabelBuilder()
                .setLabel('Select a receiving option')
                .setDescription('Choose the payment method you want to receive')
                .setStringSelectMenuComponent(
                    buildModalSelect('receiving_option', 'Select a receiving option', receiveOptions)
                ),
            new LabelBuilder()
                .setLabel('Select the currency you want to exchange')
                .setDescription('Choose the fiat currency for this request')
                .setStringSelectMenuComponent(
                    buildModalSelect('currency', 'Select the currency you want to exchange', CURRENCY_OPTIONS)
                ),
            new LabelBuilder()
                .setLabel('Enter the amount you want to exchange')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('amount')
                        .setPlaceholder('Example: 250')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
            new LabelBuilder()
                .setLabel('Additional Information')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('additional_info')
                        .setPlaceholder('Add any extra details here')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                )
        );
}

async function getLtcPrice(currency = 'eur') {
    try {
        const axios = require('axios');
        const normalizedCurrency = String(currency || 'eur').toLowerCase();
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=${normalizedCurrency}`,
            { timeout: 5000 }
        );
        return Number(res.data?.litecoin?.[normalizedCurrency] || 60);
    } catch (error) {
        console.log('Price fetch failed:', error.message);
        return 60;
    }
}

function buildSummaryEmbed({ exchangeType, sendingOption, receivingOption, currency, amount, additionalInfo }) {
    const exchange = EXCHANGE_TYPES[exchangeType];
    const normalizedCurrency = String(currency || 'eur').toUpperCase();

    return new EmbedBuilder()
        .setColor(0x5b6cff)
        .setTitle(emojis.withEmoji('exchangeFlowTitle', `${exchange?.title ?? 'Exchange'} Submitted`))
        .setDescription('Your exchange request has been captured. A staff flow can be connected here next.')
        .addFields(
            { name: 'Type', value: exchange?.label ?? exchangeType, inline: true },
            { name: 'Amount', value: formatFiat(amount, normalizedCurrency), inline: true },
            { name: 'Currency', value: CURRENCY_LABELS[String(currency || 'eur').toLowerCase()] || normalizedCurrency, inline: true },
            { name: 'Sending Option', value: PAYMENT_METHOD_LABELS[sendingOption] ?? sendingOption },
            { name: 'Receiving Option', value: RECEIVE_METHOD_LABELS[receivingOption] ?? receivingOption },
            { name: 'Additional Information', value: additionalInfo }
        );
}

function buildSummaryActions(sessionId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_${sessionId}`)
            .setLabel('Confirm')
            .setEmoji(emojis.getComponent('confirmAction'))
            .setStyle(appConfig.brand.buttonStyle),
        new ButtonBuilder()
            .setCustomId(`cancel_${sessionId}`)
            .setLabel('Cancel')
            .setEmoji(emojis.getComponent('cancelAction'))
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    name: Events.InteractionCreate,
    customId: EXCHANGE_MENU_ID,

    async execute(interaction) {
        if (interaction.isButton()) {
            if (interaction.customId !== 'novaswap_start_exchange') {
                return;
            }

            await interaction.reply({
                components: [buildExchangeTypeContainer()],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
            });
            return;
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId !== EXCHANGE_MENU_ID) {
                return;
            }

            const [selectedType] = interaction.values;
            const sessionId = `${interaction.user.id}_${Date.now().toString(36)}`;

            await session.set(sessionId, interaction.user.id, {
                exchangeType: selectedType
            });

            await interaction.update({
                components: [
                    makeTicketContainer(
                        emojis.withEmoji('exchangeFlowTitle', EXCHANGE_TYPES[selectedType]?.title || 'Exchange Request'),
                        [
                            '> Step 1: select how you want to pay',
                            '> Choose the sending method first'
                        ],
                        [
                            new ActionRowBuilder().addComponents(
                                buildStepMenu(
                                    `paymenu_${sessionId}`,
                                    'Choose payment method...',
                                    getPaymentOptionsForExchangeType(selectedType)
                                )
                            )
                        ]
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            });
            return;
        }

        if (!interaction.isModalSubmit()) {
            return;
        }

        if (!interaction.customId.startsWith(`${EXCHANGE_MODAL_ID_PREFIX}:`)) {
            return;
        }

        const [, exchangeType, sessionId] = interaction.customId.split(':');
        const sendingOption = interaction.fields.getStringSelectValues('sending_option')[0];
        const receivingOption = interaction.fields.getStringSelectValues('receiving_option')[0];
        const currency = interaction.fields.getStringSelectValues('currency')[0];
        const amountRaw = interaction.fields.getTextInputValue('amount').trim();
        const additionalInfo = interaction.fields.getTextInputValue('additional_info').trim() || 'None provided';
        const amount = parseFloat(amountRaw);

        if (Number.isNaN(amount) || amount <= 0) {
            await interaction.reply({
                content: 'Please enter a valid amount (for example: 100).',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const normalizedCurrency = String(currency || 'eur').toUpperCase();
        const ltcPrice = await getLtcPrice(currency);
        let marketplaceAmounts;

        try {
            marketplaceAmounts = calculateMarketplaceAmounts({
                amountFrom: amountRaw,
                feeRate: getPaymentFeeRate({
                    paymentMethod: sendingOption,
                    receiveMethod: receivingOption
                }),
                ltcPrice,
                fiatCurrency: normalizedCurrency,
                paymentMethod: sendingOption,
                receiveMethod: receivingOption
            });
        } catch (error) {
            await interaction.reply({
                content: error.message,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const sessionData = {
            exchangeType,
            paymentMethod: sendingOption,
            receiveMethod: receivingOption,
            sendingOption,
            receivingOption,
            currency,
            sourceCurrency: normalizedCurrency,
            amountUsd: parseFloat(marketplaceAmounts.amountFrom),
            amountFrom: marketplaceAmounts.amountFrom,
            amountTo: marketplaceAmounts.amountTo,
            amountLtc: parseFloat(marketplaceAmounts.amountLtc),
            feeLtc: parseFloat(marketplaceAmounts.feeLtc),
            totalLtc: parseFloat(marketplaceAmounts.totalLtc),
            serviceFeeAmount: marketplaceAmounts.serviceFeeAmount,
            serviceFeeCurrency: marketplaceAmounts.serviceFeeCurrency,
            ltcPrice,
            feePercent: getPaymentFeeRate({
                paymentMethod: sendingOption,
                receiveMethod: receivingOption
            }),
            additionalInfo
        };

        await session.set(sessionId, interaction.user.id, sessionData);

        await interaction.reply({
            embeds: [
                buildSummaryEmbed({
                    exchangeType,
                    sendingOption,
                    receivingOption,
                    currency,
                    amount: amountRaw,
                    additionalInfo
                })
            ],
            components: [buildSummaryActions(sessionId)],
            flags: MessageFlags.Ephemeral
        });
    }
};
