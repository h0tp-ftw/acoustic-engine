/**
 * Pro Visualizer - High performance canvas drawing for the Tuner.
 */

class Visualizer {
    constructor() {
        this.colors = {
            primary: '#7c3aed',
            secondary: '#f43f5e',
            accent: '#10b981',
            text: '#f8fafc',
            dim: '#94a3b8',
            glass: 'rgba(255, 255, 255, 0.05)'
        };
    }

    /**
     * Draw a simple waveform from audio buffer
     */
    drawWaveform(canvas, buffer) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const data = buffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        ctx.strokeStyle = this.colors.primary;
        ctx.lineWidth = 2;

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            ctx.moveTo(i, (1 + min) * amp);
            ctx.lineTo(i, (1 + max) * amp);
        }
        ctx.stroke();
    }

    /**
     * Draw detected engine events on a timeline
     */
    drawEvents(canvas, events, duration) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);
        
        // Draw grid
        ctx.strokeStyle = this.colors.glass;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) {
            const x = (i / 10) * width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        events.forEach(event => {
            const x = (event.timestamp / duration) * width;
            const w = (event.duration / duration) * width;
            
            ctx.fillStyle = event.type === 'tone' ? this.colors.primary : 'rgba(148, 163, 184, 0.3)';
            ctx.fillRect(x, 10, Math.max(2, w), height - 20);
            
            if (event.frequency) {
                ctx.fillStyle = '#fff';
                ctx.font = '10px JetBrains Mono';
                ctx.fillText(`${Math.round(event.frequency)}Hz`, x, 8);
            }
        });
    }

    /**
     * Draw verification matches
     */
    drawMatches(container, matches, duration) {
        container.innerHTML = '';
        matches.forEach(match => {
            const dot = document.createElement('div');
            dot.style.position = 'absolute';
            dot.style.left = `${(match.timestamp / duration) * 100}%`;
            dot.style.top = '50%';
            dot.style.transform = 'translate(-50%, -50%)';
            dot.style.width = '12px';
            dot.style.height = '12px';
            dot.style.borderRadius = '50%';
            dot.style.backgroundColor = this.colors.accent;
            dot.style.boxShadow = `0 0 10px ${this.colors.accent}`;
            dot.title = `Detection at ${match.timestamp.toFixed(2)}s`;
            container.appendChild(dot);
        });
    }
}
