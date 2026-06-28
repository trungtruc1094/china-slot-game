(function (globalScope) {
    "use strict";

    var defaultSdkUrl = "https://static.tevicdn.com/helper_tevi.js";
    var sdkScriptRequest = null;

    function getDocument() {
        if (globalScope.document) return globalScope.document;
        if (typeof document !== "undefined") return document;
        return null;
    }

    function getQueryValue(name) {
        if (!globalScope.location || !globalScope.location.search || typeof URLSearchParams === "undefined") return null;
        return new URLSearchParams(globalScope.location.search).get(name);
    }

    function asString(value) {
        return value === undefined || value === null ? "" : String(value);
    }

    function isExplicitTeviMode(config) {
        var queryTevi = getQueryValue("tevi");
        return globalScope.CHINA_SLOT_TEVI_MODE === true
            || config.enabled === true
            || config.mode === "tevi"
            || queryTevi === "1"
            || queryTevi === "true";
    }

    function resolveRuntimeConfig(options) {
        var configured = globalScope.CHINA_SLOT_TEVI_CONFIG || {};
        var overrides = options || {};
        var config = {
            enabled: overrides.enabled !== undefined ? overrides.enabled : configured.enabled,
            mode: overrides.mode || configured.mode,
            environment: overrides.environment || configured.environment || "local",
            appId: overrides.appId || configured.appId || globalScope.TEVI_APP_ID || "",
            channelId: overrides.channelId || configured.channelId || globalScope.TEVI_CHANNEL_ID || "",
            appUrl: overrides.appUrl || configured.appUrl || globalScope.TEVI_APP_URL || "",
            webhookUrl: overrides.webhookUrl || configured.webhookUrl || globalScope.TEVI_WEBHOOK_URL || "",
            sdkUrl: overrides.sdkUrl || configured.sdkUrl || defaultSdkUrl
        };

        return {
            enabled: isExplicitTeviMode(config),
            environment: asString(config.environment),
            appId: asString(config.appId),
            channelId: asString(config.channelId),
            appUrl: asString(config.appUrl),
            webhookUrl: asString(config.webhookUrl),
            sdkUrl: asString(config.sdkUrl || defaultSdkUrl)
        };
    }

    function getSdk() {
        return globalScope.TeviJS || null;
    }

    function unavailable(reason) {
        return { available: false, called: false, reason: reason };
    }

    function callSdkMethod(methodName) {
        var sdk = getSdk();
        if (!sdk) return unavailable("sdk-unavailable");
        if (typeof sdk[methodName] !== "function") return unavailable("method-unavailable");

        try {
            var value = sdk[methodName]();
            return { available: true, called: true, value: value };
        } catch (_error) {
            return unavailable("sdk-call-failed");
        }
    }

    function loadSdkScript(config) {
        if (!config.enabled) return Promise.resolve({ available: false, reason: "tevi-mode-disabled" });
        if (getSdk()) return Promise.resolve({ available: true, reason: "sdk-present" });

        var browserDocument = getDocument();
        if (!browserDocument || !browserDocument.createElement || !browserDocument.head) {
            return Promise.resolve({ available: false, reason: "document-unavailable" });
        }

        if (browserDocument.querySelector && browserDocument.querySelector('script[src="' + config.sdkUrl + '"]')) {
            return Promise.resolve({ available: true, reason: "sdk-script-present" });
        }

        if (sdkScriptRequest) return sdkScriptRequest;

        sdkScriptRequest = new Promise(function (resolve) {
            var script = browserDocument.createElement("script");
            script.async = true;
            script.src = config.sdkUrl;
            script.onload = function () { resolve({ available: true, reason: "sdk-script-loaded" }); };
            script.onerror = function () { resolve({ available: false, reason: "sdk-script-error" }); };
            browserDocument.head.appendChild(script);
        });

        return sdkScriptRequest;
    }

    function createClient(options) {
        var config = resolveRuntimeConfig(options);

        return {
            initialize: function () {
                return loadSdkScript(config).then(function (result) {
                    if (!result.available) return result;
                    callSdkMethod("showBackButton");
                    callSdkMethod("showCloseButton");
                    callSdkMethod("loadConfig");
                    return result;
                });
            },
            getState: function () {
                return {
                    mode: config.enabled ? "tevi" : "local",
                    environment: config.environment,
                    sdkAvailable: !!getSdk(),
                    appId: config.appId,
                    channelId: config.channelId,
                    appUrl: config.appUrl,
                    webhookUrl: config.webhookUrl
                };
            },
            isTeviMode: function () { return config.enabled; },
            isSdkAvailable: function () { return !!getSdk(); },
            showBackButton: function () { return callSdkMethod("showBackButton"); },
            showCloseButton: function () { return callSdkMethod("showCloseButton"); },
            loadConfig: function () { return callSdkMethod("loadConfig"); },
            close: function () {
                var quitResult = callSdkMethod("quitGame");
                if (quitResult.available) return quitResult;
                return callSdkMethod("close");
            }
        };
    }

    globalScope.ChinaSlotTeviClient = {
        createFromWindow: function (options) { return createClient(options || {}); },
        resolveRuntimeConfig: resolveRuntimeConfig
    };
})(typeof window !== "undefined" ? window : globalThis);