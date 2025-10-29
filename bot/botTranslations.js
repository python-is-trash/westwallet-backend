/**
 * Bot Translations - 3 Languages (English, Russian, Spanish)
 */

export const TRANSLATIONS = {
  en: {
    // Welcome & Start
    languageSelect: '🌍 Please select your language:',
    welcome: (name) => `👋 Welcome${name ? ' ' + name : ''}!\n\n💎 Your crypto investment platform is ready!`,
    languageSet: '✅ Language set to English',
    languageChangeSuccess: '✅ Language changed to English',

    // Commands
    commandsTitle: 'Available Commands:',
    cmdBalance: '/balance - Check your balances',
    cmdInvest: '/invest - View investment plans',
    cmdMyInvest: '/myinvest - View your investments',
    cmdPnl: '/pnl - View profit & loss',
    cmdReferral: '/referral - Your referral info',
    cmdLanguage: '/language - Change language',
    useWebApp: 'Use the Web App for full features! 🚀',

    // Buttons
    btnStartInvesting: '🚀 Start Investing',
    btnBalance: '💰 Balance',
    btnSupport: '💬 Support',
    btnEnglish: '🇬🇧 English',
    btnRussian: '🇷🇺 Русский',
    btnSpanish: '🇪🇸 Español',

    // Balance
    balanceTitle: '💰 Your Crypto Balances',
    totalBalance: 'Total Balance',

    // Investment Plans
    investmentPlansTitle: '📊 Investment Plans',
    investmentInfo: (min, max, daily, hours) =>
      `💰 Amount: ${min} - ${max}\n📈 Daily Return: ${daily}%\n⏱ Duration: ${hours} hours`,
    investNow: 'Invest Now',

    // My Investments
    myInvestmentsTitle: '📊 Your Active Investments',
    noInvestments: 'You have no active investments yet.\nStart investing to earn passive income!',
    investmentDetails: (amount, crypto, daily, end) =>
      `💰 Amount: ${amount} ${crypto}\n📈 Daily Return: ${daily}%\n⏰ Ends: ${end}`,

    // PNL
    pnlTitle: '📊 Profit & Loss Report',
    earnings24h: '24h Earnings',
    earnings7d: '7d Earnings',
    earnings30d: '30d Earnings',
    totalInvested: 'Total Invested',
    activePlans: 'Active Plans',

    // Referral
    referralTitle: '🎁 Referral Program',
    referralCode: 'Your Referral Code',
    referralLink: 'Your Referral Link',
    referralStats: (total, level1, level2, level3) =>
      `👥 Total Referrals: ${total}\n├─ Level 1: ${level1}\n├─ Level 2: ${level2}\n└─ Level 3: ${level3}`,
    referralEarnings: (total, lvl1, lvl2, lvl3) =>
      `💰 Total Earnings: ${total} USDT\n├─ Level 1: ${lvl1} USDT\n├─ Level 2: ${lvl2} USDT\n└─ Level 3: ${lvl3} USDT`,
    shareReferral: 'Share your link and earn commissions!',

    // Notifications
    newReferral: (username) => `🎉 New Referral! @${username} joined using your link!`,
    investmentCreated: (amount, crypto, plan) =>
      `✅ Investment created: ${amount} ${crypto} in ${plan}`,
    investmentCompleted: (amount, crypto) =>
      `💰 Investment completed! You earned ${amount} ${crypto}`,
    depositReceived: (amount, crypto) =>
      `💵 Deposit received: ${amount} ${crypto}`,
    withdrawalApproved: (amount, crypto) =>
      `✅ Withdrawal approved: ${amount} ${crypto}`,

    // Errors
    errorGeneric: '❌ An error occurred. Please try again.',
    errorNotFound: '❌ Not found.',
    errorInsufficient: '❌ Insufficient balance.',

    // Success
    successGeneric: '✅ Success!',
  },

  ru: {
    // Welcome & Start
    languageSelect: '🌍 Пожалуйста, выберите язык:',
    welcome: (name) => `👋 Добро пожаловать${name ? ' ' + name : ''}!\n\n💎 Ваша криптоинвестиционная платформа готова!`,
    languageSet: '✅ Язык установлен на Русский',
    languageChangeSuccess: '✅ Язык изменен на Русский',

    // Commands
    commandsTitle: 'Доступные команды:',
    cmdBalance: '/balance - Проверить баланс',
    cmdInvest: '/invest - Посмотреть инвестиционные планы',
    cmdMyInvest: '/myinvest - Посмотреть ваши инвестиции',
    cmdPnl: '/pnl - Посмотреть прибыль и убытки',
    cmdReferral: '/referral - Информация о рефералах',
    cmdLanguage: '/language - Изменить язык',
    useWebApp: 'Используйте веб-приложение для полного функционала! 🚀',

    // Buttons
    btnStartInvesting: '🚀 Начать инвестировать',
    btnBalance: '💰 Баланс',
    btnSupport: '💬 Поддержка',
    btnEnglish: '🇬🇧 English',
    btnRussian: '🇷🇺 Русский',
    btnSpanish: '🇪🇸 Español',

    // Balance
    balanceTitle: '💰 Ваши криптовалютные балансы',
    totalBalance: 'Общий баланс',

    // Investment Plans
    investmentPlansTitle: '📊 Инвестиционные планы',
    investmentInfo: (min, max, daily, hours) =>
      `💰 Сумма: ${min} - ${max}\n📈 Дневной доход: ${daily}%\n⏱ Длительность: ${hours} часов`,
    investNow: 'Инвестировать сейчас',

    // My Investments
    myInvestmentsTitle: '📊 Ваши активные инвестиции',
    noInvestments: 'У вас пока нет активных инвестиций.\nНачните инвестировать, чтобы получать пассивный доход!',
    investmentDetails: (amount, crypto, daily, end) =>
      `💰 Сумма: ${amount} ${crypto}\n📈 Дневной доход: ${daily}%\n⏰ Завершится: ${end}`,

    // PNL
    pnlTitle: '📊 Отчет о прибыли и убытках',
    earnings24h: 'Доход за 24ч',
    earnings7d: 'Доход за 7д',
    earnings30d: 'Доход за 30д',
    totalInvested: 'Всего инвестировано',
    activePlans: 'Активные планы',

    // Referral
    referralTitle: '🎁 Реферальная программа',
    referralCode: 'Ваш реферальный код',
    referralLink: 'Ваша реферальная ссылка',
    referralStats: (total, level1, level2, level3) =>
      `👥 Всего рефералов: ${total}\n├─ Уровень 1: ${level1}\n├─ Уровень 2: ${level2}\n└─ Уровень 3: ${level3}`,
    referralEarnings: (total, lvl1, lvl2, lvl3) =>
      `💰 Общий доход: ${total} USDT\n├─ Уровень 1: ${lvl1} USDT\n├─ Уровень 2: ${lvl2} USDT\n└─ Уровень 3: ${lvl3} USDT`,
    shareReferral: 'Поделитесь ссылкой и зарабатывайте комиссии!',

    // Notifications
    newReferral: (username) => `🎉 Новый реферал! @${username} присоединился по вашей ссылке!`,
    investmentCreated: (amount, crypto, plan) =>
      `✅ Инвестиция создана: ${amount} ${crypto} в ${plan}`,
    investmentCompleted: (amount, crypto) =>
      `💰 Инвестиция завершена! Вы заработали ${amount} ${crypto}`,
    depositReceived: (amount, crypto) =>
      `💵 Депозит получен: ${amount} ${crypto}`,
    withdrawalApproved: (amount, crypto) =>
      `✅ Вывод одобрен: ${amount} ${crypto}`,

    // Errors
    errorGeneric: '❌ Произошла ошибка. Пожалуйста, попробуйте снова.',
    errorNotFound: '❌ Не найдено.',
    errorInsufficient: '❌ Недостаточный баланс.',

    // Success
    successGeneric: '✅ Успешно!',
  },

  es: {
    // Welcome & Start
    languageSelect: '🌍 Por favor seleccione su idioma:',
    welcome: (name) => `👋 ¡Bienvenido${name ? ' ' + name : ''}!\n\n💎 ¡Tu plataforma de inversión en criptomonedas está lista!`,
    languageSet: '✅ Idioma configurado en Español',
    languageChangeSuccess: '✅ Idioma cambiado a Español',

    // Commands
    commandsTitle: 'Comandos Disponibles:',
    cmdBalance: '/balance - Ver tus saldos',
    cmdInvest: '/invest - Ver planes de inversión',
    cmdMyInvest: '/myinvest - Ver tus inversiones',
    cmdPnl: '/pnl - Ver ganancias y pérdidas',
    cmdReferral: '/referral - Información de referidos',
    cmdLanguage: '/language - Cambiar idioma',
    useWebApp: '¡Usa la aplicación web para todas las funciones! 🚀',

    // Buttons
    btnStartInvesting: '🚀 Comenzar a Invertir',
    btnBalance: '💰 Saldo',
    btnSupport: '💬 Soporte',
    btnEnglish: '🇬🇧 English',
    btnRussian: '🇷🇺 Русский',
    btnSpanish: '🇪🇸 Español',

    // Balance
    balanceTitle: '💰 Tus Saldos de Criptomonedas',
    totalBalance: 'Saldo Total',

    // Investment Plans
    investmentPlansTitle: '📊 Planes de Inversión',
    investmentInfo: (min, max, daily, hours) =>
      `💰 Monto: ${min} - ${max}\n📈 Retorno Diario: ${daily}%\n⏱ Duración: ${hours} horas`,
    investNow: 'Invertir Ahora',

    // My Investments
    myInvestmentsTitle: '📊 Tus Inversiones Activas',
    noInvestments: 'Aún no tienes inversiones activas.\n¡Comienza a invertir para obtener ingresos pasivos!',
    investmentDetails: (amount, crypto, daily, end) =>
      `💰 Monto: ${amount} ${crypto}\n📈 Retorno Diario: ${daily}%\n⏰ Finaliza: ${end}`,

    // PNL
    pnlTitle: '📊 Reporte de Ganancias y Pérdidas',
    earnings24h: 'Ganancias 24h',
    earnings7d: 'Ganancias 7d',
    earnings30d: 'Ganancias 30d',
    totalInvested: 'Total Invertido',
    activePlans: 'Planes Activos',

    // Referral
    referralTitle: '🎁 Programa de Referidos',
    referralCode: 'Tu Código de Referido',
    referralLink: 'Tu Enlace de Referido',
    referralStats: (total, level1, level2, level3) =>
      `👥 Total de Referidos: ${total}\n├─ Nivel 1: ${level1}\n├─ Nivel 2: ${level2}\n└─ Nivel 3: ${level3}`,
    referralEarnings: (total, lvl1, lvl2, lvl3) =>
      `💰 Ganancias Totales: ${total} USDT\n├─ Nivel 1: ${lvl1} USDT\n├─ Nivel 2: ${lvl2} USDT\n└─ Nivel 3: ${lvl3} USDT`,
    shareReferral: '¡Comparte tu enlace y gana comisiones!',

    // Notifications
    newReferral: (username) => `🎉 ¡Nuevo Referido! @${username} se unió usando tu enlace!`,
    investmentCreated: (amount, crypto, plan) =>
      `✅ Inversión creada: ${amount} ${crypto} en ${plan}`,
    investmentCompleted: (amount, crypto) =>
      `💰 ¡Inversión completada! Ganaste ${amount} ${crypto}`,
    depositReceived: (amount, crypto) =>
      `💵 Depósito recibido: ${amount} ${crypto}`,
    withdrawalApproved: (amount, crypto) =>
      `✅ Retiro aprobado: ${amount} ${crypto}`,

    // Errors
    errorGeneric: '❌ Ocurrió un error. Por favor, intenta de nuevo.',
    errorNotFound: '❌ No encontrado.',
    errorInsufficient: '❌ Saldo insuficiente.',

    // Success
    successGeneric: '✅ ¡Éxito!',
  }
};

/**
 * Get translations for a specific language
 */
export function getTranslation(lang) {
  return TRANSLATIONS[lang] || TRANSLATIONS.en;
}

/**
 * Get user's preferred language from database
 */
export async function getUserLanguage(supabase, telegramId) {
  const { data: user } = await supabase
    .from('users')
    .select('language_preference')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  return user?.language_preference || 'en';
}

/**
 * Set user's preferred language
 */
export async function setUserLanguage(supabase, telegramId, lang) {
  await supabase
    .from('users')
    .update({ language_preference: lang })
    .eq('telegram_id', telegramId);
}
