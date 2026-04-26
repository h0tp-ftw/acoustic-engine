"""Pure Python GUI for the Acoustic Engine Tuner using NiceGUI."""

import asyncio
import base64
import io
import os
import traceback
import matplotlib
matplotlib.use('Agg')  # Non-GUI backend for server-side stability
import matplotlib.pyplot as plt
import numpy as np
from nicegui import ui, events, app, run
from rich.console import Console
from rich.traceback import install as install_rich_traceback

from acoustic_engine.tuner.logic import TunerLogic

# Setup high-visibility terminal diagnostics
console = Console()
install_rich_traceback(console=console, show_locals=True)

class TunerGUI:
    def __init__(self):
        self.logic = TunerLogic()
        self.audio_data = None
        self.sample_rate = None
        self.filename = None
        
        # State
        self.analysis_result = None
        self.verified_matches = []
        
        # Audio Playback State
        self.audio_player = None
        self.playback_timer = None
        self.is_playing = False

    def setup_ui(self):
        """Build the NiceGUI layout."""
        ui.query('body').style('background-color: #0f172a; color: #f1f5f9; font-family: "Inter", sans-serif;')
        
        with ui.column().classes('w-full max-w-5xl mx-auto p-8 gap-8'):
            # Header
            with ui.row().classes('w-full items-center justify-between'):
                with ui.column():
                    ui.label('🔊 Acoustic Pro Tuner').classes('text-4xl font-extrabold tracking-tight text-white')
                    ui.label('Diagnostic-grade alarm pattern engineering').classes('text-slate-400 text-lg')
                
                with ui.card().classes('bg-slate-800/50 border-slate-700'):
                    with ui.row().classes('items-center gap-2 p-2'):
                        ui.icon('terminal', color='emerald').classes('text-xl')
                        ui.label('DIAGNOSTICS SYNCED').classes('text-emerald-500 font-mono text-xs font-bold tracking-widest')

            # Step 1: Upload
            with ui.card().classes('w-full bg-slate-800/30 border-slate-700 backdrop-blur-md'):
                ui.label('Phase 01: Source Acquisition').classes('text-xs font-bold tracking-widest text-slate-500 uppercase')
                
                self.upload = ui.upload(
                    label='Import WAV / Recording',
                    on_upload=self.handle_upload,
                    auto_upload=True,
                    max_files=1
                ).classes('w-full mt-4 h-32')
                
                self.file_info = ui.label('').classes('mt-2 text-emerald-400 font-mono text-sm')

            # Workspace (Logic Results)
            self.workspace = ui.column().classes('w-full gap-8').bind_visibility_from(self, 'audio_data', backward=lambda x: x is not None)
            
            with self.workspace:
                # Analysis Result
                with ui.card().classes('w-full bg-slate-800/30 border-slate-700'):
                    ui.label('Phase 02: Spectral Decomposition').classes('text-xs font-bold tracking-widest text-slate-500 uppercase')
                    
                    with ui.row().classes('w-full gap-8 mt-4'):
                        # Visualizer + Playhead
                        with ui.column().classes('flex-1 relative'):
                            self.plot_container = ui.interactive_image(
                                on_mouse=self.handle_seek
                            ).classes('w-full rounded-lg bg-black border border-slate-700')
                            
                            # Command Center Overhaul
                            with ui.row().classes('w-full items-center bg-slate-900/80 backdrop-blur-lg rounded-xl border border-slate-700 p-4 mt-4 gap-6'):
                                # Real-time Spectrum Analyzer (Minified)
                                with ui.column().classes('flex-1 h-32'):
                                    ui.label('Spectral Peak Analyzer').classes('text-[10px] text-slate-500 uppercase font-bold mb-1')
                                    self.spectrum_container = ui.interactive_image().classes('w-full h-full bg-black/50 rounded border border-slate-800')
                                
                                # High-Visibility Transport Controls
                                with ui.column().classes('items-center gap-2 px-4 border-l border-slate-700'):
                                    with ui.row().classes('gap-4'):
                                        self.play_btn = ui.button(icon='play_arrow', on_click=self.toggle_playback).props('fab color=emerald text-color=white size=md')
                                        self.stop_btn = ui.button(icon='replay', on_click=self.stop_playback).props('fab color=slate text-color=white size=md')
                                    
                                    self.play_time_label = ui.label('00:00 / 00:00').classes('font-mono text-xs text-emerald-400 font-bold bg-black/40 px-3 py-1 rounded-full')
                                    self.audio_player = ui.audio('').classes('hidden')
                        
                        # Stats / Proposed Profile
                        with ui.column().classes('w-64 gap-4'):
                            with ui.card().classes('bg-slate-900 w-full'):
                                ui.label('Detected Signature').classes('text-xs text-slate-400')
                                self.profile_name = ui.label('Pending...').classes('text-xl font-bold text-white')
                                
                                ui.separator().classes('bg-slate-700')
                                
                                with ui.row().classes('w-full justify-between'):
                                    ui.label('Confidence').classes('text-xs text-slate-500')
                                    ui.label('HIGH').classes('text-xs text-emerald-500 font-bold')
                            
                            self.analyze_btn = ui.button('Run Full Analysis', on_click=self.run_analysis).classes('w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl')

                # Detected Segments Table
                with ui.card().classes('w-full bg-slate-800/30 border-slate-700'):
                    ui.label('Detected Pattern Segments').classes('text-xs font-bold tracking-widest text-slate-500 uppercase mb-4')
                    self.segments_grid = ui.aggrid({
                        'columnDefs': [
                            {'headerName': 'Type', 'field': 'type', 'width': 100},
                            {'headerName': 'Freq (Hz)', 'field': 'freq', 'width': 150},
                            {'headerName': 'Duration (s)', 'field': 'duration', 'width': 150},
                        ],
                        'rowData': [],
                        'theme': 'ag-theme-alpine-dark'
                    }).classes('w-full h-64')

    async def handle_upload(self, e: events.UploadEventArguments):
        """Handle file upload and initial audio loading."""
        try:
            # Robust filename acquisition
            self.filename = getattr(e, 'name', getattr(e.file, 'name', getattr(e.file, 'filename', 'recording.wav')))
            
            # NiceGUI/Starlette UploadFile.read() is an async coroutine.
            # We must await it correctly to get the actual bytes.
            if hasattr(e.file, 'read'):
                content = e.file.read()
                if asyncio.iscoroutine(content):
                    content = await content
            elif hasattr(e, 'content'):
                content = e.content.read()
            else:
                raise ValueError("No readable content found in upload event")

            if not content or len(content) == 0:
                raise ValueError("Uploaded file is empty")

            # Offload heavy decoding to a worker thread to keep UI responsive
            msg = ui.notification("Decoding Source Data...", type='ongoing', spinner=True)
            try:
                self.audio_data, self.sample_rate = await run.io_bound(self.logic.load_audio, content)
            finally:
                msg.dismiss()
            
            duration = len(self.audio_data) / self.sample_rate
            self.file_info.set_text(f"Loaded: {self.filename} ({duration:.2f}s @ {self.sample_rate}Hz)")
            ui.notify(f"Source Acquisition Complete: {self.filename}", type='positive')
            
            # Offload plot generation to prevent UI stutter/timeouts
            await self.update_plot()

            # Prepare Audio Playback
            wav_bytes = self.logic.get_audio_wav_bytes(self.audio_data, self.sample_rate)
            encoded_wav = base64.b64encode(wav_bytes).decode('utf-8')
            self.audio_player.set_source(f"data:audio/wav;base64,{encoded_wav}")
            
            # Start sync timer (20fps)
            if self.playback_timer:
                self.playback_timer.activate()
            else:
                self.playback_timer = ui.timer(0.05, self.update_playhead, active=True)

        except Exception as e:
            self.handle_error(e)

    async def update_plot(self):
        """Generate and display a spectrogram using Matplotlib.
        
        Executed in a CPU-bound thread pool to avoid blocking the main event loop.
        """
        if self.audio_data is None:
            return

        def _generate_plot():
            plt.figure(figsize=(10, 4), dpi=100)
            plt.style.use('dark_background')
            
            # Cleanup audio data to prevent infs/nans in log calculation
            # Adding a tiny epsilon (1e-10) prevents 'divide by zero' warnings
            plot_data = self.audio_data.astype(np.float32)
            
            # Spectrogram
            plt.specgram(plot_data, Fs=self.sample_rate, NFFT=2048, noverlap=1024, cmap='magma')
            plt.title(f"Spectral Signature: {self.filename}", color='#94a3b8', fontsize=10)
            plt.xlabel("Time (s)", color='#64748b')
            plt.ylabel("Frequency (Hz)", color='#64748b')
            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format='png', transparent=True)
            plt.close()
            return base64.b64encode(buf.getvalue()).decode('utf-8')

        # Run the heavy plotting in a separate thread
        data = await run.io_bound(_generate_plot)
        self.plot_container.set_source(f"data:image/png;base64,{data}")
        # Reset playhead on image update
        self.update_playhead()

    def toggle_playback(self):
        """Toggle between play and pause."""
        if self.audio_data is None:
            return
        if self.is_playing:
            self.audio_player.pause()
            self.play_btn.props('icon=play_arrow')
        else:
            self.audio_player.play()
            self.play_btn.props('icon=pause')
        self.is_playing = not self.is_playing

    def stop_playback(self):
        """Stop playback and reset to beginning."""
        self.audio_player.pause()
        self.audio_player.seek(0)
        self.is_playing = False
        self.play_btn.props('icon=play_arrow')
        self.update_playhead()

    def handle_seek(self, e: events.MouseEventArguments):
        """Seek audio playback based on user click on the spectrogram."""
        if e.type != 'mousedown' or self.audio_data is None:
            return
        
        duration = len(self.audio_data) / self.sample_rate
        # Click position (e.image_x) is relative to image width (usually 0 to 1 in normalized coords)
        # Mouse events in NiceGUI interactive_image give normalized coordinates if not specified
        seek_time = e.image_x * duration
        self.audio_player.seek(seek_time)
        self.update_playhead()

    def update_playhead(self):
        """Update the visual playhead line position based on current audio time."""
        if self.audio_data is None:
            return
            
        current_time = getattr(self.audio_player, 'time', 0)
        duration = len(self.audio_data) / self.sample_rate
        # Label
        self.play_time_label.set_text(f"{current_time:05.2f} / {duration:05.2f}")
        
        # Calculate horizontal percentage
        progress = (current_time / duration) * 100 if duration > 0 else 0
        
        # Draw vertical line using SVG overlay
        # Stroke color is emerald/accent to stand out against magma spectrogram
        self.plot_container.content = f"""
            <line x1="{progress}%" y1="0" x2="{progress}%" y2="100%" 
                  stroke="#10b981" stroke-width="2" stroke-shadow="0 0 10px #10b981" />
        """
        # Trigger spectrum update in background
        asyncio.create_task(self.update_spectrum(current_time))

    async def update_spectrum(self, time: float):
        """Generate a zoomed frequency peak analysis at the current time."""
        if self.audio_data is None:
            return

        def _generate_spectrum():
            freqs, mags = self.logic.get_fft_at_time(self.audio_data, self.sample_rate, time)
            
            plt.figure(figsize=(6, 2), dpi=80)
            plt.style.use('dark_background')
            
            # Plot the spikes
            plt.plot(freqs, mags, color='#10b981', linewidth=1, alpha=0.9)
            plt.fill_between(freqs, -100, mags, color='#10b981', alpha=0.1)
            
            # Focus on human audible range for tuner work (0 - 8kHz)
            plt.xlim(0, 8000)
            plt.ylim(-60, 40) # dB range
            
            plt.axis('off')
            plt.tight_layout(pad=0)

            buf = io.BytesIO()
            plt.savefig(buf, format='png', transparent=True)
            plt.close()
            return base64.b64encode(buf.getvalue()).decode('utf-8')

        data = await run.io_bound(_generate_spectrum)
        self.spectrum_container.set_source(f"data:image/png;base64,{data}")

    async def run_analysis(self):
        """Execute the full engine analysis on the loaded audio."""
        if self.audio_data is None:
            return
            
        try:
            msg = ui.notification("Running Engine Analysis...", type='ongoing', spinner=True)
            try:
                self.analysis_result = await run.io_bound(self.logic.analyze_audio, self.audio_data, self.sample_rate)
            finally:
                msg.dismiss()
            
            self.profile_name.set_text(self.analysis_result.name)
            
            # Update grid
            rows = []
            for s in self.analysis_result.segments:
                freq_str = f"{s.get('freq_min', 0)} - {s.get('freq_max', 0)}" if s['type'] == 'tone' else '-'
                dur_str = f"{s['duration_min']} - {s['duration_max']}"
                rows.append({'type': s['type'].upper(), 'freq': freq_str, 'duration': dur_str})
            
            self.segments_grid.options['rowData'] = rows
            self.segments_grid.update()
            
            ui.notify("Engine Analysis Complete", type='positive')
            
            # Print to terminal for user visibility
            console.print(f"\n[bold emerald]>>> ENGINE SUCCESS[/bold emerald]")
            console.print(f"Profile Proposed: {self.analysis_result.name}")
            console.print(f"Segments Detected: {len(self.analysis_result.segments)}")
            console.print("-" * 40)
            
        except Exception as e:
            self.handle_error(e)

    def handle_error(self, e: Exception):
        """Catch-all for errors, mirroring them to the terminal."""
        ui.notify(f"ERROR: {str(e)}", type='negative', duration=10)
        
        # This is where we ensure maximum visibility in the terminal
        console.print("\n" + "!" * 80, style="bold red")
        console.print(f"!!! [GUI/LOGIC FAILURE] {type(e).__name__}", style="bold red")
        console.print(f"!!! Message: {str(e)}", style="bold red")
        console.print("-" * 80)
        traceback.print_exc()
        console.print("!" * 80 + "\n", style="bold red")

def start_gui(port: int = 8080):
    """Start the Tuner GUI."""
    
    @ui.page('/')
    def index():
        TunerGUI().setup_ui()

    ui.run(title='Acoustic Pro Tuner', port=port, dark=True, reload=False)

if __name__ in {"__main__", "__mp_main__"}:
    start_gui()
