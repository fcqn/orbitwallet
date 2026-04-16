const SCALE = 8n;
const TEN = 10n;
const FACTOR = TEN ** SCALE;
const OWNER_COMMISSION_RATE = '0.10';
const MINIMUM_SOURCE_AMOUNT_EUR = '2.00000000';
const MINIMUM_SERVICE_FEE_EUR = '0.50000000';
const DEFAULT_OWNER_WITHDRAWAL_THRESHOLD = '100.00000000';

function normalizeDecimalInput(value) {
    if (value === null || value === undefined) return '0';
    const normalized = String(value).trim().replace(/,/g, '');
    if (!normalized) return '0';
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
        throw new Error(`Invalid decimal value: ${value}`);
    }
    return normalized;
}

function decimalToUnits(value, scale = SCALE) {
    const normalized = normalizeDecimalInput(value);
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [wholePart, fractionalPart = ''] = unsigned.split('.');
    const paddedFraction = `${fractionalPart}${'0'.repeat(Number(scale))}`.slice(0, Number(scale));
    const units = (BigInt(wholePart || '0') * (TEN ** scale)) + BigInt(paddedFraction || '0');
    return negative ? -units : units;
}

function unitsToDecimal(units, scale = SCALE) {
    const negative = units < 0n;
    const absolute = negative ? -units : units;
    const divisor = TEN ** scale;
    const whole = absolute / divisor;
    const fraction = (absolute % divisor).toString().padStart(Number(scale), '0');
    return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

function compareDecimal(left, right) {
    const leftUnits = decimalToUnits(left);
    const rightUnits = decimalToUnits(right);
    if (leftUnits === rightUnits) return 0;
    return leftUnits > rightUnits ? 1 : -1;
}

function addDecimal(left, right) {
    return unitsToDecimal(decimalToUnits(left) + decimalToUnits(right));
}

function subtractDecimal(left, right) {
    return unitsToDecimal(decimalToUnits(left) - decimalToUnits(right));
}

function multiplyDecimal(left, right, scale = SCALE) {
    const leftUnits = decimalToUnits(left, scale);
    const rightUnits = decimalToUnits(right, scale);
    const divisor = TEN ** scale;
    const product = leftUnits * rightUnits;
    const adjustment = product >= 0n ? divisor / 2n : -(divisor / 2n);
    return unitsToDecimal((product + adjustment) / divisor, scale);
}

function divideDecimal(left, right, scale = SCALE) {
    const leftUnits = decimalToUnits(left, scale);
    const rightUnits = decimalToUnits(right, scale);
    if (rightUnits === 0n) {
        throw new Error('Division by zero');
    }
    const multiplier = TEN ** scale;
    const dividend = leftUnits * multiplier;
    const absoluteRight = rightUnits < 0n ? -rightUnits : rightUnits;
    const adjustment = dividend >= 0n ? absoluteRight / 2n : -(absoluteRight / 2n);
    return unitsToDecimal((dividend + adjustment) / rightUnits, scale);
}

function fixedDisplay(value, decimals = 8) {
    return unitsToDecimal(decimalToUnits(value, BigInt(decimals)), BigInt(decimals));
}

function isLtcInvolved({ paymentMethod, paymentSub, receiveMethod, receiveSub }) {
    const candidates = [paymentMethod, paymentSub, receiveMethod, receiveSub]
        .filter(Boolean)
        .map((value) => String(value).toUpperCase());

    return candidates.some((value) => value.includes('LTC') || value.includes('LITECOIN'));
}

function calculateMarketplaceAmounts({
    amountFrom,
    feeRate,
    ltcPrice,
    fiatCurrency = 'EUR',
    paymentMethod,
    paymentSub,
    receiveMethod,
    receiveSub
}) {
    const amountFromNormalized = fixedDisplay(amountFrom);
    const feeRateNormalized = fixedDisplay(feeRate);
    const ltcPriceNormalized = fixedDisplay(ltcPrice);
    const calculatedFeeEur = multiplyDecimal(amountFromNormalized, feeRateNormalized);
    const feeEur = compareDecimal(calculatedFeeEur, MINIMUM_SERVICE_FEE_EUR) >= 0
        ? calculatedFeeEur
        : MINIMUM_SERVICE_FEE_EUR;
    const amountToEur = subtractDecimal(amountFromNormalized, feeEur);

    if (compareDecimal(amountFromNormalized, MINIMUM_SOURCE_AMOUNT_EUR) < 0) {
        throw new Error(`Minimum exchange amount is 2 ${String(fiatCurrency || 'EUR').toUpperCase()} equivalent.`);
    }

    if (compareDecimal(amountToEur, amountFromNormalized) >= 0) {
        throw new Error('Received amount must be lower than sent amount.');
    }

    if (compareDecimal(feeEur, '0') <= 0) {
        throw new Error('Service fee must be greater than zero.');
    }

    const grossLtc = divideDecimal(amountFromNormalized, ltcPriceNormalized);
    const usesLtcLogic = isLtcInvolved({ paymentMethod, paymentSub, receiveMethod, receiveSub });

    if (usesLtcLogic) {
        const feeLtc = divideDecimal(feeEur, ltcPriceNormalized);
        const amountToLtc = subtractDecimal(grossLtc, feeLtc);

        if (compareDecimal(amountToLtc, grossLtc) >= 0) {
            throw new Error('Received LTC amount must be lower than sent amount.');
        }

        if (compareDecimal(feeLtc, '0') <= 0) {
            throw new Error('LTC service fee must be greater than zero.');
        }

        return {
            usesLtcLogic: true,
            amountFrom: amountFromNormalized,
            amountTo: amountToEur,
            serviceFeeAmount: feeLtc,
            serviceFeeCurrency: 'LTC',
            amountLtc: amountToLtc,
            feeLtc,
            totalLtc: grossLtc,
            exchangerProfit: subtractDecimal(feeLtc, multiplyDecimal(feeLtc, OWNER_COMMISSION_RATE)),
            ownerCommission: multiplyDecimal(feeLtc, OWNER_COMMISSION_RATE)
        };
    }

    return {
        usesLtcLogic: false,
        amountFrom: amountFromNormalized,
        amountTo: amountToEur,
        serviceFeeAmount: feeEur,
            serviceFeeCurrency: String(fiatCurrency || 'EUR').toUpperCase(),
        amountLtc: grossLtc,
        feeLtc: '0.00000000',
        totalLtc: grossLtc,
        exchangerProfit: subtractDecimal(feeEur, multiplyDecimal(feeEur, OWNER_COMMISSION_RATE)),
        ownerCommission: multiplyDecimal(feeEur, OWNER_COMMISSION_RATE)
    };
}

async function applyHiddenOwnerCommission(connection, {
    ticketId,
    exchangerId,
    serviceFeeAmount,
    serviceFeeCurrency
}) {
    const ownerCommission = multiplyDecimal(serviceFeeAmount, OWNER_COMMISSION_RATE);
    const exchangerProfit = subtractDecimal(serviceFeeAmount, ownerCommission);

    if (compareDecimal(serviceFeeAmount, '0') <= 0) {
        throw new Error('Service fee must be greater than zero.');
    }

    if (compareDecimal(ownerCommission, '0') <= 0) {
        throw new Error('Owner commission must be greater than zero.');
    }

    await connection.query(
        `INSERT INTO exchanger_owner_balances (user_id, currency_code, hidden_owner_balance, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
         hidden_owner_balance = hidden_owner_balance + VALUES(hidden_owner_balance),
         updated_at = NOW()`,
        [exchangerId, serviceFeeCurrency, ownerCommission]
    );

    await connection.query(
        `INSERT INTO owner_commission_ledger (
            user_id, ticket_id, currency_code, service_fee_amount, owner_commission_amount, exchanger_profit_amount, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NOW())`,
        [exchangerId, ticketId, serviceFeeCurrency, serviceFeeAmount, ownerCommission, exchangerProfit]
    );

    return { ownerCommission, exchangerProfit };
}

module.exports = {
    OWNER_COMMISSION_RATE,
    MINIMUM_SOURCE_AMOUNT_EUR,
    MINIMUM_SERVICE_FEE_EUR,
    DEFAULT_OWNER_WITHDRAWAL_THRESHOLD,
    addDecimal,
    subtractDecimal,
    multiplyDecimal,
    divideDecimal,
    compareDecimal,
    fixedDisplay,
    isLtcInvolved,
    calculateMarketplaceAmounts,
    applyHiddenOwnerCommission
};
