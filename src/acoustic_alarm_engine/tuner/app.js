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
        
        // Auto-Tune Settings controls
        document.getElementById('silenceMode').addEventListener('change', (e) => {
            const isManual = e.target.value === 'manual';
            document.getElementById('silenceThresholdControl').style.display = isManual ? 'flex' : 'none';
        });
        
        document.getElementById('silenceThreshold').addEventListener('input', (e) => {
            document.getElementById('silenceThresholdValue').textContent = e.target.value;
        });

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
        
        // Editor Toolbar
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('redoBtn').addEventListener('click', () => this.redo());
        document.getElementById('mergeBtn').addEventListener('click', () => this.mergeSelectedSegments());
        document.getElementById('splitBtn').addEventListener('click', () => this.splitSelectedSegment());
    }

    // --- Undo/Redo System ---
    
    saveState() {
        // Remove future logic if we're in the middle of history
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        // Deep copy segments
        const state = JSON.parse(JSON.stringify(this.segments));
        this.history.push(state);
        this.historyIndex++;
        
        // Limit history size
        if (this.history.length > 50) {
            this.history.shift();
            this.historyIndex--;
        }
        
        this.updateUndoRedoButtons();
    }
    
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.segments = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
            this.segmentIdCounter = Math.max(...this.segments.map(s => s.id), 0) + 1;
            
            this.renderSegments();
            this.updatePreview();
            this.updateConfig();
            this.updateUndoRedoButtons();
        }
    }
    
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.segments = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
            this.segmentIdCounter = Math.max(...this.segments.map(s => s.id), 0) + 1;
            
            this.renderSegments();
            this.updatePreview();
            this.updateConfig();
            this.updateUndoRedoButtons();
        }
    }
    

    updateUndoRedoButtons() {
        document.getElementById('undoBtn').disabled = this.historyIndex <= 0;
        document.getElementById('redoBtn').disabled = this.historyIndex >= this.history.length - 1;
    }

    // --- Editor Tools ---

    toggleSelection(id, multi = false) {
        const index = this.segments.findIndex(s => s.id === id);
        if (index === -1) return;
        
        if (!this.selectedSegments) this.selectedSegments = new Set();
        
        if (multi) {
            if (this.selectedSegments.has(id)) {
                this.selectedSegments.delete(id);
            } else {
                this.selectedSegments.add(id);
            }
        } else {
            this.selectedSegments.clear();
            this.selectedSegments.add(id);
        }
        
        this.renderSegments();
    }
    
    mergeSelectedSegments() {
        if (!this.selectedSegments || this.selectedSegments.size < 2) return;
        
        this.saveState();
        
        const selectedIds = Array.from(this.selectedSegments);
        const selectedSegs = this.segments.filter(s => this.selectedSegments.has(s.id));
        
        // Sort by list order
        selectedSegs.sort((a, b) => this.segments.indexOf(a) - this.segments.indexOf(b));
        
        const first = selectedSegs[0];
        
        // Determine type: if mixed, default to tone
        const type = selectedSegs.some(s => s.type === 'tone') ? 'tone' : 'silence';
        
        // Sum durations
        const durationMin = selectedSegs.reduce((sum, s) => sum + s.durationMin, 0);
        const durationMax = selectedSegs.reduce((sum, s) => sum + s.durationMax, 0);
        
        let freqMin = 0, freqMax = 0;
        if (type === 'tone') {
             const tones = selectedSegs.filter(s => s.type === 'tone');
             if (tones.length > 0) {
                 freqMin = tones.reduce((sum, s) => sum + s.freqMin, 0) / tones.length;
                 freqMax = tones.reduce((sum, s) => sum + s.freqMax, 0) / tones.length;
             }
        }
        
        const newSeg = {
            id: this.segmentIdCounter++,
            type,
            freqMin: Math.round(freqMin),
            freqMax: Math.round(freqMax),
            durationMin: parseFloat(durationMin.toFixed(2)),
            durationMax: parseFloat(durationMax.toFixed(2))
        };
        
        // Insert at position of first, remove others
        const insertIndex = this.segments.indexOf(first);
        this.segments = this.segments.filter(s => !this.selectedSegments.has(s.id));
        this.segments.splice(insertIndex, 0, newSeg);
        
        this.selectedSegments.clear();
        this.selectedSegments.add(newSeg.id);
        
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
    }
    
    splitSelectedSegment() {
        if (!this.selectedSegments || this.selectedSegments.size !== 1) return;
        
        const id = Array.from(this.selectedSegments)[0];
        const index = this.segments.findIndex(s => s.id === id);
        if (index === -1) return;
        
        this.saveState();
        
        const original = this.segments[index];
        
        // Split in half
        const part1 = {
            ...original,
            id: this.segmentIdCounter++,
            durationMin: parseFloat((original.durationMin / 2).toFixed(2)),
            durationMax: parseFloat((original.durationMax / 2).toFixed(2))
        };
        
        const part2 = {
            ...original,
            id: this.segmentIdCounter++,
            durationMin: parseFloat((original.durationMin / 2).toFixed(2)),
            durationMax: parseFloat((original.durationMax / 2).toFixed(2))
        };
        
        this.segments.splice(index, 1, part1, part2);
        
        this.selectedSegments.clear();
        this.selectedSegments.add(part1.id);
        this.selectedSegments.add(part2.id); 
        
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
    }


    addDefaultSegments() {
        // Add a sample pattern: Beep -> Silence -> Beep -> Silence
        this.segments = []; // Clear first to not duplicate on reload if any
        this.saveState(); // Save initial empty state
        
        const defaultSegs = [
            { type: 'tone', freqMin: 2900, freqMax: 3100, durationMin: 0.4, durationMax: 0.6 },
            { type: 'silence', durationMin: 0.1, durationMax: 0.3 },
            { type: 'tone', freqMin: 2900, freqMax: 3100, durationMin: 0.4, durationMax: 0.6 },
            { type: 'silence', durationMin: 0.8, durationMax: 1.2 }
        ];
        
        for (const s of defaultSegs) {
            this.segments.push({
                id: this.segmentIdCounter++,
                ...s
            });
        }
        
        this.saveState();
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
    }

    addSegment(type = 'tone', freqMin = 1000, freqMax = 1500, durationMin = 0.3, durationMax = 0.5) {
        this.saveState();
        const id = this.segmentIdCounter++;
        
        this.segments.push({
            id,
            type,
            freqMin,
            freqMax,
            durationMin,
            durationMax
        });
        
        this.saveState(); // Save after adding (actually duplicate save? logic: saveState pushes NEW state. So I should push AFTER change)
        // Wait, standard undo logic:
        // 1. Current state is at historyIndex.
        // 2. Make change.
        // 3. Push new state.
        // My saveState implementation pushes CURRENT segments. So I should call it AFTER changing.
        // But what about the state BEFORE?
        // If history is empty, I should have initial state.
        // Let's refine: initialize history with empty state in constructor.
        
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
    }
    
    // Fixed addSegment logic: call saveState AFTER change
    // But verify constructor init.
    
    removeSegment(id) {
        this.segments = this.segments.filter(s => s.id !== id);
        this.saveState();
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
        this.saveState();
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
        
        this.saveState();
        this.renderSegments();
        this.updatePreview();
        this.updateConfig();
        
        // Re-focus logic...
        setTimeout(() => {
            const movedEl = document.querySelector(`.segment-item[data-id="${id}"] input`);
            if (movedEl) movedEl.focus();
        }, 50);
    }

    updateSegment(id, field, value) {
        const seg = this.segments.find(s => s.id === id);
        if (seg) {
            // Only save state on "change" (committed), not every keystroke?
            // The event listener is 'change' in renderSegments, so it's committed.
            seg[field] = field === 'type' ? value : parseFloat(value);
            this.saveState();
            this.updatePreview();
            this.updateConfig();
        }
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

        // Frequency Picker (Click to set freq of selected segment)
        freqCanvas.addEventListener('click', (e) => {
            if (!this.selectedSegments || this.selectedSegments.size !== 1) return;
            
            const id = Array.from(this.selectedSegments)[0];
            const seg = this.segments.find(s => s.id === id);
            
            if (!seg || seg.type !== 'tone') return;
            
            const rect = freqCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const info = this.visualizer.getFrequencyAtPosition(x, y);
            if (info) {
                // Use cursor frequency from visualizer
                const freq = info.cursorFrequency;
                if (freq >= 100 && freq <= 5000) {
                    this.saveState();
                    // Set range +/- 50Hz around clicked frequency
                    seg.freqMin = Math.max(100, freq - 50);
                    seg.freqMax = Math.min(5000, freq + 50);
                    
                    this.renderSegments();
                    this.updatePreview();
                    this.updateConfig();
                    
                    // Show ephemeral feedback?
                    const status = document.getElementById('statusText');
                    status.textContent = `Set segment #${this.segments.indexOf(seg) + 1} frequency to ${freq}Hz`;
                    setTimeout(() => status.textContent = 'Ready', 2000);
                }
            }
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
            const isSelected = this.selectedSegments && this.selectedSegments.has(seg.id);
            
            el.className = `segment-item segment-${seg.type} ${isSelected ? 'selected' : ''}`;
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
            
            // Selection click listener
            el.addEventListener('click', (e) => {
                // Ignore if clicked on input, button or select
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
                
                // Allow Ctrl/Shift/Meta for multi-selection
                this.toggleSelection(seg.id, e.ctrlKey || e.metaKey || e.shiftKey);
            });
            
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
                // Prevent event bubbling to selection handler if necessary
                e.stopPropagation();
                
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
            
            // Prevent triggering selection when clicking inputs
            input.addEventListener('click', (e) => e.stopPropagation());
        });
        
        // Button Listeners with stopPropagation to prevent selection toggle
        container.querySelectorAll('.move-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(e.target.dataset.id);
                this.moveSegment(id, -1);
            });
        });
        
        container.querySelectorAll('.move-down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(e.target.dataset.id);
                this.moveSegment(id, 1);
            });
        });
        
        container.querySelectorAll('.duplicate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(e.target.dataset.id);
                this.duplicateSegment(id);
            });
        });
        
        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(e.target.dataset.id);
                this.removeSegment(id);
            });
        });
    }            el.className = `segment-item segment-${seg.type}`;
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
        // Gather options from UI
        const silenceMode = document.getElementById('silenceMode').value;
        const silenceThreshold = silenceMode === 'manual' 
            ? parseFloat(document.getElementById('silenceThreshold').value) 
            : null;
        const patternRecognition = document.getElementById('patternRecognition').checked;
        
        const result = this.audioEngine.analyzeRecording({
            silenceThreshold,
            patternRecognition
        });
        
        const patternInfoDiv = document.getElementById('patternInfo');
        
        if (result.warnings && result.warnings.length > 0) {
            console.warn('Analysis warnings:', result.warnings);
            // Optionally show warnings in UI
        }
        
        if (result.proposedSegments && result.proposedSegments.length > 0) {
            // Apply segments
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
            
            let statusMsg = `Auto-tuned! Found ${result.proposedSegments.length} segments.`;
            
            // Show pattern info if available
            if (result.patternInfo && result.patternInfo.type !== 'custom') {
                statusMsg = `Detected ${result.patternInfo.type} Pattern! Confidence: ${(result.patternInfo.confidence * 100).toFixed(0)}%`;
                
                patternInfoDiv.style.display = 'block';
                patternInfoDiv.innerHTML = `
                    <div class="pattern-badge pattern-${result.patternInfo.type}">
                        ${result.patternInfo.type} Pattern Detected
                    </div>
                    <div class="pattern-details">
                        Freq: ${Math.round(result.patternInfo.avgFrequency)}Hz | 
                        Duration: ${(result.patternInfo.avgDuration*1000).toFixed(0)}ms
                    </div>
                `;
            } else {
                patternInfoDiv.style.display = 'none';
            }
            
            if (result.noiseFloor) {
                statusMsg += ` (Noise Floor: ${result.noiseFloor.toFixed(4)})`;
            }
            
            document.getElementById('statusText').textContent = statusMsg;
            
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
            document.getElementById('statusText').textContent = 'No patterns detected. Try adjusting threshold or recording longer sample.';
            patternInfoDiv.style.display = 'none';
        }
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
