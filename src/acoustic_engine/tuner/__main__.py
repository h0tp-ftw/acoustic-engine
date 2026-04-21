"""Entry point for running the tuner as a module.

Usage: python -m acoustic_engine.tuner
"""

import argparse
from . import main

def cli():
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
    main(port=args.port, open_browser=not args.no_browser)

if __name__ == "__main__":
    cli()
