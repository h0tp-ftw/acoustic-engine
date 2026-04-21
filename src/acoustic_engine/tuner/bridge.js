/**
 * [ISOLATED] Diagnostic Bridge
 * Loads before everything else to catch initialization errors.
 */

(function initDiagnosticBridge() {
    const originalConsoleError = console.error;
    const bridgeUrl = '/api/log';

    console.log("[DIAG] Diagnostic Bridge Initializing...");

    const report = (data) => {
        const payload = JSON.stringify({
            type: data.type || 'error',
            message: data.message ? String(data.message) : 'Unknown Error',
            stack: data.stack || new Error().stack,
            url: data.url || window.location.href,
            line: data.line,
            col: data.col
        });

        // Use XHR for maximum safety during early load
        const xhr = new XMLHttpRequest();
        xhr.open('POST', bridgeUrl, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
    };

    window.onerror = function(msg, url, line, col, error) {
        report({ type: 'uncaught', message: msg, url, line, col, stack: error ? error.stack : null });
        return false;
    };

    window.onunhandledrejection = function(event) {
        report({
            type: 'promise_rejection',
            message: event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled Promise Rejection',
            stack: event.reason ? event.reason.stack : null
        });
    };

    console.error = function(...args) {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        report({ type: 'console_error', message: msg });
        originalConsoleError.apply(console, args);
    };

    // Heartbeat Signal
    report({ type: 'system', message: 'Diagnostic Bridge Connected & Active' });
    console.log("[DIAG] Diagnostic Bridge Active.");
})();
