const emojis = require('../config/emojis');

function feeDescription(rate, suffix = 'fee') {
    const percent = Number(rate) * 100;
    return `${percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(1)}% ${suffix}`;
}

const PAYMENT_CONFIG = {
    paypal: {
        label: 'PayPal',
        description: 'Pay with PayPal',
        emoji: emojis.getComponent('paymentPayPal'),
        feeRate: 0.15,
        subOptions: {
            paypal_balance: {
                label: 'PayPal Balance',
                description: feeDescription(0.07),
                emoji: emojis.getComponent('paymentPayPal'),
                feeRate: 0.07
            },
            paypal_card: {
                label: 'PayPal Card',
                description: feeDescription(0.15),
                emoji: emojis.getComponent('paymentPayPal'),
                feeRate: 0.15
            }
        }
    },
    cashapp: {
        label: 'CashApp',
        description: 'Pay with CashApp',
        emoji: emojis.getComponent('paymentCashApp'),
        feeRate: 0.15
    },
    zelle: {
        label: 'Zelle',
        description: 'Pay with Zelle',
        emoji: emojis.getComponent('paymentZelle'),
        feeRate: 0.15
    },
    wise: {
        label: 'Wise',
        description: 'Pay with Wise',
        emoji: emojis.getComponent('paymentWise'),
        feeRate: 0.20
    },
    revolut: {
        label: 'Revolut',
        description: 'Pay with Revolut',
        emoji: emojis.getComponent('paymentRevolut'),
        feeRate: 0.15
    },
    paysafecard: {
        label: 'PaysafeCard',
        description: 'Pay with PaysafeCard',
        emoji: emojis.getComponent('paymentPaysafeCard'),
        feeRate: 0.15
    },
    bank: {
        label: 'Bank Transfer',
        description: 'Bank transfer',
        emoji: emojis.getComponent('paymentBank'),
        feeRate: 0.15
    },
    binance_gift_card: {
        label: 'Binance Gift Card',
        description: 'Pay with Binance gift card',
        emoji: emojis.getComponent('paymentBinanceGiftCard'),
        feeRate: 0.20
    },
    giftcard: {
        label: 'Gift Card',
        description: 'Pay with a gift card',
        emoji: emojis.getComponent('paymentGiftCard'),
        feeRate: 0.20
    },
    crypto: {
        label: 'Crypto',
        description: 'Pay with crypto',
        emoji: emojis.getComponent('paymentCrypto'),
        feeRate: 0.03,
        subOptions: {
            btc: { label: 'Bitcoin (BTC)', description: 'Pay with BTC', emoji: emojis.getComponent('paymentBTC'), feeRate: 0.03 },
            eth: { label: 'Ethereum (ETH)', description: 'Pay with ETH', emoji: emojis.getComponent('paymentETH'), feeRate: 0.03 },
            sol: { label: 'Solana (SOL)', description: 'Pay with SOL', emoji: emojis.getComponent('paymentSOL'), feeRate: 0.03 },
            ltc: { label: 'Litecoin (LTC)', description: 'Pay with LTC', emoji: emojis.getComponent('paymentLTC'), feeRate: 0.03 },
            usdt: { label: 'USDT', description: 'Pay with USDT - choose network next', emoji: emojis.getComponent('paymentUSDT'), feeRate: 0.03 }
        },
        networks: {
            usdt_erc20: { label: 'ERC-20 (Ethereum)', description: 'Ethereum network', emoji: emojis.getComponent('paymentNetwork') },
            usdt_trc20: { label: 'TRC-20 (Tron)', description: 'Tron network', emoji: emojis.getComponent('paymentNetwork') },
            usdt_bep20: { label: 'BEP-20 (BSC)', description: 'Binance Smart Chain', emoji: emojis.getComponent('paymentNetwork') },
            usdt_sol: { label: 'SOL (Solana)', description: 'Solana network', emoji: emojis.getComponent('paymentNetwork') },
            usdt_poly: { label: 'Polygon', description: 'Polygon network', emoji: emojis.getComponent('paymentNetwork') }
        }
    }
};

