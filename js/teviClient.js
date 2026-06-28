(function (globalScope) {
    "use strict";

    var defaultSdkUrl = "https://static.tevicdn.com/helper_tevi.js";
    var defaultAppId = "AZX29173";
    var defaultChannelId = "2300210851";
    var defaultAppUrl = "https://chinareel.pleagamehub.com/";
    var defaultWebhookUrl = "https://china-slot-api.onrender.com/api/webhooks/tevi";
    var sdkScriptRequest = null;
    var debugPanelElement = null;

    function getDocument() {
        if (globalScope.document) return globalScope.document;
        if (typeof document !== "undefined") return document;
        return null;
    }

    function getQueryValue(name) {
        var browserLocation = globalScope.location || (typeof location !== "undefined" ? location : null);
        if (!browserLocation || !browserLocation.search || typeof URLSearchParams === "undefined") return null;
        return new URLSearchParams(browserLocation.search).get(name);
    }

    function isQueryFlagEnabled(name) {
        var value = getQueryValue(name);
        return value === "1" || value === "true";
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
            environment: overrides.environment || configured.environment || "",
            appId: overrides.appId || configured.appId || globalScope.TEVI_APP_ID || defaultAppId,
            channelId: overrides.channelId || configured.channelId || globalScope.TEVI_CHANNEL_ID || defaultChannelId,
            appUrl: overrides.appUrl || configured.appUrl || globalScope.TEVI_APP_URL || defaultAppUrl,
            webhookUrl: overrides.webhookUrl || configured.webhookUrl || globalScope.TEVI_WEBHOOK_URL || defaultWebhookUrl,
            sdkUrl: overrides.sdkUrl || configured.sdkUrl || defaultSdkUrl
        };
        var enabled = isExplicitTeviMode(config);

        return {
            enabled: enabled,
            environment: asString(enabled && config.environment === "local" ? "sandbox" : (config.environment || (enabled ? "sandbox" : "local"))),
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

        var script = browserDocument.createElement("script");
        var resolveRequest;
        var request;

        request = new Promise(function (resolve) {
            resolveRequest = resolve;
        });
        sdkScriptRequest = request;

        script.async = true;
        script.src = config.sdkUrl;
        script.onload = function () { resolveRequest({ available: true, reason: "sdk-script-loaded" }); };
        script.onerror = function () {
            sdkScriptRequest = null;
            resolveRequest({ available: false, reason: "sdk-script-error" });
        };
        browserDocument.head.appendChild(script);

        return request;
    }

    function renderDebugPanel(client) {
        if (!isQueryFlagEnabled("debugTevi")) return;

        var browserDocument = getDocument();
        if (!browserDocument || !browserDocument.createElement || !browserDocument.body) return;

        var existingPanel = debugPanelElement || (browserDocument.querySelector && browserDocument.querySelector("[data-china-slot-tevi-debug]"));
        var panel = existingPanel || browserDocument.createElement("pre");
        var state = client.getState();
        panel.textContent = [
            "China Slot Tevi Debug",
            "mode: " + state.mode,
            "environment: " + state.environment,
            "sdkAvailable: " + state.sdkAvailable,
            "appId: " + state.appId,
            "channelId: " + state.channelId,
            "appUrl: " + state.appUrl,
            "webhookUrl: " + state.webhookUrl
        ].join("\n");
        panel.setAttribute && panel.setAttribute("data-china-slot-tevi-debug", "true");
        panel.style.position = "fixed";
        panel.style.left = "8px";
        panel.style.bottom = "8px";
        panel.style.zIndex = "999999";
        panel.style.maxWidth = "calc(100vw - 16px)";
        panel.style.padding = "8px";
        panel.style.margin = "0";
        panel.style.border = "1px solid #2dd4bf";
        panel.style.borderRadius = "6px";
        panel.style.background = "rgba(0, 0, 0, 0.82)";
        panel.style.color = "#e6fffb";
        panel.style.font = "12px monospace";
        panel.style.whiteSpace = "pre-wrap";
        panel.style.pointerEvents = "none";

        if (!existingPanel) browserDocument.body.appendChild(panel);
        debugPanelElement = panel;
    }

    function createClient(options) {
        var config = resolveRuntimeConfig(options);
        var client;

        client = {
            initialize: function () {
                renderDebugPanel(client);
                return loadSdkScript(config).then(function (result) {
                    if (!result.available) return result;
                    callSdkMethod("showBackButton");
                    callSdkMethod("showCloseButton");
                    callSdkMethod("loadConfig");
                    renderDebugPanel(client);
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

        return client;
    }

    globalScope.ChinaSlotTeviClient = {
        createFromWindow: function (options) { return createClient(options || {}); },
        resolveRuntimeConfig: resolveRuntimeConfig
    };
})(typeof window !== "undefined" ? window : globalThis);