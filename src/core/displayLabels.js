function titleCaseWord(word) {
    if (!word) return '';

    const upper = String(word).toUpperCase();
    const specialMap = {
        PAYPAL: 'PayPal',
        PAYSAFECARD: 'PaysafeCard',
        USDT: 'USDT',
        BTC: 'BTC',
        ETH: 'ETH',
        LTC: 'LTC',
        SOL: 'SOL',
        BNB: 'BNB',
        EUR: 'EUR',
        USD: 'USD',
        TRC20: 'TRC20',
        ERC20: 'ERC20',
        BEP20: 'BEP20',
        POLY: 'Polygon',
        LN: 'Lightning'
    };

    if (specialMap[upper]) {
        return specialMap[upper];
    }

    return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function formatTokenList(rawValue, separator = ' ') {
    return String(rawValue || '')
        .split(separator)
        .filter(Boolean)
        .map((part) =>
            part
                .split('_')
                .filter(Boolean)
                .map(titleCaseWord)
                .join(' ')
        )
        .join(separator);
}

function formatMethodLabel(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return 'N/A';

    const bracketMatch = value.match(/\[([^\]]+)\]/);
    const parenMatch = value.match(/\(([^)]+)\)/);
    const base = value.replace(/\s*\([^)]+\)/g, '').replace(/\s*\[[^\]]+\]/g, '').trim();

    let formatted = formatTokenList(base);

    if (parenMatch) {
        formatted += ` (${formatTokenList(parenMatch[1])})`;
    }

    if (bracketMatch) {
        formatted += ` [${formatTokenList(bracketMatch[1])}]`;
    }

    return formatted;
}

module.exports = {
    formatMethodLabel
};
