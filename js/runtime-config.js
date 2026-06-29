(function (globalScope) {
    "use strict";

    globalScope.CHINA_SLOT_API_BASE_URL = globalScope.CHINA_SLOT_API_BASE_URL || "https://china-slot-api.onrender.com";

    var teviConfig = globalScope.CHINA_SLOT_TEVI_CONFIG || {};
    var teviModeEnabled = globalScope.CHINA_SLOT_TEVI_MODE === true || teviConfig.enabled === true;

    globalScope.CHINA_SLOT_TEVI_MODE = teviModeEnabled;
    globalScope.CHINA_SLOT_TEVI_CONFIG = {
        enabled: teviModeEnabled,
        environment: teviConfig.environment || "local",
        appId: teviConfig.appId || globalScope.TEVI_APP_ID || "AZX29173",
        channelId: teviConfig.channelId || globalScope.TEVI_CHANNEL_ID || "2300210851",
        appUrl: teviConfig.appUrl || globalScope.TEVI_APP_URL || "https://chinareel.pleagamehub.com/",
        webhookUrl: teviConfig.webhookUrl || globalScope.TEVI_WEBHOOK_URL || "https://china-slot-api.onrender.com/api/webhooks/tevi",
        sdkUrl: teviConfig.sdkUrl || "https://static.tevicdn.com/helper_tevi.js",
        // Non-secret display values only. Authoritative deposit limits live in the backend;
        // maxStars is a client-side UX guard, not an enforcement boundary.
        topup: {
            presets: (teviConfig.topup && teviConfig.topup.presets) || [50, 100, 250, 500],
            maxStars: (teviConfig.topup && teviConfig.topup.maxStars) || 100000
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
