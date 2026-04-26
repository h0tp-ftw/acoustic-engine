"""Pure Python tuner for creating and testing alarm profiles.

Powered by NiceGUI for a seamless, HTML-free experience.
Run with: python -m acoustic_engine.tuner
"""

import logging
import sys
import argparse

logger = logging.getLogger(__name__)

def main(port: int = 8080, open_browser: bool = True):
    """Start the Tuner GUI.

    Args:
        port: HTTP port to serve on (default 8080)
        open_browser: Whether to open a browser automatically (handled by NiceGUI)
    """
    print(">> Starting Acoustic Pro Tuner (Pure Python Edition)")
    print("   Diagnostic bridge initialized via Rich")
    print(f"   Target Port: {port}")
    print("-" * 40)
    
    # Run the GUI
    # Note: NiceGUI handles the browser opening automatically by default
    # but we can configure it in gui.py or here.
    try:
        from .gui import start_gui
        start_gui(port=port)
    except KeyboardInterrupt:
        print("\n👋 Tuner stopped by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Acoustic Engine Tuner")
    parser.add_argument(
        "-p", "--port", type=int, default=8080, help="Port to serve on (default: 8080)"
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable verbose logging"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="Don't open browser automatically"
    )

    args, unknown = parser.parse_known_args()
    if unknown:
        print(f"⚠️ Warning: Unknown arguments: {unknown}")
    
    main(port=args.port, open_browser=not args.no_browser)
