/**
 * Audio Engine - Handles recording, playback, sound generation, and analysis.
 * Enhanced with upload/download capabilities and improved frequency analysis.
 */

class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.analyser = null;
        this.recordedChunks = [];
        this.recordedBuffer = null;
        this.recordedBlob = null;  // Store the raw blob for download
        this.isRecording = false;
        this.startTime = 0;
        
        // Analysis settings - configurable by user
        this.fftSize = 2048;  // Default: ~46ms resolution at 44100Hz
        
        // Frequency analysis cache
        this.frequencyAnalysis = null;
    }

    /**
     * Set the FFT size for frequency analysis
     * @param {number} size - FFT size (must be power of 2: 512, 1024, 2048, 4096)
     */
    setFFTSize(size) {
        const validSizes = [512, 1024, 2048, 4096];
        if (validSizes.includes(size)) {
            this.fftSize = size;
            console.log(`FFT size set to ${size} (~${Math.round(size / 44100 * 1000)}ms resolution)`);
        } else {
            console.warn(`Invalid FFT size: ${size}. Must be one of: ${validSizes.join(', ')}`);
        }
    }

    /**
     * Get the current FFT size
     * @returns {number} Current FFT size
     */
    getFFTSize() {
        return this.fftSize;
    }

    /**
     * Get the approximate time resolution in milliseconds
     * @returns {number} Resolution in ms
     */
    getResolutionMs() {
        return Math.round(this.fftSize / 44100 * 1000);
    }

    async init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    async startRecording() {
        if (!this.audioContext) await this.init();
        
        // Resume context if suspended (browser autoplay policy)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.recordedChunks = [];
        this.frequencyAnalysis = null;
        
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Create analyser for visualization
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);
            
            // Setup MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.mediaStream);
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };
            
            this.mediaRecorder.onstop = async () => {
                this.recordedBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                const arrayBuffer = await this.recordedBlob.arrayBuffer();
                this.recordedBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                
                // Perform full frequency analysis on the recorded audio
                this._performFrequencyAnalysis();
            };

            this.mediaRecorder.start(100); // Collect data every 100ms
            this.isRecording = true;
            this.startTime = Date.now();
            
            return true;
        } catch (err) {
            console.error('Error starting recording:', err);
            return false;
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.isRecording = false;
        }
    }

    /**
     * Download the recorded audio as a file
     * @param {string} filename - Optional filename
     * @returns {boolean} Success
     */
    downloadRecording(filename = 'alarm_recording') {
        if (!this.recordedBlob) {
            return false;
        }
        
        const url = URL.createObjectURL(this.recordedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        
        return true;
    }

    /**
     * Upload and load an audio file
     * @param {File} file - Audio file to load
     * @returns {Promise<Object>} Result object with success and optional error message
     */
    async uploadAudio(file) {
        if (!this.audioContext) await this.init();
        
        // Resume context if suspended
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        try {
            console.log(`Loading audio file: ${file.name} (${file.type}, ${file.size} bytes)`);
            
            const arrayBuffer = await file.arrayBuffer();
            console.log(`ArrayBuffer loaded: ${arrayBuffer.byteLength} bytes`);
            
            // Use a promise wrapper for decodeAudioData for better compatibility
            // Some browsers need the callback-based approach
            this.recordedBuffer = await new Promise((resolve, reject) => {
                // Create a copy of the buffer since decodeAudioData detaches it
                const bufferCopy = arrayBuffer.slice(0);
                
                this.audioContext.decodeAudioData(
                    bufferCopy,
                    (buffer) => {
                        console.log(`Audio decoded: ${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz`);
                        resolve(buffer);
                    },
                    (error) => {
                        console.error('decodeAudioData error:', error);
                        reject(new Error(`Failed to decode audio: ${error?.message || 'Unknown format or corrupted file'}`));
                    }
                );
            });
            
            this.recordedBlob = file;
            
            // Perform frequency analysis
            this._performFrequencyAnalysis();
            
            return { success: true };
        } catch (err) {
            console.error('Error loading audio file:', err);
            return { success: false, error: err.message || 'Unknown error' };
        }
    }

    playRecording() {
        if (!this.recordedBuffer) return null;
        
        // Create analyser for playback visualization
        if (!this.playbackAnalyser) {
            this.playbackAnalyser = this.audioContext.createAnalyser();
            this.playbackAnalyser.fftSize = 2048;
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = this.recordedBuffer;
        
        // Route through analyser for visualization
        source.connect(this.playbackAnalyser);
        this.playbackAnalyser.connect(this.audioContext.destination);
        
        // Track playback state
        this.isPlaying = true;
        this.playbackStartTime = Date.now();
        this.playbackDuration = this.recordedBuffer.duration;
        
        source.onended = () => {
            this.isPlaying = false;
        };
        
        source.start();
        
        return {
            duration: this.recordedBuffer.duration,
            source: source
        };
    }

    getAnalyserData() {
        // Use playback analyser if playing, otherwise use recording analyser
        const analyser = this.isPlaying ? this.playbackAnalyser : this.analyser;
        if (!analyser) return null;
        
        const bufferLength = analyser.frequencyBinCount;
        const timeData = new Uint8Array(bufferLength);
        const freqData = new Uint8Array(bufferLength);
        
        analyser.getByteTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);
        
        return { timeData, freqData, bufferLength };
    }

    getRecordingDuration() {
        if (this.isPlaying) {
            return (Date.now() - this.playbackStartTime) / 1000;
        }
        if (!this.isRecording) return 0;
        return (Date.now() - this.startTime) / 1000;
    }
    
    getPlaybackProgress() {
        if (!this.isPlaying || !this.playbackDuration) return null;
        const elapsed = (Date.now() - this.playbackStartTime) / 1000;
        return {
            elapsed: elapsed,
            total: this.playbackDuration,
            progress: Math.min(elapsed / this.playbackDuration, 1)
        };
    }
    
    getRecordedDuration() {
        if (!this.recordedBuffer) return 0;
        return this.recordedBuffer.duration;
    }
    
    /**
     * Get the recorded audio as a Blob for download.
     * @returns {Blob|null} The recorded audio blob, or null if no recording exists.
     */
    getRecordingBlob() {
        if (this.recordedChunks.length === 0) return null;
        return new Blob(this.recordedChunks, { type: 'audio/webm' });
    }

    hasRecording() {
        return this.recordedBuffer !== null;
    }

    /**
     * Crop the recorded audio to a specific time range
     * @param {number} startTime - Start time in seconds
     * @param {number} endTime - End time in seconds
     * @returns {boolean} Success
     */
    cropAudio(startTime, endTime) {
        if (!this.recordedBuffer) return false;
        
        const sampleRate = this.recordedBuffer.sampleRate;
        const numChannels = this.recordedBuffer.numberOfChannels;
        
        // Convert times to sample indices
        const startSample = Math.floor(startTime * sampleRate);
        const endSample = Math.floor(endTime * sampleRate);
        const newLength = endSample - startSample;
        
        if (newLength <= 0 || startSample < 0 || endSample > this.recordedBuffer.length) {
            console.error('Invalid crop range');
            return false;
        }
        
        // Create new buffer with cropped audio
        const newBuffer = this.audioContext.createBuffer(
            numChannels,
            newLength,
            sampleRate
        );
        
        // Copy data for each channel
        for (let channel = 0; channel < numChannels; channel++) {
            const oldData = this.recordedBuffer.getChannelData(channel);
            const newData = newBuffer.getChannelData(channel);
            
            for (let i = 0; i < newLength; i++) {
                newData[i] = oldData[startSample + i];
            }
        }
        
        this.recordedBuffer = newBuffer;
        
        // Re-analyze the cropped audio
        this._performFrequencyAnalysis();
        
        return true;
    }

    /**
     * Get the cached frequency analysis data
     * @returns {Object|null} Frequency analysis data
     */
    getFrequencyAnalysis() {
        return this.frequencyAnalysis;
    }

    /**
     * Query how long a specific frequency was present in the recording
     * @param {number} targetFreq - Target frequency in Hz
     * @param {number} tolerance - Tolerance in Hz (±)
     * @returns {Object} Query results
     */
    queryFrequency(targetFreq, tolerance = 100) {
        if (!this.frequencyAnalysis) {
            return { error: 'No audio analyzed yet' };
        }

        const { timeline, sampleRate, totalDuration } = this.frequencyAnalysis;
        
        const minFreq = targetFreq - tolerance;
        const maxFreq = targetFreq + tolerance;
        
        // Find all time windows where the target frequency was dominant
        const presenceWindows = [];
        let currentWindow = null;
        
        for (const frame of timeline) {
            const inRange = frame.peakFrequencies.some(f => f >= minFreq && f <= maxFreq);
            
            if (inRange) {
                if (!currentWindow) {
                    currentWindow = { start: frame.time, end: frame.time + frame.duration };
                } else {
                    currentWindow.end = frame.time + frame.duration;
                }
            } else {
                if (currentWindow) {
                    presenceWindows.push(currentWindow);
                    currentWindow = null;
                }
            }
        }
        
        // Close any remaining window
        if (currentWindow) {
            presenceWindows.push(currentWindow);
        }
        
        // Calculate statistics
        const totalPresenceDuration = presenceWindows.reduce((sum, w) => sum + (w.end - w.start), 0);
        const averageWindowDuration = presenceWindows.length > 0 
            ? totalPresenceDuration / presenceWindows.length 
            : 0;
        
        return {
            targetFreq,
            tolerance,
            totalDuration,
            presenceWindows,
            totalPresenceDuration,
            presencePercentage: (totalPresenceDuration / totalDuration) * 100,
            windowCount: presenceWindows.length,
            averageWindowDuration
        };
    }

    /**
     * Perform detailed frequency analysis on the recorded audio.
     * This generates a timeline of dominant frequencies for visualization.
     * Uses configurable this.fftSize for resolution control.
     */
    _performFrequencyAnalysis() {
        if (!this.recordedBuffer) return;
        
        const audioData = this.recordedBuffer.getChannelData(0);
        const sampleRate = this.recordedBuffer.sampleRate;
        const fftSize = this.fftSize;  // Use configurable FFT size
        const hopSize = fftSize / 4;  // 75% overlap for smooth timeline
        
        const timeline = [];
        const totalDuration = audioData.length / sampleRate;
        
        // Process audio in overlapping windows
        for (let i = 0; i < audioData.length - fftSize; i += hopSize) {
            const window = audioData.slice(i, i + fftSize);
            const time = i / sampleRate;
            
            // Apply Hamming window
            const windowed = new Float32Array(fftSize);
            for (let j = 0; j < fftSize; j++) {
                windowed[j] = window[j] * (0.54 - 0.46 * Math.cos(2 * Math.PI * j / (fftSize - 1)));
            }
            
            // Compute FFT using simple DFT (for small enough windows)
            const spectrum = this._computeSpectrum(windowed, sampleRate);
            
            // Find peak frequencies (top 3)
            const peaks = this._findPeakFrequencies(spectrum, sampleRate, fftSize, 3);
            
            // Calculate RMS for amplitude
            let rms = 0;
            for (let j = 0; j < window.length; j++) {
                rms += window[j] * window[j];
            }
            rms = Math.sqrt(rms / window.length);
            
            timeline.push({
                time,
                duration: hopSize / sampleRate,
                peakFrequencies: peaks.map(p => p.frequency),
                peakAmplitudes: peaks.map(p => p.amplitude),
                rms,
                spectrum: spectrum.slice(0, 256)  // Keep lower frequencies for visualization
            });
        }
        
        this.frequencyAnalysis = {
            timeline,
            sampleRate,
            totalDuration,
            fftSize
        };
    }

    /**
     * Compute magnitude spectrum using efficient Cooley-Tukey FFT
     * O(n log n) complexity instead of O(n²) DFT
     */
    _computeSpectrum(windowed, sampleRate) {
        const n = windowed.length;
        
        // Prepare complex arrays for FFT
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        
        for (let i = 0; i < n; i++) {
            real[i] = windowed[i];
            imag[i] = 0;
        }
        
        // In-place Cooley-Tukey FFT
        this._fft(real, imag);
        
        // Compute magnitude spectrum (only need first half due to symmetry)
        const spectrum = new Float32Array(n / 2);
        for (let k = 0; k < n / 2; k++) {
            spectrum[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) / n;
        }
        
        return spectrum;
    }

    /**
     * In-place Cooley-Tukey FFT (radix-2)
     * Operates on complex arrays (real, imag) of power-of-2 length
     */
    _fft(real, imag) {
        const n = real.length;
        
        // Bit-reversal permutation
        let j = 0;
        for (let i = 0; i < n - 1; i++) {
            if (i < j) {
                // Swap real[i] with real[j]
                let temp = real[i];
                real[i] = real[j];
                real[j] = temp;
                // Swap imag[i] with imag[j]
                temp = imag[i];
                imag[i] = imag[j];
                imag[j] = temp;
            }
            let k = n >> 1;
            while (k <= j) {
                j -= k;
                k >>= 1;
            }
            j += k;
        }
        
        // Cooley-Tukey iterative FFT
        for (let len = 2; len <= n; len <<= 1) {
            const halfLen = len >> 1;
            const angleStep = -2 * Math.PI / len;
            
            for (let i = 0; i < n; i += len) {
                let angle = 0;
                for (let k = 0; k < halfLen; k++) {
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    
                    const evenIdx = i + k;
                    const oddIdx = i + k + halfLen;
                    
                    const tReal = cos * real[oddIdx] - sin * imag[oddIdx];
                    const tImag = sin * real[oddIdx] + cos * imag[oddIdx];
                    
                    real[oddIdx] = real[evenIdx] - tReal;
                    imag[oddIdx] = imag[evenIdx] - tImag;
                    real[evenIdx] = real[evenIdx] + tReal;
                    imag[evenIdx] = imag[evenIdx] + tImag;
                    
                    angle += angleStep;
                }
            }
        }
    }

    /**
     * Find peak frequencies in the spectrum
     */
    _findPeakFrequencies(spectrum, sampleRate, fftSize, count = 3) {
        const freqResolution = sampleRate / fftSize;
        const peaks = [];
        
        // Find local maxima above a threshold
        const threshold = Math.max(...spectrum) * 0.1;
        
        for (let i = 2; i < spectrum.length - 2; i++) {
            if (spectrum[i] > threshold &&
                spectrum[i] > spectrum[i - 1] &&
                spectrum[i] > spectrum[i + 1] &&
                spectrum[i] > spectrum[i - 2] &&
                spectrum[i] > spectrum[i + 2]) {
                peaks.push({
                    frequency: i * freqResolution,
                    amplitude: spectrum[i],
                    bin: i
                });
            }
        }
        
        // Sort by amplitude and take top N
        peaks.sort((a, b) => b.amplitude - a.amplitude);
        return peaks.slice(0, count);
    }

    /**
     * Generate a sample sound based on an AlarmProfile definition.
     * @param {Array} segments - Array of segment objects
     * @param {number} cycles - Number of times to repeat the pattern
     * @returns {Object} Buffer and event timeline for visualization sync
     */
    generateSound(segments, cycles = 1) {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const sampleRate = this.audioContext.sampleRate;
        let totalDuration = 0;
        
        // Build event timeline for visualization sync
        const eventTimeline = [];
        
        // Calculate total duration and build timeline
        let currentTime = 0;
        for (let c = 0; c < cycles; c++) {
            for (const seg of segments) {
                // Use midpoint of duration range
                const dur = (seg.durationMin + seg.durationMax) / 2;
                const avgFreq = seg.type === 'tone' ? (seg.freqMin + seg.freqMax) / 2 : 0;
                
                eventTimeline.push({
                    type: seg.type,
                    startTime: currentTime,
                    duration: dur,
                    frequency: avgFreq
                });
                
                currentTime += dur;
                totalDuration += dur;
            }
        }
        
        // Create buffer
        const buffer = this.audioContext.createBuffer(1, Math.ceil(sampleRate * totalDuration), sampleRate);
        const data = buffer.getChannelData(0);
        
        let sampleIndex = 0;
        
        for (let c = 0; c < cycles; c++) {
            for (const seg of segments) {
                // Use midpoint duration for consistent sync
                const duration = (seg.durationMin + seg.durationMax) / 2;
                const numSamples = Math.floor(sampleRate * duration);
                
                if (seg.type === 'tone') {
                    // Use midpoint frequency for consistent sync
                    const freq = (seg.freqMin + seg.freqMax) / 2;
                    
                    for (let i = 0; i < numSamples && sampleIndex < data.length; i++) {
                        // Simple sine wave with envelope
                        const t = i / sampleRate;
                        const envelope = Math.min(1, Math.min(i / (sampleRate * 0.01), (numSamples - i) / (sampleRate * 0.01)));
                        data[sampleIndex++] = Math.sin(2 * Math.PI * freq * t) * 0.5 * envelope;
                    }
                } else {
                    // Silence
                    for (let i = 0; i < numSamples && sampleIndex < data.length; i++) {
                        data[sampleIndex++] = 0;
                    }
                }
            }
        }
        
        // Play the generated sound
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start();
        
        return {
            buffer,
            eventTimeline,
            totalDuration
        };
    }

    /**
     * Analyze recorded audio and extract segments for auto-tuning.
     * @returns {Object} Analysis result with detected segments
     */
    analyzeRecording() {
        if (!this.recordedBuffer) {
            return { segments: [], warnings: ['No recording available'] };
        }

        const audioData = this.recordedBuffer.getChannelData(0);
        const sampleRate = this.recordedBuffer.sampleRate;
        const chunkSize = 2048;
        
        // Parameters - Increased silence threshold for better noise rejection
        const silenceThreshold = 0.03;
        const minSegmentDuration = 0.05;
        
        const segments = [];
        let currentType = null;
        let segmentStart = 0;
        let freqHistory = [];
        
        // Process in chunks
        for (let i = 0; i < audioData.length - chunkSize; i += chunkSize) {
            const chunk = audioData.slice(i, i + chunkSize);
            const timestamp = i / sampleRate;
            
            // Calculate RMS
            let sum = 0;
            for (let j = 0; j < chunk.length; j++) {
                sum += chunk[j] * chunk[j];
            }
            const rms = Math.sqrt(sum / chunk.length);
            
            if (rms < silenceThreshold) {
                // Silence
                if (currentType === 'tone') {
                    const avgFreq = freqHistory.length > 0 
                        ? freqHistory.reduce((a, b) => a + b, 0) / freqHistory.length 
                        : 0;
                    segments.push({
                        type: 'tone',
                        startTime: segmentStart,
                        endTime: timestamp,
                        frequency: avgFreq,
                        duration: timestamp - segmentStart
                    });
                    freqHistory = [];
                    segmentStart = timestamp;
                    currentType = 'silence';
                } else if (currentType === null) {
                    currentType = 'silence';
                    segmentStart = timestamp;
                }
            } else {
                // Potential tone - estimate frequency using autocorrelation (better than zero-crossing)
                const freq = this._estimateFrequencyAutocorrelation(chunk, sampleRate);
                
                if (currentType === 'silence') {
                    segments.push({
                        type: 'silence',
                        startTime: segmentStart,
                        endTime: timestamp,
                        duration: timestamp - segmentStart
                    });
                    segmentStart = timestamp;
                    currentType = 'tone';
                    freqHistory = [freq];
                } else if (currentType === 'tone') {
                    freqHistory.push(freq);
                } else {
                    currentType = 'tone';
                    segmentStart = timestamp;
                    freqHistory = [freq];
                }
            }
        }
        
        // Close final segment
        const finalTime = audioData.length / sampleRate;
        if (currentType === 'tone' && freqHistory.length > 0) {
            const avgFreq = freqHistory.reduce((a, b) => a + b, 0) / freqHistory.length;
            segments.push({
                type: 'tone',
                startTime: segmentStart,
                endTime: finalTime,
                frequency: avgFreq,
                duration: finalTime - segmentStart
            });
        } else if (currentType === 'silence') {
            segments.push({
                type: 'silence',
                startTime: segmentStart,
                endTime: finalTime,
                duration: finalTime - segmentStart
            });
        }
        
        // Filter out very short segments
        const filtered = segments.filter(s => s.duration >= minSegmentDuration);
        
        // Generate proposed profile segments
        const proposedSegments = this._generateProfileFromSegments(filtered);
        
        return {
            rawSegments: filtered,
            proposedSegments: proposedSegments,
            totalDuration: finalTime,
            warnings: filtered.length < 2 ? ['Very few segments detected. Try recording a longer sample.'] : []
        };
    }

    /**
     * Estimate frequency using autocorrelation (more accurate than zero-crossing)
     */
    _estimateFrequencyAutocorrelation(chunk, sampleRate) {
        // Simple autocorrelation for fundamental frequency detection
        const minPeriod = Math.floor(sampleRate / 5000);  // Max 5kHz
        const maxPeriod = Math.floor(sampleRate / 100);   // Min 100Hz
        
        let bestPeriod = minPeriod;
        let bestCorrelation = -1;
        
        for (let period = minPeriod; period < Math.min(maxPeriod, chunk.length / 2); period++) {
            let correlation = 0;
            for (let i = 0; i < chunk.length - period; i++) {
                correlation += chunk[i] * chunk[i + period];
            }
            
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestPeriod = period;
            }
        }
        
        return sampleRate / bestPeriod;
    }

    _estimateFrequency(chunk, sampleRate) {
        // Simple zero-crossing frequency estimation (fallback)
        let crossings = 0;
        for (let i = 1; i < chunk.length; i++) {
            if ((chunk[i] >= 0 && chunk[i - 1] < 0) || (chunk[i] < 0 && chunk[i - 1] >= 0)) {
                crossings++;
            }
        }
        return (crossings / 2) * (sampleRate / chunk.length);
    }

    _generateProfileFromSegments(segments) {
        const proposed = [];
        
        for (const seg of segments) {
            if (seg.type === 'tone') {
                proposed.push({
                    type: 'tone',
                    freqMin: Math.round(seg.frequency * 0.95),
                    freqMax: Math.round(seg.frequency * 1.05),
                    durationMin: Math.round(seg.duration * 0.8 * 100) / 100,
                    durationMax: Math.round(seg.duration * 1.2 * 100) / 100
                });
            } else {
                proposed.push({
                    type: 'silence',
                    freqMin: 0,
                    freqMax: 0,
                    durationMin: Math.round(seg.duration * 0.8 * 100) / 100,
                    durationMax: Math.round(seg.duration * 1.2 * 100) / 100
                });
            }
        }
        
        return proposed;
    }
}

// Export as global
window.AudioEngine = AudioEngine;
