const EMOJI_CATALOG = {
    arrow1: { name: 'icon_02', id: '1490843169170915440' },
    bell: { name: 'icon_03', id: '1490843197142728756' },
    cash: { name: 'icon_08', id: '1490843369130168471' },
    warning: { name: 'icon_10', id: '1490843439875625104' },
    file: { name: 'icon_12', id: '1490843553406910484' },
    link: { name: 'icon_19', id: '1490843801663832125' },
    unlock: { name: 'icon_20', id: '1490843851823513731' },
    pin: { name: 'icon_28', id: '1490844183974379530' },
    arrow2: { name: 'icon_34', id: '1490844473012256778' },
    ticket: { name: 'icon_38', id: '1490844634895749253' },
    support: { name: 'icon_41', id: '1490844772401938454' },
    delete: { name: 'icon_42', id: '1490844802491613225' },
    arrow3: { name: 'icon_44', id: '1490844876537860298' },
    ltc: { name: 'ltc', id: '1486723569810673734' },
    cashappLogo: { name: 'cashapp', id: '1486723179039686776' },
    paysafecard: { name: 'psc', id: '1486722619364474920' },
    usdt: { name: 'usdt', id: '1486722520789942282' },
    btc: { name: 'btc', id: '1486673370039713943' },
    eth: { name: 'eth', id: '1486673304117841981' },
    wiseLogo: { name: 'wise', id: '1486673265714925589' },
    zelleLogo: { name: 'zelle', id: '1486673186786639922' },
    sol: { name: 'sol', id: '1486673137171959848' },
    binance: { name: 'binance', id: '1491924787369476126' },
    revolutLogo: { name: 'revolut', id: '1491924050585587803' },
    giftcardLogo: { name: 'giftcard', id: '1491923966619815936' }
};

// Change the values here to decide which emoji appears in each place.
const EMOJI_SLOTS = {
    panelStartExchange: 'ticket',
    panelIntroPrimary: 'unlock',
    panelIntroSecondary: 'arrow1',
    panelLearnMore: 'link',
    panelTerms: 'file',
    panelReady: 'ticket',

    exchangeTypeTitle: 'ticket',
    exchangeTypeBuy: 'arrow1',
    exchangeTypeSell: 'arrow2',
    exchangeTypeSwap: 'arrow3',
    exchangeTypeFiat: 'cash',
    exchangeFlowTitle: 'ticket',

    currencyOption: 'cash',
    confirmAction: 'ticket',
    cancelAction: 'delete',
    summaryTitle: 'cash',

    dealChangeAmount: 'cash',
    dealSupport: 'support',
    dealClose: 'delete',
    dealClaim: 'ticket',

    releaseWarning: 'warning',
    releaseConfirmExchanger: 'unlock',
    releaseConfirmBuyer: 'ticket',
    releaseConfirmed: 'unlock',
    payoutAddress: 'pin',
    dealCompleted: 'unlock',

    supportOpened: 'support',
    supportButton: 'support',

    withdrawPreview: 'cash',
    withdrawBroadcast: 'unlock',
    withdrawSent: 'arrow3',
    depositAddress: 'pin',
    copyAddress: 'file',

    paymentPayPal: 'link',
    paymentCashApp: 'cashappLogo',
    paymentZelle: 'zelleLogo',
    paymentWise: 'wiseLogo',
    paymentRevolut: 'revolutLogo',
    paymentBank: 'pin',
    paymentGiftCard: 'giftcardLogo',
    paymentBinanceGiftCard: 'binance',
    paymentPaysafeCard: 'paysafecard',
    paymentCrypto: 'unlock',
    paymentNetwork: 'link',
    paymentBTC: 'btc',
    paymentETH: 'eth',
    paymentSOL: 'sol',
    paymentLTC: 'ltc',
    paymentUSDT: 'usdt'
};

function resolveCatalogKey(slotOrKey) {
    const directMatch = EMOJI_CATALOG[slotOrKey] ? slotOrKey : null;
    if (directMatch) return directMatch;

    const mappedKey = EMOJI_SLOTS[slotOrKey];
    return EMOJI_CATALOG[mappedKey] ? mappedKey : null;
}

function getDefinition(slotOrKey) {
    const key = resolveCatalogKey(slotOrKey);
    return key ? EMOJI_CATALOG[key] : null;
}

function getText(slotOrKey) {
    const definition = getDefinition(slotOrKey);
    return definition ? `<:${definition.name}:${definition.id}>` : '';
}

function getComponent(slotOrKey) {
    const definition = getDefinition(slotOrKey);
    return definition ? { id: definition.id, name: definition.name } : undefined;
}

function withEmoji(slotOrKey, label) {
    const emoji = getText(slotOrKey);
    return emoji ? `${emoji} ${label}` : label;
}

const legacyText = Object.fromEntries(
    Object.keys(EMOJI_CATALOG).map((key) => [key, getText(key)])
);

const legacyComponents = Object.fromEntries(
    Object.keys(EMOJI_CATALOG).map((key) => [key, getComponent(key)])
);

module.exports = {
    ...legacyText,
    catalog: EMOJI_CATALOG,
    slots: EMOJI_SLOTS,
    components: legacyComponents,
    getDefinition,
    getText,
    getComponent,
    withEmoji
};
