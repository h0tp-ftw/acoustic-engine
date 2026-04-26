// --- FFT & Audio Analysis ---

// In-place Cooley-Tukey radix-2 FFT
export function computeFFT(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = real[i]; real[i] = real[j]; real[j] = t;
      t = imag[i]; imag[i] = imag[j]; imag[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wLenR = Math.cos(angle), wLenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wR = 1, wI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const vR = real[i + j + len / 2] * wR - imag[i + j + len / 2] * wI;
        const vI = real[i + j + len / 2] * wI + imag[i + j + len / 2] * wR;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR;
        imag[i + j + len / 2] = uI - vI;
        const nextWR = wR * wLenR - wI * wLenI;
        wI = wR * wLenI + wI * wLenR;
        wR = nextWR;
      }
    }
  }
}

// Compute magnitude spectrum (returns Float32Array of magnitudes, length = fftSize/2)
export function computeMagnitudeSpectrum(channelData, offset, fftSize) {
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  for (let j = 0; j < fftSize; j++) {
    const idx = offset + j;
    if (idx < channelData.length) {
      real[j] = channelData[idx] * (0.5 - 0.5 * Math.cos(2 * Math.PI * j / (fftSize - 1)));
    }
  }
  computeFFT(real, imag);
  const mags = new Float32Array(fftSize / 2);
  for (let j = 0; j < fftSize / 2; j++) {
    mags[j] = Math.sqrt(real[j] * real[j] + imag[j] * imag[j]);
  }
  return mags;
}

// Find dominant frequency using FFT peak with parabolic interpolation
export function estimateFrequencyFFT(channelData, sampleRate, startSample, endSample) {
  const length = endSample - startSample;
  if (length < 256) return 0;

  // Largest power-of-2 that fits
  const fftSize = 1 << Math.floor(Math.log2(length));
  if (fftSize < 256) return 0;

  // Trim 10% off edges to avoid onset/offset transients
  const trimSamples = Math.floor(length * 0.1);
  const trimmedStart = startSample + trimSamples;

  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const idx = trimmedStart + i;
    if (idx < channelData.length) {
      real[i] = channelData[idx] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));
    }
  }
  computeFFT(real, imag);

  let maxMag = 0, maxBin = 0;
  for (let i = 1; i < fftSize / 2; i++) {
    const mag = real[i] * real[i] + imag[i] * imag[i];
    if (mag > maxMag) { maxMag = mag; maxBin = i; }
  }

  if (maxBin === 0) return 0;

  const freqRes = sampleRate / fftSize;

  // Parabolic interpolation for sub-bin accuracy
  if (maxBin > 0 && maxBin < fftSize / 2 - 1) {
    const a = Math.sqrt(real[maxBin - 1] ** 2 + imag[maxBin - 1] ** 2);
    const b = Math.sqrt(maxMag);
    const c = Math.sqrt(real[maxBin + 1] ** 2 + imag[maxBin + 1] ** 2);
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-10) {
      const delta = 0.5 * (a - c) / denom;
      return (maxBin + delta) * freqRes;
    }
  }
  return maxBin * freqRes;
}

// Check if a spectrum frame has concentrated tonal energy (vs broadband noise)
export function hasTonalPeak(magnitudes, minConcentration = 0.35) {
  let total = 0, maxVal = 0, maxBin = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    total += magnitudes[i];
    if (magnitudes[i] > maxVal) { maxVal = magnitudes[i]; maxBin = i; }
  }
  if (total < 1e-6) return false;

  // Sum energy in peak ± 5 bins
  let peakEnergy = 0;
  const lo = Math.max(0, maxBin - 5);
  const hi = Math.min(magnitudes.length - 1, maxBin + 5);
  for (let i = lo; i <= hi; i++) peakEnergy += magnitudes[i];

  return (peakEnergy / total) > minConcentration;
}

// Full audio analysis: RMS envelope, FFT-based frequency track, spectrogram, spectral gate
export function analyzeAudio(audioBuffer, windowMs = 10) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSamples = Math.floor((sampleRate * windowMs) / 1000);

  const envelope = [];
  const freqTrack = [];
  const spectrogram = [];
  const tonalFlags = [];

  const fftSize = 1024;
  const freqResolution = sampleRate / fftSize;

  for (let i = 0; i < channelData.length; i += windowSamples) {
    // RMS envelope
    let sumSquares = 0;
    let count = 0;
    for (let j = 0; j < windowSamples && i + j < channelData.length; j++) {
      const val = channelData[i + j];
      sumSquares += val * val;
      count++;
    }
    const rms = Math.sqrt(sumSquares / count);
    envelope.push(rms);

    // FFT for this window
    const mags = computeMagnitudeSpectrum(channelData, i, fftSize);
    spectrogram.push(mags);

    // Spectral gating: is this window tonal?
    const isTonal = hasTonalPeak(mags);
    tonalFlags.push(isTonal);

    // Dominant frequency from FFT peak
    if (rms > 0.01 && isTonal) {
      let maxMag = 0, maxBin = 0;
      for (let j = 1; j < mags.length; j++) {
        if (mags[j] > maxMag) { maxMag = mags[j]; maxBin = j; }
      }
      freqTrack.push(maxBin * freqResolution);
    } else {
      freqTrack.push(0);
    }
  }

  // Normalize envelope (safe for large arrays — no spread)
  let maxRms = 0;
  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] > maxRms) maxRms = envelope[i];
  }
  if (maxRms < 0.001) maxRms = 0.001;
  const normalizedEnvelope = envelope.map(v => v / maxRms);

  return { envelope: normalizedEnvelope, rawEnvelope: envelope, freqTrack, spectrogram, freqResolution, tonalFlags };
}

// Adaptive threshold: relative to noise floor
export function computeAdaptiveThreshold(envelope, userThreshold) {
  const sorted = [...envelope].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  return noiseFloor + (1 - noiseFloor) * userThreshold;
}

// Detect repeating cycle pattern in segment types
export function detectCyclePeriod(segmentTypes) {
  if (segmentTypes.length < 2) return segmentTypes.length;

  for (let period = 1; period <= Math.floor(segmentTypes.length / 2); period++) {
    let matches = true;
    // Check if the sequence repeats with this period (allow partial final cycle)
    for (let i = period; i < segmentTypes.length; i++) {
      if (segmentTypes[i] !== segmentTypes[i % period]) {
        matches = false;
        break;
      }
    }
    if (matches) return period;
  }
  return segmentTypes.length;
}
