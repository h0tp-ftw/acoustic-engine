/**
 * Acoustic Tuner: Step 1 Logic (Audio & Interaction)
 */

(function initStep1() {
    console.log("🔊 Step 1: Initializing Audio Engine");

    const state = {
        audioContext: new (window.AudioContext || window.webkitAudioContext)(),
        audioBuffer: null,
        sourceNode: null,
        startTime: 0, // for playback
        offset: 0,    // where we started
        lastStartedAt: 0,
        isPlaying: false,
        cropStart: 0,
        cropEnd: 1.0,
        duration: 0
    };

    const ui = {
        dropzone: document.getElementById('dropzone'),
        fileInput: document.getElementById('fileInput'),
        workspace: document.getElementById('analyserWorkspace'),
        canvas: document.getElementById('spectrogramCanvas'),
        scrubber: document.getElementById('scrubber'),
        cropOverlay: document.getElementById('cropOverlay'),
        playBtn: document.getElementById('playBtn'),
        stopBtn: document.getElementById('stopBtn'),
        cropBtn: document.getElementById('cropBtn'),
        currentTimeTxt: document.getElementById('currentTime'),
        totalTimeTxt: document.getElementById('totalTime')
    };

    // --- SETUP ---
    ui.dropzone.onclick = () => ui.fileInput.click();
    ui.fileInput.onchange = (e) => handleFile(e.target.files[0]);

    ui.dropzone.ondragover = (e) => { e.preventDefault(); ui.dropzone.classList.add('hover'); };
    ui.dropzone.ondragleave = () => ui.dropzone.classList.remove('hover');
    ui.dropzone.ondrop = (e) => {
        e.preventDefault();
        ui.dropzone.classList.remove('hover');
        handleFile(e.dataTransfer.files[0]);
    };

    async function handleFile(file) {
        if (!file) return;
        console.log(`[FILE] Selected: ${file.name} (${file.size} bytes)`);
        
        try {
            console.log("[AUDIO] Starting ArrayBuffer load...");
            const arrayBuffer = await file.arrayBuffer();
            
            // Ensure context is active (browsers often suspend until user gesture)
            if (state.audioContext.state === 'suspended') {
                console.log("[AUDIO] Context suspended, attempting to resume...");
                await state.audioContext.resume();
                console.log(`[AUDIO] Context state: ${state.audioContext.state}`);
            }

            // Quick bit-depth check for WAV files (at offset 34)
            const view = new DataView(arrayBuffer);
            if (view.getUint32(0) === 0x52494646) { // "RIFF"
                const bitDepth = view.getUint16(34, true);
                console.log(`[FILE] WAV Bit Depth: ${bitDepth}-bit`);
                if (bitDepth !== 16 && bitDepth !== 32) {
                    console.warn(`[DIAG] Warning: ${bitDepth}-bit WAVs may fail in some browsers. 16-bit or 32-bit float recommended.`);
                }
            }

            console.log("[AUDIO] Starting decoding...");
            state.audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
            state.duration = state.audioBuffer.duration;
            console.log(`[AUDIO] Decoded successfully. Duration: ${state.duration.toFixed(2)}s`);
            
            ui.totalTimeTxt.innerText = formatTime(state.duration);
            ui.workspace.style.display = 'block';
            ui.dropzone.style.display = 'none';
            
            // Forced reflow to ensure canvas dimensions are ready
            console.log("[VISUAL] Initializing spectrogram render...");
            ui.canvas.width = ui.canvas.offsetWidth;
            ui.canvas.height = ui.canvas.offsetHeight;
            
            console.log(`[VISUAL] Canvas dimensions: ${ui.canvas.width}x${ui.canvas.height}`);
            if (ui.canvas.width === 0) {
                console.error("[VISUAL] Canvas width is 0! Workspace may not be visible.");
            }

            await window.Visualizer.renderSpectrogram(ui.canvas, state.audioBuffer);
            console.log("[VISUAL] Render complete.");
            
        } catch (error) {
            console.error(`[FATAL] handleFile failed: ${error.message}`);
            console.error(error.stack);
        }
    }

    // --- TRANSPORT ---
    ui.playBtn.onclick = () => state.isPlaying ? pause() : play();
    ui.stopBtn.onclick = () => stop();

    function play() {
        if (!state.audioBuffer || state.isPlaying) return;
        
        const cropStartSec = state.cropStart * state.duration;
        const cropEndSec = state.cropEnd * state.duration;

        state.sourceNode = state.audioContext.createBufferSource();
        state.sourceNode.buffer = state.audioBuffer;
        state.sourceNode.connect(state.audioContext.destination);
        
        // Start from the current offset, or the cropStart if offset is 0
        const startOffset = Math.max(cropStartSec, state.offset || cropStartSec);
        
        // Safety: if we are already past the end, go back to start
        if (startOffset >= cropEndSec) {
            state.offset = cropStartSec;
            play();
            return;
        }

        state.sourceNode.start(0, startOffset);
        state.lastStartedAt = state.audioContext.currentTime;
        state.isPlaying = true;
        ui.playBtn.innerText = '⏸';
        
        console.log(`[TRANSPORT] Playing selection: ${startOffset.toFixed(2)}s - ${cropEndSec.toFixed(2)}s`);
        requestAnimationFrame(updateLoop);
    }

    function pause() {
        if (!state.isPlaying) return;
        state.sourceNode.stop();
        state.offset += state.audioContext.currentTime - state.lastStartedAt;
        state.isPlaying = false;
        ui.playBtn.innerText = '▶';
    }

    function stop() {
        if (state.sourceNode) {
            try { state.sourceNode.stop(); } catch(e) {}
        }
        state.offset = state.cropStart * state.duration;
        state.isPlaying = false;
        ui.playBtn.innerText = '▶';
        updateUI();
    }

    function updateLoop() {
        if (!state.isPlaying) return;
        
        const elapsed = state.audioContext.currentTime - state.lastStartedAt;
        const currentPos = state.offset + elapsed;
        const cropEndSec = state.cropEnd * state.duration;
        
        if (currentPos >= cropEndSec) {
            console.log("[TRANSPORT] Selection end reached.");
            stop();
            return;
        }
        
        updateUI(currentPos);
        requestAnimationFrame(updateLoop);
    }

    function updateUI(currentPos = state.offset) {
        const cropStartSec = state.cropStart * state.duration;
        const cropEndSec = state.cropEnd * state.duration;
        const selectionDuration = cropEndSec - cropStartSec;
        
        // Scrubber is absolute relative to whole file for visual sync
        const progress = currentPos / state.duration;
        window.Visualizer.drawScrubber(ui.scrubber, progress);
        
        // Time display is RELATIVE to crop
        const relativePos = Math.max(0, currentPos - cropStartSec);
        ui.currentTimeTxt.innerText = formatTime(relativePos);
        ui.totalTimeTxt.innerText = formatTime(selectionDuration);
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = (seconds % 60).toFixed(1);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(4, '0')}`;
    }

    // --- INTERACTION (Seeking & Cropping) ---
    const visualWrapper = document.querySelector('.visual-wrapper');
    visualWrapper.onclick = (e) => {
        if (e.target.classList.contains('crop-handle')) return;
        const rect = visualWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const progress = x / rect.width;
        
        const wasPlaying = state.isPlaying;
        if (wasPlaying) pause();
        state.offset = progress * state.duration;
        updateUI();
        if (wasPlaying) play();
    };

    // DRAGGABLE CROP HANDLES
    let isDragging = null;
    visualWrapper.onmousedown = (e) => {
        if (e.target.classList.contains('start')) isDragging = 'start';
        if (e.target.classList.contains('end')) isDragging = 'end';
    };

    window.onmousemove = (e) => {
        if (!isDragging) return;
        const rect = visualWrapper.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const progress = x / rect.width;
        
        if (isDragging === 'start') state.cropStart = Math.min(progress, state.cropEnd - 0.01);
        if (isDragging === 'end') state.cropEnd = Math.max(progress, state.cropStart + 0.01);
        
        const cropStartSec = state.cropStart * state.duration;
        const cropEndSec = state.cropEnd * state.duration;
        
        // Update offset so playback starts from new start
        if (isDragging === 'start') state.offset = cropStartSec;

        window.Visualizer.drawCropOverlay(ui.cropOverlay, state.cropStart, state.cropEnd);
        updateUI(); // Immediate feedback for duration
    };

    window.onmouseup = () => isDragging = null;

    // --- CROP ACTION ---
    ui.cropBtn.onclick = async () => {
        if (!state.audioBuffer) return;
        
        const startSample = Math.floor(state.cropStart * state.audioBuffer.length);
        const endSample = Math.floor(state.cropEnd * state.audioBuffer.length);
        const numSamples = endSample - startSample;
        
        const newBuffer = state.audioContext.createBuffer(
            state.audioBuffer.numberOfChannels,
            numSamples,
            state.audioBuffer.sampleRate
        );
        
        for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel++) {
            const oldData = state.audioBuffer.getChannelData(channel);
            const newData = newBuffer.getChannelData(channel);
            for (let i = 0; i < numSamples; i++) {
                newData[i] = oldData[startSample + i];
            }
        }
        
        // Update app state with cropped buffer
        state.audioBuffer = newBuffer;
        state.duration = newBuffer.duration;
        state.offset = 0;
        state.cropStart = 0;
        state.cropEnd = 1.0;
        
        ui.totalTimeTxt.innerText = formatTime(state.duration);
        window.Visualizer.drawCropOverlay(ui.cropOverlay, 0, 1.0);
        stop();
        
        console.log("✂️ Audio Cropped. Ready for Phase 02.");
        await window.Visualizer.renderSpectrogram(ui.canvas, state.audioBuffer);
        
        // Trigger Phase 02 reveal logic here...
    };

})();
