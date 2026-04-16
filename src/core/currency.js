const CURRENCY_SYMBOLS = {
    EUR: 'EUR',
    USD: '$'
};

function normalizeCurrency(currency) {
    return String(currency || 'EUR').trim().toUpperCase();
}

function formatFiat(amount, currency = 'EUR') {
    const normalizedCurrency = normalizeCurrency(currency);
    const value = Number(amount || 0).toFixed(2);
    const symbol = CURRENCY_SYMBOLS[normalizedCurrency] || normalizedCurrency;

    if (normalizedCurrency === 'USD') {
        return `${symbol}${value}`;
    }

    if (normalizedCurrency === 'EUR') {
        return `${value} EUR`;
    }

    return `${value} ${normalizedCurrency}`;
}

function formatFiatPerLtc(price, currency = 'EUR') {
    return `${formatFiat(price, currency)}/LTC`;
}

function formatEur(amount) {
    return formatFiat(amount, 'EUR');
}

function formatEurPerLtc(price) {
    return formatFiatPerLtc(price, 'EUR');
}

module.exports = {
    normalizeCurrency,
    formatFiat,
    formatFiatPerLtc,
    formatEur,
    formatEurPerLtc
};
