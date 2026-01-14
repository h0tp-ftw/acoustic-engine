/**
 * Main Application - Ties together AudioEngine, Visualizer, and UI.
 * Enhanced with upload/download, zoom, crop, and frequency query features.
 */

class App {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.visualizer = new Visualizer(
            document.getElementById('audiogramCanvas'),
            document.getElementById('frequencyTimelineCanvas'),
            document.getElementById('eventsCanvas')
        );
        
        this.segments = [];
        this.segmentIdCounter = 0;
        this.animationId = null;
        this.generatedEventTimeline = null;
        
        // Crop selection state
        this.isDragging = false;
        this.dragStartX = 0;
        
        this.initUI();
        this.initInteractiveFeatures();
        this.addDefaultSegments();
    }

    initUI() {
        // Recording controls
        document.getElementById('recordBtn').addEventListener('click', () => this.startRecording());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopRecording());
        document.getElementById('playbackBtn').addEventListener('click', () => this.playRecording());
        
        // Upload/Download controls
        document.getElementById('uploadInput').addEventListener('change', (e) => this.handleUpload(e));
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadRecording());
        
        // Segment controls
        document.getElementById('addSegmentBtn').addEventListener('click', () => this.addSegment());
        
        // Actions
        document.getElementById('generateSoundBtn').addEventListener('click', () => this.generateSound());
        document.getElementById('exportConfigBtn').addEventListener('click', () => this.exportConfig());
        document.getElementById('analyzeBtn').addEventListener('click', () => this.analyzeRecording());
        
        // Frequency query
        document.getElementById('queryBtn').addEventListener('click', () => this.queryFrequency());
        
        // Zoom controls
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());
        document.getElementById('zoomResetBtn').addEventListener('click', () => this.zoomReset());
        
        // Crop controls
        document.getElementById('cropBtn').addEventListener('click', () => this.applyCrop());
        document.getElementById('clearCropBtn').addEventListener('click', () => this.clearCrop());
        
        // Resolution controls
        document.getElementById('resolutionSelect').addEventListener('change', (e) => {
            const size = parseInt(e.target.value);
            this.audioEngine.setFFTSize(size);
            // Enable reanalyze button if there's audio loaded
            document.getElementById('reanalyzeBtn').disabled = !this.audioEngine.hasRecording();
        });
        document.getElementById('reanalyzeBtn').addEventListener('click', () => this.reanalyzeAudio());
        
        // Profile form listeners for auto-update
        document.getElementById('confirmCycles').addEventListener('input', () => {
            this.updatePreview();
            this.updateConfig();
        });
        document.getElementById('profileName').addEventListener('input', () => {
            this.updateConfig();
        });
    }

    initInteractiveFeatures() {
        const audiogramCanvas = document.getElementById('audiogramCanvas');
        const freqCanvas = document.getElementById('frequencyTimelineCanvas');
        const tooltip = document.getElementById('freqTooltip');
        
        // Audiogram drag-to-select for cropping
        audiogramCanvas.addEventListener('mousedown', (e) => {
            if (!this.audioEngine.hasRecording()) return;
            
            const rect = audiogramCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            
            this.isDragging = true;
            this.dragStartX = x;
            this.visualizer.clearCropSelection();
            document.getElementById('cropControls').style.display = 'none';
        });
        
        audiogramCanvas.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            
            const rect = audiogramCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            
            const startTime = this.visualizer.canvasXToTime(this.dragStartX);
            const endTime = this.visualizer.canvasXToTime(x);
            
            this.visualizer.setCropSelection(startTime, endTime);
            this.updateAudiogram();
        });
        
        audiogramCanvas.addEventListener('mouseup', (e) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            
            const selection = this.visualizer.getCropSelection();
            if (selection && Math.abs(selection.end - selection.start) > 0.05) {
                // Show crop controls if selection is significant
                document.getElementById('cropControls').style.display = 'flex';
                document.getElementById('cropRange').textContent = 
                    `Selected: ${selection.start.toFixed(2)}s - ${selection.end.toFixed(2)}s`;
            }
        });
        
        audiogramCanvas.addEventListener('mouseleave', () => {
            if (this.isDragging) {
                this.isDragging = false;
            }
        });
        
        // Frequency timeline hover for tooltip
        freqCanvas.addEventListener('mousemove', (e) => {
            const rect = freqCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const info = this.visualizer.getFrequencyAtPosition(x, y);
            
            if (info && info.peakFrequencies.length > 0) {
                tooltip.style.display = 'block';
                tooltip.style.left = (x + 15) + 'px';
                tooltip.style.top = (y - 10) + 'px';
                
                let html = `<div class="tooltip-time">Time: ${info.time.toFixed(2)}s</div>`;
                html += `<div class="tooltip-freq">Peak: ${Math.round(info.peakFrequencies[0])}Hz</div>`;
                if (info.peakFrequencies.length > 1) {
                    html += `<div>2nd: ${Math.round(info.peakFrequencies[1])}Hz</div>`;
                }
                if (info.peakFrequencies.length > 2) {
                    html += `<div>3rd: ${Math.round(info.peakFrequencies[2])}Hz</div>`;
                }
                html += `<div class="tooltip-amp">RMS: ${(info.rms * 100).toFixed(1)}%</div>`;
                
                tooltip.innerHTML = html;
            } else {
                tooltip.style.display = 'none';
            }
        });
        
        freqCanvas.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    }

    // Zoom controls
    zoomIn() {
        const newZoom = this.visualizer.getZoom() * 1.5;
        this.visualizer.setZoom(newZoom);
        this.updateZoomDisplay();
        this.updateFrequencyTimeline();
    }

    zoomOut() {
        const newZoom = this.visualizer.getZoom() / 1.5;
        this.visualizer.setZoom(newZoom);
        this.updateZoomDisplay();
        this.updateFrequencyTimeline();
    }

    zoomReset() {
        this.visualizer.setZoom(1.0);
        this.updateZoomDisplay();
        this.updateFrequencyTimeline();
    }

    updateZoomDisplay() {
        const zoom = this.visualizer.getZoom();
        document.getElementById('zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
    }

    // Crop controls
    applyCrop() {
        const selection = this.visualizer.getCropSelection();
        if (!selection) return;
        
        const success = this.audioEngine.cropAudio(selection.start, selection.end);
        if (success) {
            this.visualizer.clearCropSelection();
            document.getElementById('cropControls').style.display = 'none';
            
            // Refresh visualizations
            this.updateAudiogram();
            this.updateFrequencyTimeline();
            
            const duration = this.audioEngine.getRecordedDuration();
            document.getElementById('statusText').textContent = `Cropped to ${duration.toFixed(2)}s`;
            document.getElementById('durationText').textContent = duration.toFixed(1) + 's';
        } else {
            document.getElementById('statusText').textContent = 'Crop failed';
        }
    }

    clearCrop() {
        this.visualizer.clearCropSelection();
        document.getElementById('cropControls').style.display = 'none';
        this.updateAudiogram();
    }

    updateAudiogram() {
        const analysis = this.audioEngine.getFrequencyAnalysis();
        if (analysis) {
            this.visualizer.drawAudiogram(analysis);
        }
    }

    /**
     * Re-analyze the audio with current resolution settings
     */
    reanalyzeAudio() {
        if (!this.audioEngine.hasRecording()) return;
        
        const resolution = this.audioEngine.getResolutionMs();
        document.getElementById('statusText').textContent = `Re-analyzing with ${resolution}ms resolution...`;
        
        // Force re-analysis
        this.audioEngine._performFrequencyAnalysis();
        
        // Update visualizations
        this.updateAudiogram();
        this.updateFrequencyTimeline();
        
        document.getElementById('statusText').textContent = `Analysis complete (${resolution}ms resolution)`;
    }

    addDefaultSegments() {
        // Add a sample pattern: Beep -> Silence -> Beep -> Silence
        this.addSegment('tone', 2900, 3100, 0.4, 0.6);
        this.addSegment('silence', 0, 0, 0.1, 0.3);
        this.addSegment('tone', 2900, 3100, 0.4, 0.6);
        this.addSegment('silence', 0, 0, 0.8, 1.2);
        
        this.updatePreview();
    }

    addSegment(type = 'tone', freqMin = 1000, freqMax = 1500, durationMin = 0.3, durationMax = 0.5) {
        const id = this.segmentIdCounter++;
        
        this.segments.push({
            id,
            type,
            freqMin,
            freqMax,
            durationMin,
            durationMax
        });
        
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
    }

    removeSegment(id) {
        this.segments = this.segments.filter(s => s.id !== id);
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
    }

    duplicateSegment(id) {
        const index = this.segments.findIndex(s => s.id === id);
        if (index === -1) return;
        
        const original = this.segments[index];
        const duplicate = {
            id: this.segmentIdCounter++,
            type: original.type,
            freqMin: original.freqMin,
            freqMax: original.freqMax,
            durationMin: original.durationMin,
            durationMax: original.durationMax
        };
        
        // Insert after the original
        this.segments.splice(index + 1, 0, duplicate);
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
    }

    moveSegment(id, direction) {
        const index = this.segments.findIndex(s => s.id === id);
        if (index === -1) return;
        
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= this.segments.length) return;
        
        // Swap segments
        [this.segments[index], this.segments[newIndex]] = 
        [this.segments[newIndex], this.segments[index]];
        
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
        
        // Re-focus the moved segment's first input for continued keyboard navigation
        setTimeout(() => {
            const movedEl = document.querySelector(`.segment-item[data-id="${id}"] input`);
            if (movedEl) movedEl.focus();
        }, 50);
    }

    updateSegment(id, field, value) {
        const seg = this.segments.find(s => s.id === id);
        if (seg) {
            seg[field] = field === 'type' ? value : parseFloat(value);
            this.updatePreview();
            this.updateConfig();
        }
    }

    renderSegments() {
        const container = document.getElementById('segmentList');
        container.innerHTML = '';
        
        this.segments.forEach((seg, index) => {
            const el = document.createElement('div');
            el.className = `segment-item segment-${seg.type}`;
            el.dataset.id = seg.id;
            el.tabIndex = 0; // Make focusable for keyboard navigation
            
            const isFirst = index === 0;
            const isLast = index === this.segments.length - 1;
            
            el.innerHTML = `
                <div class="segment-header">
                    <span class="segment-type">
                        <span class="segment-indicator">${seg.type === 'tone' ? '♪' : '⏸'}</span>
                        <span class="segment-number">#${index + 1}</span>
                        <select data-id="${seg.id}" data-field="type">
                            <option value="tone" ${seg.type === 'tone' ? 'selected' : ''}>Tone</option>
                            <option value="silence" ${seg.type === 'silence' ? 'selected' : ''}>Silence</option>
                        </select>
                    </span>
                    <div class="segment-actions">
                        <button class="segment-action-btn move-up" data-id="${seg.id}" title="Move up (Shift+↑)" ${isFirst ? 'disabled' : ''}>↑</button>
                        <button class="segment-action-btn move-down" data-id="${seg.id}" title="Move down (Shift+↓)" ${isLast ? 'disabled' : ''}>↓</button>
                        <button class="segment-action-btn duplicate" data-id="${seg.id}" title="Duplicate">⧉</button>
                        <button class="segment-action-btn remove-btn" data-id="${seg.id}" title="Remove">×</button>
                    </div>
                </div>
                <div class="segment-fields">
                    ${seg.type === 'tone' ? `
                        <label>
                            Freq Min (Hz)
                            <input type="number" value="${seg.freqMin}" data-id="${seg.id}" data-field="freqMin" />
                        </label>
                        <label>
                            Freq Max (Hz)
                            <input type="number" value="${seg.freqMax}" data-id="${seg.id}" data-field="freqMax" />
                        </label>
                    ` : ''}
                    <label>
                        Duration Min (s)
                        <input type="number" step="0.1" value="${seg.durationMin}" data-id="${seg.id}" data-field="durationMin" />
                    </label>
                    <label>
                        Duration Max (s)
                        <input type="number" step="0.1" value="${seg.durationMax}" data-id="${seg.id}" data-field="durationMax" />
                    </label>
                </div>
            `;
            container.appendChild(el);
        });
        
        // Attach event listeners for inputs and selects
        container.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('change', (e) => {
                const id = parseInt(e.target.dataset.id);
                const field = e.target.dataset.field;
                this.updateSegment(id, field, e.target.value);
                
                // Re-render if type changed
                if (field === 'type') {
                    this.renderSegments();
                }
            });
            
            // Keyboard shortcuts for reordering
            input.addEventListener('keydown', (e) => {
                if (e.shiftKey) {
                    const id = parseInt(e.target.dataset.id);
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        this.moveSegment(id, -1);
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        this.moveSegment(id, 1);
                    }
                }
            });
        });
        
        // Move up buttons
        container.querySelectorAll('.move-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                this.moveSegment(id, -1);
            });
        });
        
        // Move down buttons
        container.querySelectorAll('.move-down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                this.moveSegment(id, 1);
            });
        });
        
        // Duplicate buttons
        container.querySelectorAll('.duplicate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                this.duplicateSegment(id);
            });
        });
        
        // Remove buttons
        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                this.removeSegment(id);
            });
        });
    }

    updatePreview() {
        const cycles = parseInt(document.getElementById('confirmCycles').value) || 1;
        this.visualizer.drawSegmentPreview(this.segments, cycles);
    }

    updateConfig() {
        const name = document.getElementById('profileName').value || 'NewAlarm';
        const cycles = parseInt(document.getElementById('confirmCycles').value) || 1;
        
        let yaml = `# Alarm Profile: ${name}\n`;
        yaml += `name: "${name}"\n`;
        yaml += `confirmation_cycles: ${cycles}\n`;
        yaml += `segments:\n`;
        
        this.segments.forEach((seg, i) => {
            yaml += `  - type: "${seg.type}"\n`;
            if (seg.type === 'tone') {
                yaml += `    frequency:\n`;
                yaml += `      min: ${seg.freqMin}\n`;
                yaml += `      max: ${seg.freqMax}\n`;
            }
            yaml += `    duration:\n`;
            yaml += `      min: ${seg.durationMin}\n`;
            yaml += `      max: ${seg.durationMax}\n`;
        });
        
        document.getElementById('configOutput').textContent = yaml;
    }

    async startRecording() {
        const success = await this.audioEngine.startRecording();
        if (success) {
            document.getElementById('recordBtn').classList.add('recording');
            document.getElementById('recordBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            document.getElementById('playbackBtn').disabled = true;
            document.getElementById('downloadBtn').disabled = true;
            document.getElementById('analyzeBtn').disabled = true;
            document.getElementById('queryBtn').disabled = true;
            document.getElementById('statusText').textContent = 'Recording...';
            
            this.visualizer.clear();
            this.startVisualization();
        }
    }

    stopRecording() {
        this.audioEngine.stopRecording();
        this.stopVisualization();
        
        document.getElementById('recordBtn').classList.remove('recording');
        document.getElementById('recordBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('playbackBtn').disabled = false;
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('analyzeBtn').disabled = false;
        document.getElementById('queryBtn').disabled = false;
        document.getElementById('reanalyzeBtn').disabled = false;
        document.getElementById('statusText').textContent = 'Recording stopped - Click Auto-Tune to analyze';
        
        // Show visualizations after short delay (to let audio decode)
        setTimeout(() => {
            this.updateAudiogram();
            this.updateFrequencyTimeline();
        }, 500);
    }

    /**
     * Handle audio file upload
     */
    async handleUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        document.getElementById('statusText').textContent = `Loading ${file.name}...`;
        
        const result = await this.audioEngine.uploadAudio(file);
        
        if (result.success) {
            const duration = this.audioEngine.getRecordedDuration();
            document.getElementById('statusText').textContent = `Loaded ${file.name} (${duration.toFixed(1)}s)`;
            document.getElementById('durationText').textContent = duration.toFixed(1) + 's';
            
            document.getElementById('playbackBtn').disabled = false;
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('analyzeBtn').disabled = false;
            document.getElementById('queryBtn').disabled = false;
            document.getElementById('reanalyzeBtn').disabled = false;
            
            // Update visualizations
            this.updateAudiogram();
            this.updateFrequencyTimeline();
        } else {
            const errorMsg = result.error || 'Unknown error';
            document.getElementById('statusText').textContent = `Failed to load: ${errorMsg}`;
            console.error('Upload failed:', errorMsg);
        }
        
        // Reset input so same file can be re-uploaded
        event.target.value = '';
    }

    /**
     * Download the current recording
     */
    downloadRecording() {
        const profileName = document.getElementById('profileName').value || 'alarm';
        const success = this.audioEngine.downloadRecording(profileName + '_recording');
        
        if (success) {
            document.getElementById('statusText').textContent = 'Recording downloaded!';
        } else {
            document.getElementById('statusText').textContent = 'No recording to download';
        }
    }

    /**
     * Update the frequency timeline visualization
     */
    updateFrequencyTimeline() {
        const analysis = this.audioEngine.getFrequencyAnalysis();
        if (analysis) {
            this.visualizer.drawFrequencyTimeline(analysis);
        }
    }

    /**
     * Query frequency presence in the recording
     */
    queryFrequency() {
        const targetFreq = parseFloat(document.getElementById('queryFrequency').value) || 3000;
        const tolerance = parseFloat(document.getElementById('queryTolerance').value) || 100;
        
        const result = this.audioEngine.queryFrequency(targetFreq, tolerance);
        
        const resultsDiv = document.getElementById('queryResults');
        
        if (result.error) {
            resultsDiv.innerHTML = `<span class="error">${result.error}</span>`;
            return;
        }
        
        // Build results HTML
        let html = `
            <div class="query-result-item">
                <span class="label">Target</span>
                <span class="value">${result.targetFreq}Hz ±${result.tolerance}Hz</span>
            </div>
            <div class="query-result-item">
                <span class="label">Total Presence</span>
                <span class="value highlight">${result.totalPresenceDuration.toFixed(2)}s (${result.presencePercentage.toFixed(1)}%)</span>
            </div>
            <div class="query-result-item">
                <span class="label">Occurrences</span>
                <span class="value">${result.windowCount} windows</span>
            </div>
            <div class="query-result-item">
                <span class="label">Avg Duration</span>
                <span class="value">${result.averageWindowDuration.toFixed(3)}s</span>
            </div>
        `;
        
        if (result.presenceWindows.length > 0 && result.presenceWindows.length <= 10) {
            html += `<div class="query-windows"><span class="label">Windows:</span><ul>`;
            for (const w of result.presenceWindows) {
                html += `<li>${w.start.toFixed(2)}s – ${w.end.toFixed(2)}s (${(w.end - w.start).toFixed(2)}s)</li>`;
            }
            html += `</ul></div>`;
        } else if (result.presenceWindows.length > 10) {
            html += `<div class="query-windows"><span class="label">First 5 windows:</span><ul>`;
            for (let i = 0; i < 5; i++) {
                const w = result.presenceWindows[i];
                html += `<li>${w.start.toFixed(2)}s – ${w.end.toFixed(2)}s</li>`;
            }
            html += `</ul></div>`;
        }
        
        resultsDiv.innerHTML = html;
    }

    playRecording() {
        const result = this.audioEngine.playRecording();
        if (!result) {
            document.getElementById('statusText').textContent = 'No recording to play';
            return;
        }
        
        document.getElementById('statusText').textContent = 'Playing back...';
        document.getElementById('playbackBtn').disabled = true;
        
        // Start visualization during playback with frequency timeline sync
        this.startPlaybackVisualization(result.duration);
    }
    
    startPlaybackVisualization(duration) {
        const startTime = performance.now();
        const durationMs = duration * 1000;
        const analysis = this.audioEngine.getFrequencyAnalysis();
        
        const draw = () => {
            const data = this.audioEngine.getAnalyserData();
            if (data) {
                this.visualizer.drawWaveform(data.timeData, data.bufferLength);
            }
            
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / durationMs, 1);
            const currentTime = progress * duration;
            
            document.getElementById('durationText').textContent = currentTime.toFixed(1) + 's';
            
            // Update visualizations with playhead
            if (analysis) {
                this.visualizer.drawAudiogram(analysis, progress);
                this.visualizer.drawFrequencyTimeline(analysis, progress);
            }
            
            if (progress < 1) {
                this.animationId = requestAnimationFrame(draw);
            } else {
                // Playback finished
                document.getElementById('statusText').textContent = `Playback complete (${duration.toFixed(1)}s)`;
                document.getElementById('playbackBtn').disabled = false;
                this.animationId = null;
                
                // Redraw without playhead
                if (analysis) {
                    this.visualizer.drawAudiogram(analysis);
                    this.visualizer.drawFrequencyTimeline(analysis);
                }
            }
        };
        draw();
    }

    startVisualization() {
        const draw = () => {
            const data = this.audioEngine.getAnalyserData();
            if (data) {
                this.visualizer.drawLiveAudiogram(data.timeData, data.bufferLength);
                this.visualizer.drawLiveFrequency(data.freqData, data.bufferLength);
            }
            
            const duration = this.audioEngine.getRecordingDuration();
            document.getElementById('durationText').textContent = duration.toFixed(1) + 's';
            
            this.animationId = requestAnimationFrame(draw);
        };
        draw();
    }

    stopVisualization() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    generateSound() {
        if (this.segments.length === 0) {
            alert('Add at least one segment to generate sound!');
            return;
        }
        
        const cycles = parseInt(document.getElementById('confirmCycles').value) || 1;
        
        // Generate and play the sound - now returns event timeline for sync
        const result = this.audioEngine.generateSound(this.segments, cycles);
        this.generatedEventTimeline = result.eventTimeline;
        
        // Start playhead animation with proper sync
        this.startPlayheadAnimation(result.totalDuration, result.eventTimeline);
        
        document.getElementById('statusText').textContent = 'Playing generated sound...';
    }

    /**
     * Animate a playhead bar across the Detected Events canvas during playback
     * Now with event timeline sync
     */
    startPlayheadAnimation(duration, eventTimeline = null) {
        const startTime = performance.now();
        const durationMs = duration * 1000;
        
        // Stop any existing animation
        if (this.playheadAnimationId) {
            cancelAnimationFrame(this.playheadAnimationId);
        }
        
        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / durationMs, 1);
            const currentTime = progress * duration;
            
            // Update duration display
            document.getElementById('durationText').textContent = currentTime.toFixed(1) + 's';
            
            // Redraw segments with playhead
            const cycles = parseInt(document.getElementById('confirmCycles').value) || 1;
            this.visualizer.drawSegmentPreview(this.segments, cycles, progress, eventTimeline);
            
            if (progress < 1) {
                this.playheadAnimationId = requestAnimationFrame(animate);
            } else {
                // Playback finished
                document.getElementById('statusText').textContent = `Playback complete (${duration.toFixed(1)}s)`;
                this.playheadAnimationId = null;
                
                // Redraw without playhead after a short delay
                setTimeout(() => {
                    this.visualizer.drawSegmentPreview(this.segments, cycles);
                }, 500);
            }
        };
        
        animate();
    }

    exportConfig() {
        const yamlContent = document.getElementById('configOutput').textContent;
        const blob = new Blob([yamlContent], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${document.getElementById('profileName').value || 'alarm'}_profile.yaml`;
        a.click();
        
        URL.revokeObjectURL(url);
        document.getElementById('statusText').textContent = 'Config exported!';
    }

    analyzeRecording() {
        const result = this.audioEngine.analyzeRecording();
        
        if (result.warnings && result.warnings.length > 0) {
            console.warn('Analysis warnings:', result.warnings);
        }
        
        if (result.proposedSegments && result.proposedSegments.length > 0) {
            // Clear existing segments and load proposed ones
            this.segments = [];
            this.segmentIdCounter = 0;
            
            for (const seg of result.proposedSegments) {
                this.addSegment(
                    seg.type,
                    seg.freqMin || 0,
                    seg.freqMax || 0,
                    seg.durationMin,
                    seg.durationMax
                );
            }
            
            document.getElementById('statusText').textContent = 
                `Auto-tuned! Extracted ${result.proposedSegments.length} segments from ${result.totalDuration.toFixed(1)}s audio`;
            
            // Visualize raw segments
            this.visualizer.drawEvents(
                result.rawSegments.map(s => ({
                    type: s.type,
                    timestamp: s.startTime,
                    duration: s.duration,
                    frequency: s.frequency || 0
                })),
                result.totalDuration
            );
        } else {
            document.getElementById('statusText').textContent = 'No patterns detected. Try a longer recording.';
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
