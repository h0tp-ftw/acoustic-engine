"""Web-based tuner for creating and testing alarm profiles.

Run with: python -m acoustic_engine.tuner
"""

import logging
import os
import sys
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse

from .api import router as api_router

logger = logging.getLogger(__name__)

def get_tuner_dir() -> Path:
    """Get the directory containing tuner files."""
    return Path(__file__).parent

app = FastAPI(title="Acoustic Engine Tuner API")

# Serve static files from the tuner directory
tuner_dir = get_tuner_dir()
app.mount("/static", StaticFiles(directory=str(tuner_dir)), name="static")

# Include the API routes
app.include_router(api_router, prefix="/api")

@app.get("/", response_class=HTMLResponse)
async def get_index():
    """Serve the main tuner interface."""
    index_path = tuner_dir / "index.html"
    return HTMLResponse(content=index_path.read_text(encoding="utf-8"))

@app.get("/{filename}")
async def get_root_files(filename: str):
    """Serve JS/CSS files from the root directory if they exist in tuner_dir."""
    file_path = tuner_dir / filename
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return HTMLResponse(status_code=404, content="File not found")

def main(port: int = 8080, open_browser: bool = True):
    """Start the tuner web server.

    Args:
        port: HTTP port to serve on (default 8080)
        open_browser: Whether to open a browser automatically
    """
    url = f"http://localhost:{port}"
    print("[SONG] Acoustic Engine Tuner (V2 - Pro)")
    print(f"   Environment: Python Backend (Actual Engine)")
    print(f"   Serving at: {url}")
    print("   Press Ctrl+C to stop")
    print()

    if open_browser:
        # Give the server a moment to start
        import threading
        import time
        def open_later():
            time.sleep(1.5)
            webbrowser.open(url)
        threading.Thread(target=open_later, daemon=True).start()

    try:
        uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
    except KeyboardInterrupt:
        print("\n👋 Tuner stopped")
        sys.exit(0)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Acoustic Engine Tuner")
    parser.add_argument(
        "-p", "--port", type=int, default=8080, help="Port to serve on (default: 8080)"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="Don't open browser automatically"
    )

    args = parser.parse_args()
    main(port=args.port, open_browser=not args.no_browser)