const RECEIVE_CONFIG = {
    paypal: {
        label: 'PayPal',
        description: 'Receive to PayPal',
        emoji: emojis.getComponent('paymentPayPal'),
        subOptions: {
            paypal_balance: {
                label: 'PayPal Balance',
                description: 'Receive to PayPal balance',
                emoji: emojis.getComponent('paymentPayPal')
            }
        }
    },
    cashapp: { label: 'CashApp', description: 'Receive to CashApp', emoji: emojis.getComponent('paymentCashApp') },
    zelle: { label: 'Zelle', description: 'Receive to Zelle', emoji: emojis.getComponent('paymentZelle') },
    wise: { label: 'Wise', description: 'Receive to Wise', emoji: emojis.getComponent('paymentWise') },
    revolut: { label: 'Revolut', description: 'Receive to Revolut', emoji: emojis.getComponent('paymentRevolut') },
    paysafecard: { label: 'PaysafeCard', description: 'Receive to PaysafeCard', emoji: emojis.getComponent('paymentPaysafeCard') },
    bank: { label: 'Bank Transfer', description: 'Receive by bank transfer', emoji: emojis.getComponent('paymentBank') },
    binance_gift_card: { label: 'Binance Gift Card', description: 'Receive Binance gift card', emoji: emojis.getComponent('paymentBinanceGiftCard') },
    giftcard: { label: 'Gift Card', description: 'Receive gift card value', emoji: emojis.getComponent('paymentGiftCard') },
    crypto: {
        label: 'Crypto',
        description: 'Receive crypto',
        emoji: emojis.getComponent('paymentCrypto'),
        subOptions: {
            btc: { label: 'Bitcoin (BTC)', description: 'Receive BTC', emoji: emojis.getComponent('paymentBTC') },
            eth: { label: 'Ethereum (ETH)', description: 'Receive ETH', emoji: emojis.getComponent('paymentETH') },
            sol: { label: 'Solana (SOL)', description: 'Receive SOL', emoji: emojis.getComponent('paymentSOL') },
            ltc: { label: 'Litecoin (LTC)', description: 'Receive LTC', emoji: emojis.getComponent('paymentLTC') },
            usdt: { label: 'USDT', description: 'Receive USDT - choose network next', emoji: emojis.getComponent('paymentUSDT') }
        },
        networks: {
            btc: [
                { label: 'BTC Native', value: 'btc_native', description: 'Standard Bitcoin network', emoji: emojis.getComponent('paymentNetwork') },
                { label: 'Lightning Network', value: 'btc_ln', description: 'Instant and cheap BTC', emoji: emojis.getComponent('paymentNetwork') }
            ],
            eth: [
                { label: 'ETH Native', value: 'eth_native', description: 'Main Ethereum network', emoji: emojis.getComponent('paymentNetwork') },
                { label: 'Arbitrum', value: 'eth_arb', description: 'Layer 2 scaling', emoji: emojis.getComponent('paymentNetwork') },
                { label: 'Optimism', value: 'eth_opt', description: 'Layer 2 scaling', emoji: emojis.getComponent('paymentNetwork') },
                { label: 'Base', value: 'eth_base', description: 'Coinbase Layer 2', emoji: emojis.getComponent('paymentNetwork') }
            ],
            usdt: [
                { label: 'ERC-20', value: 'usdt_rec_erc20', description: 'Ethereum', emoji: emojis.getComponent('paymentNetwork') },
                { label: 'TRC-20', value: 'usdt_rec_trc20', description: 'Tron', emoji: emojis.getComponent('paymentNetwork') },
                { label: 'BEP-20', value: 'usdt_rec_bep20', description: 'BSC', emoji: emojis.getComponent('paymentNetwork') },
                { label: 'SOL', value: 'usdt_rec_sol', description: 'Solana', emoji: emojis.getComponent('paymentNetwork') }
            ]
        }
    }
};

