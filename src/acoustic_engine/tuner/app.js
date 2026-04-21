/**
 * Acoustic Tuner Framework: Core & Error Bridge
 */

(function initFramework() {
    console.log("🔊 Acoustic Tuner: Initializing Diagnostic Bridge");

    // --- ERROR BRIDGE ---
    const reportError = async (data) => {
        try {
            await fetch('/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch (e) {
            console.warn("Failed to report error to backend:", e);
        }
    };

    // Uncaught Exceptions
    window.onerror = function(msg, url, line, col, error) {
        reportError({
            type: 'uncaught',
            message: msg,
            url: url,
            line: line,
            col: col,
            stack: error ? error.stack : null
        });
        return false; // Let browser handle as well
    };

    // Unhandled Promises
    window.onunhandledrejection = function(event) {
        reportError({
            type: 'promise',
            message: event.reason?.message || String(event.reason),
            stack: event.reason?.stack
        });
    };

    // Console Error Proxy
    const originalConsoleError = console.error;
    console.error = function(...args) {
        reportError({
            type: 'console',
            message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
        });
        originalConsoleError.apply(console, args);
    };

    // --- CORE LOGIC ---
    // Framework is ready. User components will mount here.
    window.AcousticTuner = {
        state: {
            step: 1,
            audio: null,
            profile: null
        },
        
        async start() {
            console.log("Acoustic Tuner Ready.");
            // Initial render or setup
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        window.AcousticTuner.start();
    });

})();
