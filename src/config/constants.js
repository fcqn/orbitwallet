// Payment method fees
exports.FEES = {
    'PayPal': 0.05,
    'CashApp': 0.06,
    'Zelle': 0.04,
    'PaysafeCard': 0.15,
    'paypal': 0.05,
    'cashapp': 0.06,
    'zelle': 0.04,
    'paysafecard': 0.15
};

// Status enums
exports.TICKET_STATUS = {
    OPEN: 'OPEN',
    CLAIMED: 'CLAIMED',
    PAID: 'PAID',
    RELEASED: 'RELEASED',
    CANCELLED: 'CANCELLED',
    DISPUTED: 'DISPUTED'
};

exports.LEDGER_ACTIONS = {
    DEPOSIT: 'DEPOSIT',
    WITHDRAWAL: 'WITHDRAWAL',
    P2P_LOCK: 'P2P_LOCK',
    P2P_RELEASE: 'P2P_RELEASE',
    SERVICE_FEE: 'SERVICE_FEE',
    COMMISSION: 'COMMISSION',
    PAYOUT: 'PAYOUT',
    NETWORK_FEE: 'NETWORK_FEE'
};

// Regex patterns
exports.LTC_ADDRESS_REGEX = /^(L|M|3|ltc1)[a-zA-Z0-9]{26,42}$/;