const AMOUNT_MODAL_CONFIG = {
    title: 'Step 3: Enter Amount',
    fieldId: 'amount_usd',
    label: 'Amount in EUR',
    placeholder: 'Enter amount in EUR'
};

function toMenuOptions(config) {
    return Object.entries(config).map(([value, item]) => ({
        label: item.label,
        value,
        description: item.description,
        emoji: item.emoji
    }));
}

function toSubOptions(subOptions) {
    return Object.entries(subOptions).map(([value, item]) => ({
        label: item.label,
        value,
        description: item.description,
        emoji: item.emoji
    }));
}

function getPaymentOptions() {
    return toMenuOptions(PAYMENT_CONFIG);
}

function getReceiveOptions() {
    return toMenuOptions(RECEIVE_CONFIG);
}

function getPaymentOptionsForExchangeType(exchangeType) {
    const allOptions = getPaymentOptions();

    if (exchangeType === 'swap' || exchangeType === 'sell') {
        return allOptions.filter((option) => option.value === 'crypto');
    }

    if (exchangeType === 'buy' || exchangeType === 'fiat_to_fiat') {
        return allOptions.filter((option) => option.value !== 'crypto');
    }

    return allOptions;
}

function getReceiveOptionsForExchangeType(exchangeType) {
    const allOptions = getReceiveOptions();

    if (exchangeType === 'swap' || exchangeType === 'buy') {
        return allOptions.filter((option) => option.value === 'crypto');
    }

    if (exchangeType === 'sell' || exchangeType === 'fiat_to_fiat') {
        return allOptions.filter((option) => option.value !== 'crypto');
    }

    return allOptions;
}

function getPaymentSubOptions(method) {
    return PAYMENT_CONFIG[method]?.subOptions ? toSubOptions(PAYMENT_CONFIG[method].subOptions) : [];
}

function getPaymentNetworkOptions(method, subOption) {
    if (method !== 'crypto' || subOption !== 'usdt') {
        return [];
    }

    return toSubOptions(PAYMENT_CONFIG.crypto.networks);
}

function getReceiveSubOptions(method) {
    return RECEIVE_CONFIG[method]?.subOptions ? toSubOptions(RECEIVE_CONFIG[method].subOptions) : [];
}

function getReceiveNetworkOptions(method, subOption) {
    if (method !== 'crypto') {
        return [];
    }

    return RECEIVE_CONFIG.crypto.networks[subOption] || [];
}

function getPaymentFeeRate({ paymentMethod, paymentSub, receiveMethod, receiveSub }) {
    const methodConfig = PAYMENT_CONFIG[paymentMethod];
    const isCryptoToCrypto =
        paymentMethod === 'crypto' &&
        receiveMethod === 'crypto';

    if (isCryptoToCrypto) {
        return 0.03;
    }

    if (!methodConfig) {
        return 0.05;
    }

    if (paymentSub && methodConfig.subOptions?.[paymentSub]?.feeRate !== undefined) {
        return methodConfig.subOptions[paymentSub].feeRate;
    }

    if (receiveSub && methodConfig.subOptions?.[receiveSub]?.feeRate !== undefined) {
        return methodConfig.subOptions[receiveSub].feeRate;
    }

    return methodConfig.feeRate ?? 0.05;
}

module.exports = {
    PAYMENT_CONFIG,
    RECEIVE_CONFIG,
    AMOUNT_MODAL_CONFIG,
    feeDescription,
    getPaymentOptions,
    getPaymentOptionsForExchangeType,
    getPaymentSubOptions,
    getPaymentNetworkOptions,
    getReceiveOptions,
    getReceiveOptionsForExchangeType,
    getReceiveSubOptions,
    getReceiveNetworkOptions,
    getPaymentFeeRate
};
