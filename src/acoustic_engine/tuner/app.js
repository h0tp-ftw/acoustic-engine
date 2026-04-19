/**
 * Acoustic Pro Tuner - Main Application logic
 */

class App {
    constructor() {
        this.currentStep = 1;
        this.audioBuffer = null;
        this.recordedBlob = null;
        this.profile = {
            name: "New_Alarm",
            confirmation_cycles: 2,
            segments: []
        };
        
        this.visualizer = new Visualizer();
        this.mediaRecorder = null;
        this.audioChunks = [];
        
        this.init();
    }

    init() {
        // Navigation
        document.querySelectorAll('.step-item').forEach(item => {
            item.addEventListener('click', () => {
                const step = parseInt(item.dataset.step);
                if (step < this.currentStep) this.goToStep(step);
            });
        });

        document.querySelectorAll('.prev-step').forEach(btn => {
            btn.addEventListener('click', () => this.goToStep(this.currentStep - 1));
        });

        document.getElementById('toStep2').addEventListener('click', () => this.goToStep(2));
        document.getElementById('toStep3').addEventListener('click', () => this.goToStep(3));
        document.getElementById('toStep4').addEventListener('click', () => this.goToStep(4));
        document.getElementById('toStep5').addEventListener('click', () => this.goToStep(5));

        // Step 1: Input
        document.getElementById('recordBtn').addEventListener('click', () => this.startRecording());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopRecording());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileSelect(e));
        document.getElementById('dropzone').addEventListener('click', () => document.getElementById('fileInput').click());
        
        // Step 3: Editor
        document.getElementById('addSegment').addEventListener('click', () => this.addSegment('tone'));
        document.getElementById('profileName').addEventListener('input', (e) => this.profile.name = e.target.value);
        
        // Step 5: Export
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadYaml());

        this.initDragAndDrop();
    }

    goToStep(step) {
        if (step < 1 || step > 5) return;
        
        // Logical checks before moving forward
        if (step === 2 && !this.recordedBlob) return;
        if (step === 2) this.runAnalysis();
        if (step === 4) this.runVerification();
        if (step === 5) this.generateYaml();

        // UI Update
        document.querySelectorAll('.step-content').forEach(s => s.classList.remove('active'));
        document.getElementById(`step${step}`).classList.add('active');
        
        document.querySelectorAll('.step-item').forEach(i => {
            const s = parseInt(i.dataset.step);
            i.classList.toggle('active', s === step);
        });

        this.currentStep = step;
        window.scrollTo(0, 0);
    }

    // --- Audio Handling ---

    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.recordedBlob = file;
            await this.processAudioBlob(file);
        }
    }

    initDragAndDrop() {
        const dz = document.getElementById('dropzone');
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            dz.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        dz.addEventListener('drop', (e) => {
            const file = e.dataTransfer.files[0];
            if (file) {
                this.recordedBlob = file;
                this.processAudioBlob(file);
            }
        });
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
            this.mediaRecorder.onstop = () => {
                this.recordedBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                this.processAudioBlob(this.recordedBlob);
            };

            this.mediaRecorder.start();
            document.getElementById('recordBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            document.querySelector('.pulse').style.display = 'block';
            document.getElementById('recordText').textContent = 'Recording in progress...';
        } catch (err) {
            alert('Could not access microphone: ' + err);
        }
    }

    stopRecording() {
        if (this.mediaRecorder) {
            this.mediaRecorder.stop();
            document.getElementById('recordBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
            document.querySelector('.pulse').style.display = 'none';
            document.getElementById('recordText').textContent = 'Recording complete';
        }
    }

    async processAudioBlob(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        document.getElementById('sourcePreview').style.display = 'block';
        document.getElementById('audioDuration').textContent = `${this.audioBuffer.duration.toFixed(1)}s`;
        
        const canvas = document.getElementById('sourceWaveform');
        this.visualizer.drawWaveform(canvas, this.audioBuffer);
    }

    // --- Backend API Calls ---

    async runAnalysis() {
        if (!this.recordedBlob) return;
        
        document.getElementById('toStep3').disabled = true;
        const formData = new FormData();
        formData.append('file', this.recordedBlob);

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            this.profile.segments = data.segments;
            this.renderSegments();
            
            // Visualize (mocking events for now since backend simple version 
            // doesn't return full raw timeline yet)
            const canvas = document.getElementById('eventsCanvas');
            const events = data.segments.map((s, i) => ({
                timestamp: i * 0.5, // approximate for visualization
                duration: s.duration_max,
                type: s.type,
                frequency: s.freq_min ? (s.freq_min + s.freq_max)/2 : 0
            }));
            this.visualizer.drawEvents(canvas, events, this.audioBuffer.duration);
            
            document.getElementById('toStep3').disabled = false;
        } catch (err) {
            console.error('Analysis failed', err);
        }
    }

    async runVerification() {
        const formData = new FormData();
        formData.append('file', this.recordedBlob);
        formData.append('profile_json', JSON.stringify(this.profile));

        try {
            const response = await fetch('/api/verify', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            document.getElementById('matchCount').textContent = data.total_matches;
            const container = document.getElementById('verifyTimeline');
            this.visualizer.drawMatches(container, data.matches, this.audioBuffer.duration);
        } catch (err) {
            console.error('Verification failed', err);
        }
    }

    // --- Profile Editor ---

    renderSegments() {
        const list = document.getElementById('segmentList');
        list.innerHTML = '';
        
        this.profile.segments.forEach((seg, index) => {
            const item = document.createElement('div');
            item.className = 'segment-item';
            item.innerHTML = `
                <div class="type-badge type-${seg.type}">${seg.type}</div>
                <div class="input-group">
                    <label>Freq Range</label>
                    <div style="display: flex; gap: 4px;">
                        <input type="number" value="${seg.freq_min || 0}" ${seg.type === 'silence' ? 'disabled' : ''} onchange="app.updateSeg(${index}, 'freq_min', this.value)" />
                        -
                        <input type="number" value="${seg.freq_max || 0}" ${seg.type === 'silence' ? 'disabled' : ''} onchange="app.updateSeg(${index}, 'freq_max', this.value)" />
                    </div>
                </div>
                <div class="input-group">
                    <label>Duration Range (s)</label>
                    <div style="display: flex; gap: 4px;">
                        <input type="number" step="0.05" value="${seg.duration_min}" onchange="app.updateSeg(${index}, 'duration_min', this.value)" />
                        -
                        <input type="number" step="0.05" value="${seg.duration_max}" onchange="app.updateSeg(${index}, 'duration_max', this.value)" />
                    </div>
                </div>
                <button class="btn btn-secondary" onclick="app.removeSegment(${index})">✕</button>
            `;
            list.appendChild(item);
        });
    }

    addSegment(type) {
        this.profile.segments.push({
            type,
            freq_min: type === 'tone' ? 3000 : null,
            freq_max: type === 'tone' ? 3100 : null,
            duration_min: 0.1,
            duration_max: 0.5
        });
        this.renderSegments();
    }

    updateSeg(index, field, value) {
        this.profile.segments[index][field] = parseFloat(value);
    }

    removeSegment(index) {
        this.profile.segments.splice(index, 1);
        this.renderSegments();
    }

    // --- Export ---

    generateYaml() {
        const out = {
            name: this.profile.name,
            confirmation_cycles: this.profile.confirmation_cycles,
            segments: this.profile.segments.map(s => ({
                type: s.type,
                frequency: s.type === 'tone' ? { min: s.freq_min, max: s.freq_max } : undefined,
                duration: { min: s.duration_min, max: s.duration_max }
            }))
        };
        
        document.getElementById('yamlOutput').textContent = jsyaml.dump(out);
    }

    downloadYaml() {
        const text = document.getElementById('yamlOutput').textContent;
        const blob = new Blob([text], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.profile.name}.yaml`;
        a.click();
    }
}

// Global instance for inline event handlers
const app = new App();
window.app = app;
