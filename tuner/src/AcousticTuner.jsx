import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Upload, Play, Square, Pause, Settings2, Activity, Download, Copy, RefreshCw, Scissors, Wand2, Plus, Trash2, Dices, Radio, Info, FileUp, FileText, ChevronDown, ChevronRight, ShieldCheck, Loader2, Undo2 } from 'lucide-react';
import jsyaml from 'js-yaml';
import {
  analyzeAudio,
  estimateFrequencyFFT,
  computeAdaptiveThreshold,
  detectCyclePeriod,
} from './audio.js';

export default function AcousticTuner() {
  // --- View & Toggle State ---
  const [viewMode, setViewMode] = useState('timeline');
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [showPitchTrack, setShowPitchTrack] = useState(true);
  const [showSpectrogram, setShowSpectrogram] = useState(false);
  const [showAdvancedProfile, setShowAdvancedProfile] = useState(false);

  // Live Spectrum Settings
  const [specMinFreq, setSpecMinFreq] = useState(0);
  const [specMaxFreq, setSpecMaxFreq] = useState(5000);
  const [specMinIntensity, setSpecMinIntensity] = useState(-100);

  // --- Audio Analysis State ---
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [envelope, setEnvelope] = useState([]);
  const [freqTrack, setFreqTrack] = useState([]);
  const [spectrogram, setSpectrogram] = useState([]);
  const [freqResolution, setFreqResolution] = useState(43);
  const [tonalFlags, setTonalFlags] = useState([]);

  const [threshold, setThreshold] = useState(0.15);
  const [useAdaptiveThreshold, setUseAdaptiveThreshold] = useState(true);
  const [useSpectralGating, setUseSpectralGating] = useState(true);
  const [minDuration, setMinDuration] = useState(0.05);

  // --- Profile Editor State ---
  const [profileName, setProfileName] = useState('My_Custom_Alarm');
  const [cycles, setCycles] = useState(2);
  const [profileSegments, setProfileSegments] = useState([]);
  const [minToneDuration, setMinToneDuration] = useState(0.1);
  const [dropoutTolerance, setDropoutTolerance] = useState(0.15);
  const [resetTimeout, setResetTimeout] = useState(10.0);

  // --- Playback & Interaction State ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(1);
  const [isSynthPlaying, setIsSynthPlaying] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [toast, setToast] = useState(null);

  // --- YAML Import State ---
  const [yamlImportText, setYamlImportText] = useState('');
  const [yamlImportError, setYamlImportError] = useState('');
  const [showYamlImport, setShowYamlImport] = useState(false);

  // --- Engine Validation State ---
  const [engineResult, setEngineResult] = useState(null);
  const [engineValidating, setEngineValidating] = useState(false);
  // Empty = same origin (works when the engine's `serve` hosts this UI, incl.
  // behind HA Ingress). `npm run dev` still points at the standalone API on :8787.
  const [engineApiUrl, setEngineApiUrl] = useState(
    import.meta.env.DEV ? 'http://localhost:8787' : ''
  );
  const [showEngineLayer, setShowEngineLayer] = useState(true);

  // --- Auto Cycle Detection ---
  const [autoCycleCount, setAutoCycleCount] = useState(null);
  const [autoCyclePeriod, setAutoCyclePeriod] = useState(null);

  // --- Undo ---
  const undoStackRef = useRef([]);

  // --- Drag-and-drop ---
  const [isDragging, setIsDragging] = useState(false);

  // --- Refs ---
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const synthSourceNodeRef = useRef(null);
  const animationRef = useRef(null);
  const isPlayingRef = useRef(isPlaying);
  const isSynthPlayingRef = useRef(isSynthPlaying);
  const spectrumDataRef = useRef(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isSynthPlayingRef.current = isSynthPlaying; }, [isSynthPlaying]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const ensureAudioContext = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'suspended') await ctx.resume();
  }, []);

  const pushUndo = useCallback((label) => {
    undoStackRef.current.push({
      label,
      audioBuffer,
      profileSegments,
      profileName,
      cycles,
      minToneDuration,
      dropoutTolerance,
      resetTimeout,
      threshold,
      minDuration,
    });
    if (undoStackRef.current.length > 10) undoStackRef.current.shift();
  }, [audioBuffer, profileSegments, profileName, cycles, minToneDuration, dropoutTolerance, resetTimeout, threshold, minDuration]);

  const undo = useCallback(() => {
    const snap = undoStackRef.current.pop();
    if (!snap) return;
    if (snap.audioBuffer) {
      setAudioBuffer(snap.audioBuffer);
      runAnalysis(snap.audioBuffer);
    }
    setProfileSegments(snap.profileSegments);
    setProfileName(snap.profileName);
    setCycles(snap.cycles);
    setMinToneDuration(snap.minToneDuration);
    setDropoutTolerance(snap.dropoutTolerance);
    setResetTimeout(snap.resetTimeout);
    setThreshold(snap.threshold);
    setMinDuration(snap.minDuration);
    showToast(`Undo: ${snap.label}`);
    // runAnalysis is a stable ([]-deps) callback declared below; keep it OUT of
    // this deps array. The array is evaluated during render, so listing a
    // not-yet-initialized const here throws "Cannot access before initialization"
    // and blanks the whole app on mount. The body call resolves at call time.
  }, [showToast]);

  const loadAudioFile = useCallback(async (file) => {
    await ensureAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const ctx = audioContextRef.current;
    try {
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);
      setFileName(file.name);
      setProfileSegments([]);
      runAnalysis(buffer);
      showToast(`Loaded ${file.name}`);
    } catch {
      showToast('Error decoding audio file');
    }
    // runAnalysis omitted from deps for the same reason as in `undo` above
    // (stable callback declared later; listing it here would TDZ at mount).
  }, [ensureAudioContext, showToast]);

  // --- Init Audio Context ---
  useEffect(() => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    audioContextRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.8;
    analyserNodeRef.current = analyser;

    generateDemoSignal();

    return () => {
      if (ctx.state !== 'closed') ctx.close();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      synthSourceNodeRef.current?.stop();
    };
  }, []);

  // Scale canvas backing store to match CSS size * devicePixelRatio.
  // Returns the CSS (logical) dimensions for drawing.
  const scaleCanvas = useCallback((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: w, height: h, ctx };
  }, []);

  const analysisWorkerRef = useRef(null);
  const [analyzing, setAnalyzing] = useState(false);

  const runAnalysis = useCallback((buffer) => {
    if (spectrumDataRef.current) spectrumDataRef.current.fill(-140);

    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // Use Web Worker for files > 5 seconds to keep UI responsive
    if (buffer.duration > 5) {
      setAnalyzing(true);
      if (analysisWorkerRef.current) analysisWorkerRef.current.terminate();

      const worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
      analysisWorkerRef.current = worker;

      worker.onmessage = (e) => {
        const analysis = e.data;
        setEnvelope(analysis.envelope);
        setFreqTrack(analysis.freqTrack);
        setSpectrogram(analysis.spectrogram);
        setFreqResolution(analysis.freqResolution);
        setTonalFlags(analysis.tonalFlags);
        setAnalyzing(false);
        worker.terminate();
        analysisWorkerRef.current = null;
      };

      worker.onerror = () => {
        // Fallback to main thread if worker fails
        const analysis = analyzeAudio(buffer, 10);
        setEnvelope(analysis.envelope);
        setFreqTrack(analysis.freqTrack);
        setSpectrogram(analysis.spectrogram);
        setFreqResolution(analysis.freqResolution);
        setTonalFlags(analysis.tonalFlags);
        setAnalyzing(false);
      };

      // Copy channel data (can't transfer AudioBuffer directly)
      const dataCopy = new Float32Array(channelData);
      worker.postMessage({ channelData: dataCopy, sampleRate, windowMs: 10 }, [dataCopy.buffer]);
    } else {
      const analysis = analyzeAudio(buffer, 10);
      setEnvelope(analysis.envelope);
      setFreqTrack(analysis.freqTrack);
      setSpectrogram(analysis.spectrogram);
      setFreqResolution(analysis.freqResolution);
      setTonalFlags(analysis.tonalFlags);
    }
  }, []);

  const generateDemoSignal = async () => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const sampleRate = ctx.sampleRate;
    const duration = 4.0;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    const freq = 3100;
    const beeps = [
      { start: 0.2, end: 0.7 },
      { start: 1.2, end: 1.7 },
      { start: 2.2, end: 2.7 },
    ];

    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      let isBeep = false;
      for (const b of beeps) if (t >= b.start && t <= b.end) isBeep = true;
      if (isBeep) data[i] = Math.sin(2 * Math.PI * freq * t) * 0.8;
      data[i] += (Math.random() * 2 - 1) * 0.18;
    }

    setAudioBuffer(buffer);
    runAnalysis(buffer);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await loadAudioFile(file);
  };

  useEffect(() => {
    if (audioBuffer) {
      setCropStart(0);
      setCropEnd(audioBuffer.duration);
      setCurrentTime(0);
    }
  }, [audioBuffer]);

  // Drag-and-drop audio anywhere on the page
  useEffect(() => {
    let dragCount = 0;
    const onDragEnter = (e) => { e.preventDefault(); dragCount++; setIsDragging(true); };
    const onDragLeave = (e) => { e.preventDefault(); dragCount--; if (dragCount <= 0) { dragCount = 0; setIsDragging(false); } };
    const onDragOver = (e) => e.preventDefault();
    const onDrop = (e) => {
      e.preventDefault();
      dragCount = 0;
      setIsDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('audio/')) loadAudioFile(file);
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [loadAudioFile]);

  // Persist profile state to localStorage
  useEffect(() => {
    if (profileSegments.length === 0) return;
    const state = { profileName, cycles, profileSegments, minToneDuration, dropoutTolerance, resetTimeout, threshold, minDuration, useAdaptiveThreshold, useSpectralGating, engineApiUrl };
    try { localStorage.setItem('acoustic-tuner-state', JSON.stringify(state)); } catch {}
  }, [profileName, cycles, profileSegments, minToneDuration, dropoutTolerance, resetTimeout, threshold, minDuration, useAdaptiveThreshold, useSpectralGating, engineApiUrl]);

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('acoustic-tuner-state');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.profileName) setProfileName(s.profileName);
      if (s.cycles) setCycles(s.cycles);
      if (s.profileSegments?.length) setProfileSegments(s.profileSegments);
      if (s.minToneDuration != null) setMinToneDuration(s.minToneDuration);
      if (s.dropoutTolerance != null) setDropoutTolerance(s.dropoutTolerance);
      if (s.resetTimeout != null) setResetTimeout(s.resetTimeout);
      if (s.threshold != null) setThreshold(s.threshold);
      if (s.minDuration != null) setMinDuration(s.minDuration);
      if (s.useAdaptiveThreshold != null) setUseAdaptiveThreshold(s.useAdaptiveThreshold);
      if (s.useSpectralGating != null) setUseSpectralGating(s.useSpectralGating);
      if (s.engineApiUrl) setEngineApiUrl(s.engineApiUrl);
    } catch {}
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [audioBuffer, isPlaying, currentTime, undo]);

  // --- Playback Controls ---
  const togglePlayback = async () => {
    await ensureAudioContext();
    const ctx = audioContextRef.current;
    if (!ctx || !audioBuffer) return;

    if (isPlaying) {
      if (sourceNodeRef.current) {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
      }
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
    } else {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyserNodeRef.current);
      analyserNodeRef.current.connect(ctx.destination);

      let offset = currentTime;
      if (offset >= audioBuffer.duration) offset = 0;

      source.onended = () => {
        setIsPlaying(false);
        cancelAnimationFrame(animationRef.current);
        setCurrentTime(0);
      };

      source.start(0, offset);
      sourceNodeRef.current = source;
      setIsPlaying(true);

      const startCtxTime = ctx.currentTime - offset;
      const animate = () => {
        const newTime = ctx.currentTime - startCtxTime;
        if (newTime >= audioBuffer.duration) {
          setCurrentTime(0);
          setIsPlaying(false);
          return;
        }
        setCurrentTime(newTime);
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    }
  };

  const startPlaybackFromTime = async (newTime) => {
    await ensureAudioContext();
    const ctx = audioContextRef.current;
    if (!ctx || !audioBuffer) return;

    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null;
      sourceNodeRef.current.stop();
    }
    cancelAnimationFrame(animationRef.current);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyserNodeRef.current);
    analyserNodeRef.current.connect(ctx.destination);

    source.onended = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
      setCurrentTime(0);
    };

    source.start(0, newTime);
    sourceNodeRef.current = source;

    const startCtxTime = ctx.currentTime - newTime;
    const animate = () => {
      const t = ctx.currentTime - startCtxTime;
      if (t >= audioBuffer.duration) {
        setCurrentTime(0);
        setIsPlaying(false);
        return;
      }
      setCurrentTime(t);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
  };

  const applyCrop = () => {
    if (!audioBuffer) return;
    pushUndo('crop');
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(cropStart * sampleRate);
    const endSample = Math.floor(cropEnd * sampleRate);
    const frameCount = endSample - startSample;
    if (frameCount <= 0) return;

    const ctx = audioContextRef.current;
    const newBuffer = ctx.createBuffer(1, frameCount, sampleRate);
    newBuffer.copyToChannel(audioBuffer.getChannelData(0).subarray(startSample, endSample), 0);

    if (isPlaying) togglePlayback();

    setAudioBuffer(newBuffer);
    runAnalysis(newBuffer);
  };

  // --- Mouse Interaction ---
  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, x / rect.width));

    if (viewMode === 'timeline') {
      if (!audioBuffer || envelope.length === 0) return;
      const time = progress * audioBuffer.duration;
      const idx = Math.max(0, Math.min(Math.floor(progress * envelope.length), envelope.length - 1));

      setHoverInfo({
        mode: 'timeline', time, progress,
        freq: freqTrack[idx] || 0,
        env: envelope[idx] || 0,
      });
    } else if (viewMode === 'spectrum') {
      const freq = specMinFreq + progress * (specMaxFreq - specMinFreq);
      let actualDb = specMinIntensity;

      if (spectrumDataRef.current) {
        const sampleRate = audioContextRef.current?.sampleRate || 44100;
        const bufferLength = spectrumDataRef.current.length;
        const freqRes = (sampleRate / 2) / bufferLength;
        const bin = Math.max(0, Math.min(bufferLength - 1, Math.round(freq / freqRes)));
        actualDb = spectrumDataRef.current[bin];
      }

      setHoverInfo({ mode: 'spectrum', progress, freq, db: actualDb });
    }
  };

  const handleCanvasClick = (e) => {
    if (viewMode !== 'timeline' || !audioBuffer) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, x / rect.width));
    const newTime = progress * audioBuffer.duration;

    setCurrentTime(newTime);
    if (isPlaying) startPlaybackFromTime(newTime);
  };

  // --- Effective threshold (adaptive or raw) ---
  const effectiveThreshold = useMemo(() => {
    if (!useAdaptiveThreshold) return threshold;
    return computeAdaptiveThreshold(envelope, threshold);
  }, [envelope, threshold, useAdaptiveThreshold]);

  // --- Segment Detection (with FFT freq + spectral gating) ---
  const analyzerSegments = useMemo(() => {
    if (!audioBuffer || envelope.length === 0) return [];

    const windowMs = 10;
    const rawSegments = [];
    let currentType = (envelope[0] >= effectiveThreshold && (!useSpectralGating || tonalFlags[0])) ? 'tone' : 'silence';
    let currentStart = 0;

    for (let i = 1; i < envelope.length; i++) {
      const aboveThreshold = envelope[i] >= effectiveThreshold;
      const isTonal = !useSpectralGating || tonalFlags[i];
      const type = (aboveThreshold && isTonal) ? 'tone' : 'silence';

      if (type !== currentType) {
        rawSegments.push({
          type: currentType,
          startTime: (currentStart * windowMs) / 1000,
          endTime: (i * windowMs) / 1000,
        });
        currentType = type;
        currentStart = i;
      }
    }
    rawSegments.push({
      type: currentType,
      startTime: (currentStart * windowMs) / 1000,
      endTime: (envelope.length * windowMs) / 1000,
    });

    // Merge short segments (noise filter)
    const filteredSegments = [];
    for (const seg of rawSegments) {
      const dur = seg.endTime - seg.startTime;
      if (filteredSegments.length === 0) {
        filteredSegments.push(seg);
        continue;
      }
      const prev = filteredSegments[filteredSegments.length - 1];
      if (dur < minDuration) prev.endTime = seg.endTime;
      else if (prev.type === seg.type) prev.endTime = seg.endTime;
      else filteredSegments.push(seg);
    }

    // Trim leading silence
    const trimmed = filteredSegments.length > 0 && filteredSegments[0].type === 'silence'
      ? filteredSegments.slice(1) : filteredSegments;

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    return trimmed.map(seg => {
      const dur = seg.endTime - seg.startTime;
      const res = {
        type: seg.type, start: seg.startTime, duration: dur,
        durMin: Math.max(0.05, dur * 0.8).toFixed(2),
        durMax: (dur * 1.2).toFixed(2),
      };
      if (seg.type === 'tone') {
        const startSample = Math.floor(seg.startTime * sampleRate);
        const endSample = Math.floor(seg.endTime * sampleRate);
        const freq = estimateFrequencyFFT(channelData, sampleRate, startSample, endSample);
        const baseFreq = Math.round(freq / 10) * 10;
        res.freq = freq;
        res.freqMin = Math.max(0, baseFreq - 100);
        res.freqMax = baseFreq + 100;
      }
      return res;
    });
  }, [audioBuffer, envelope, tonalFlags, effectiveThreshold, useSpectralGating, minDuration]);

  // --- Auto cycle detection ---
  useEffect(() => {
    if (analyzerSegments.length < 2) {
      setAutoCycleCount(null);
      setAutoCyclePeriod(null);
      return;
    }
    const types = analyzerSegments.map(s => s.type);
    const period = detectCyclePeriod(types);
    const cycleCount = Math.floor(types.length / period);

    setAutoCyclePeriod(period);
    setAutoCycleCount(cycleCount > 1 ? cycleCount : 1);
  }, [analyzerSegments]);

  // --- Evaluation against profile ---
  const evaluatedSegments = useMemo(() => {
    return analyzerSegments.map(seg => {
      if (profileSegments.length === 0) return { ...seg, matched: true };

      let matched = false;
      if (seg.type === 'tone') {
        const toneProfiles = profileSegments.filter(p => p.type === 'tone');
        if (toneProfiles.length === 0) matched = true;
        else {
          matched = toneProfiles.some(p => {
            const fMin = parseFloat(p.freqMin) || 0;
            const fMax = parseFloat(p.freqMax) || Infinity;
            const dMin = parseFloat(p.durMin) || 0;
            const dMax = parseFloat(p.durMax) || Infinity;
            return seg.freq >= fMin && seg.freq <= fMax && seg.duration >= dMin && seg.duration <= dMax;
          });
        }
      } else {
        const silenceProfiles = profileSegments.filter(p => p.type === 'silence');
        if (silenceProfiles.length === 0) matched = true;
        else {
          matched = silenceProfiles.some(p => {
            const dMin = parseFloat(p.durMin) || 0;
            const dMax = parseFloat(p.durMax) || Infinity;
            return seg.duration >= dMin && seg.duration <= dMax;
          });
        }
      }
      return { ...seg, matched };
    });
  }, [analyzerSegments, profileSegments]);

  const matchSummary = useMemo(() => {
    if (profileSegments.length === 0 || evaluatedSegments.length === 0) return null;
    const matched = evaluatedSegments.filter(s => s.matched).length;
    const total = evaluatedSegments.length;
    return { matched, total, allMatch: matched === total };
  }, [evaluatedSegments, profileSegments]);

  // Auto-extract on first analysis
  useEffect(() => {
    if (profileSegments.length === 0 && analyzerSegments.length > 0) extractToProfile();
  }, [analyzerSegments]);

  // --- Profile Extraction ---
  const extractToProfile = () => {
    if (analyzerSegments.length === 0) return;
    pushUndo('extract');

    let finalSegments = [];
    const detectedCycles = autoCycleCount || 1;
    const period = autoCyclePeriod || analyzerSegments.length;

    if (detectedCycles > 1 && period < analyzerSegments.length) {
      const segmentsPerCycle = period;

      for (let pos = 0; pos < segmentsPerCycle; pos++) {
        const baseType = analyzerSegments[pos].type;

        let sumDurMin = 0, sumDurMax = 0;
        let sumFreqMin = 0, sumFreqMax = 0;
        let freqCount = 0, validDurationCount = 0;
        let typesMismatch = false;

        for (let c = 0; c < detectedCycles; c++) {
          const segIdx = c * segmentsPerCycle + pos;
          if (segIdx >= analyzerSegments.length) continue;

          const seg = analyzerSegments[segIdx];
          if (seg.type !== baseType) { typesMismatch = true; break; }

          // Skip final trailing silence (crop artifact)
          if (c === detectedCycles - 1 && pos === segmentsPerCycle - 1 && baseType === 'silence') continue;

          sumDurMin += parseFloat(seg.durMin);
          sumDurMax += parseFloat(seg.durMax);
          validDurationCount++;

          if (seg.type === 'tone') {
            sumFreqMin += parseFloat(seg.freqMin);
            sumFreqMax += parseFloat(seg.freqMax);
            freqCount++;
          }
        }

        if (typesMismatch) {
          // Fall through to 1:1 extraction
          finalSegments = [];
          break;
        }

        const divisor = validDurationCount > 0 ? validDurationCount : 1;
        const entry = {
          id: crypto.randomUUID(), type: baseType,
          durMin: parseFloat((sumDurMin / divisor).toFixed(2)),
          durMax: parseFloat((sumDurMax / divisor).toFixed(2)),
          freqMin: '', freqMax: '',
        };

        if (baseType === 'tone' && freqCount > 0) {
          entry.freqMin = Math.round(sumFreqMin / freqCount);
          entry.freqMax = Math.round(sumFreqMax / freqCount);
        }
        finalSegments.push(entry);
      }
    }

    // 1:1 fallback
    if (finalSegments.length === 0) {
      finalSegments = analyzerSegments.map(seg => ({
        id: crypto.randomUUID(), type: seg.type,
        freqMin: seg.type === 'tone' ? seg.freqMin : '',
        freqMax: seg.type === 'tone' ? seg.freqMax : '',
        durMin: parseFloat(seg.durMin), durMax: parseFloat(seg.durMax),
      }));
    }

    setProfileSegments(finalSegments);
    setMinToneDuration(minDuration);
    if (detectedCycles > 1) setCycles(Math.max(2, detectedCycles));
    showToast(`Extracted ${finalSegments.length} segments${detectedCycles > 1 ? ` (averaged ${detectedCycles} cycles)` : ''}`);
  };

  // --- Profile CRUD ---
  const updateProfileSegment = (id, field, value) =>
    setProfileSegments(prev => prev.map(seg => seg.id === id ? { ...seg, [field]: value } : seg));
  const removeProfileSegment = (id) =>
    setProfileSegments(prev => prev.filter(seg => seg.id !== id));
  const addProfileSegment = (type) => {
    setProfileSegments(prev => [...prev, {
      id: crypto.randomUUID(), type,
      freqMin: type === 'tone' ? 3000 : '', freqMax: type === 'tone' ? 3200 : '',
      durMin: 0.1, durMax: 0.5,
    }]);
  };

  // --- YAML Import ---
  const importYAML = () => {
    setYamlImportError('');
    pushUndo('import YAML');
    try {
      const data = jsyaml.load(yamlImportText);
      if (!data || typeof data !== 'object') throw new Error('Invalid YAML structure');

      setProfileName(data.name || 'Imported_Profile');
      setCycles(parseInt(data.confirmation_cycles) || 2);
      setResetTimeout(parseFloat(data.reset_timeout) || 10.0);

      if (data.resolution) {
        setMinToneDuration(parseFloat(data.resolution.min_tone_duration) || 0.1);
        setDropoutTolerance(parseFloat(data.resolution.dropout_tolerance) || 0.15);
      }

      const segments = (data.segments || []).map(seg => ({
        id: crypto.randomUUID(),
        type: seg.type || 'tone',
        freqMin: seg.frequency?.min ?? '',
        freqMax: seg.frequency?.max ?? '',
        durMin: seg.duration?.min ?? 0.1,
        durMax: seg.duration?.max ?? 1.0,
      }));

      setProfileSegments(segments);
      setShowYamlImport(false);
      setYamlImportText('');
    } catch (err) {
      setYamlImportError(err.message);
    }
  };

  const handleYamlFileDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    const text = await file.text();
    setYamlImportText(text);
  };

  // --- Synthetic Audio ---
  const toggleSyntheticAudio = async () => {
    await ensureAudioContext();
    if (isSynthPlaying) {
      synthSourceNodeRef.current?.stop();
      setIsSynthPlaying(false);
      return;
    }
    if (profileSegments.length === 0) return alert('Profile is empty!');

    const ctx = audioContextRef.current;
    let totalDuration = 0;
    const sequence = [];

    for (let c = 0; c < cycles; c++) {
      for (const seg of profileSegments) {
        const dMin = parseFloat(seg.durMin) || 0;
        const dMax = parseFloat(seg.durMax) || 0.1;
        const duration = dMin + Math.random() * (dMax - dMin);

        let freq = 0;
        if (seg.type === 'tone') {
          const fMin = parseFloat(seg.freqMin) || 1000;
          const fMax = parseFloat(seg.freqMax) || 1000;
          freq = fMin + Math.random() * (fMax - fMin);
        }

        sequence.push({ type: seg.type, duration, freq, start: totalDuration });
        totalDuration += duration;
      }
    }
    if (totalDuration === 0) return;

    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * totalDuration, sampleRate);
    const data = buffer.getChannelData(0);

    for (const item of sequence) {
      if (item.type !== 'tone') continue;
      const startSample = Math.floor(item.start * sampleRate);
      const endSample = Math.floor((item.start + item.duration) * sampleRate);

      for (let i = startSample; i < endSample; i++) {
        const t = i / sampleRate;
        const localT = t - item.start;
        let env = 1;
        if (localT < 0.005) env = localT / 0.005;
        if (item.duration - localT < 0.005) env = (item.duration - localT) / 0.005;

        const base = Math.sin(2 * Math.PI * item.freq * t);
        const harm = Math.sin(2 * Math.PI * (item.freq * 2) * t) * 0.2;
        data[i] = (base + harm) * 0.6 * env;
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyserNodeRef.current);
    analyserNodeRef.current.connect(ctx.destination);
    source.onended = () => setIsSynthPlaying(false);
    source.start();
    synthSourceNodeRef.current = source;
    setIsSynthPlaying(true);
  };

  // --- Engine Validation ---
  const validateWithEngine = async () => {
    if (!audioBuffer || profileSegments.length === 0) return;

    setEngineValidating(true);
    setEngineResult(null);

    try {
      // Convert AudioBuffer to WAV bytes
      const numSamples = audioBuffer.length;
      const sampleRate = audioBuffer.sampleRate;
      const channelData = audioBuffer.getChannelData(0);
      const int16 = new Int16Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const wavHeader = new ArrayBuffer(44);
      const view = new DataView(wavHeader);
      const dataSize = int16.byteLength;
      // RIFF header
      view.setUint32(0, 0x52494646, false); // "RIFF"
      view.setUint32(4, 36 + dataSize, true);
      view.setUint32(8, 0x57415645, false); // "WAVE"
      // fmt chunk
      view.setUint32(12, 0x666D7420, false); // "fmt "
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true); // byte rate
      view.setUint16(32, 2, true); // block align
      view.setUint16(34, 16, true); // bits per sample
      // data chunk
      view.setUint32(36, 0x64617461, false); // "data"
      view.setUint32(40, dataSize, true);

      const wavBlob = new Blob([wavHeader, int16.buffer], { type: 'audio/wav' });

      const yamlStr = generateYAML();
      const formData = new FormData();
      formData.append('audio', wavBlob, 'audio.wav');
      formData.append('profile_yaml', yamlStr);

      // Empty engineApiUrl -> same origin, resolved relative to the current
      // document so it works under HA Ingress path prefixes.
      const apiUrl = engineApiUrl
        ? `${engineApiUrl.replace(/\/+$/, '')}/validate`
        : new URL('validate', document.baseURI).href;
      const resp = await fetch(apiUrl, { method: 'POST', body: formData });
      const data = await resp.json();

      if (data.error) throw new Error(data.error);

      setEngineResult(data);
      showToast(`Engine: ${data.tone_events.length} tones, ${data.detections.length} detection(s)`);
    } catch (err) {
      showToast(`Engine validation failed: ${err.message}`);
    } finally {
      setEngineValidating(false);
    }
  };

  // --- YAML Generation (matches engine schema from profiles.py) ---
  const generateYAML = useCallback(() => {
    const profileData = {
      name: profileName,
      confirmation_cycles: cycles,
      reset_timeout: resetTimeout,
    };

    if (minToneDuration !== 0.1 || dropoutTolerance !== 0.15) {
      profileData.resolution = {
        min_tone_duration: minToneDuration,
        dropout_tolerance: dropoutTolerance,
      };
    }

    profileData.segments = profileSegments.map(seg => {
      const entry = { type: seg.type };
      if (seg.type === 'tone' && seg.freqMin !== '' && seg.freqMax !== '') {
        entry.frequency = {
          min: parseFloat(seg.freqMin),
          max: parseFloat(seg.freqMax),
        };
      }
      entry.duration = {
        min: parseFloat(seg.durMin),
        max: parseFloat(seg.durMax),
      };
      return entry;
    });

    return jsyaml.dump(profileData, { lineWidth: -1, noRefs: true, quotingType: '"' });
  }, [profileName, cycles, resetTimeout, minToneDuration, dropoutTolerance, profileSegments]);

  const downloadYAML = () => {
    const yamlStr = generateYAML();
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(profileName || 'profile').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- Rendering: Live Spectrum ---
  useEffect(() => {
    if (viewMode !== 'spectrum') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const analyser = analyserNodeRef.current;
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    if (!spectrumDataRef.current || spectrumDataRef.current.length !== bufferLength) {
      spectrumDataRef.current = new Float32Array(bufferLength);
      spectrumDataRef.current.fill(-140);
    }
    const dataArray = spectrumDataRef.current;
    const sampleRate = audioContextRef.current?.sampleRate || 44100;

    let animationId;

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      if (isPlayingRef.current || isSynthPlayingRef.current) {
        analyser.getFloatFrequencyData(dataArray);
      }

      const { width, height, ctx } = scaleCanvas(canvas);
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px sans-serif';

      for (let db = specMinIntensity; db <= 0; db += 20) {
        const y = height - ((db - specMinIntensity) / (0 - specMinIntensity)) * height;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        ctx.fillText(`${db}dB`, 5, y - 2);
      }

      const freqStep = (specMaxFreq - specMinFreq) / 5;
      for (let f = specMinFreq; f <= specMaxFreq; f += freqStep) {
        const x = ((f - specMinFreq) / (specMaxFreq - specMinFreq)) * width;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.fillText(`${Math.round(f)}Hz`, x + 5, height - 10);
      }

      ctx.beginPath();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;

      const freqRes = (sampleRate / 2) / bufferLength;
      const startBin = Math.floor(specMinFreq / freqRes);
      const endBin = Math.min(bufferLength - 1, Math.ceil(specMaxFreq / freqRes));
      const numBins = endBin - startBin;

      let isFirst = true;
      for (let i = startBin; i <= endBin; i++) {
        const x = ((i - startBin) / numBins) * width;
        let db = dataArray[i];
        if (db < specMinIntensity) db = specMinIntensity;
        const y = height - ((db - specMinIntensity) / (0 - specMinIntensity)) * height;

        if (isFirst) { ctx.moveTo(x, y); isFirst = false; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.fillStyle = 'rgba(249, 115, 22, 0.15)';
      ctx.fill();
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [viewMode, specMinFreq, specMaxFreq, specMinIntensity]);

  // --- Rendering: Timeline ---
  useEffect(() => {
    if (viewMode !== 'timeline') return;
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer || envelope.length === 0) return;

    const { width, height, ctx } = scaleCanvas(canvas);

    ctx.clearRect(0, 0, width, height);

    if (showSpectrogram && spectrogram.length > 0) {
      const dpr = window.devicePixelRatio || 1;
      const pxWidth = Math.round(width * dpr);
      const pxHeight = Math.round(height * dpr);
      const maxFreqToDraw = 5000;
      const maxBin = Math.min(Math.floor(maxFreqToDraw / freqResolution), spectrogram[0].length - 1);
      // putImageData/createImageData operate in raw pixel space
      const rawCtx = canvas.getContext('2d');
      rawCtx.save();
      rawCtx.setTransform(1, 0, 0, 1, 0, 0);
      const imgData = rawCtx.createImageData(pxWidth, pxHeight);

      for (let x = 0; x < pxWidth; x++) {
        const tIndex = Math.floor((x / pxWidth) * spectrogram.length);
        const mags = spectrogram[tIndex];
        if (!mags) continue;

        for (let y = 0; y < pxHeight; y++) {
          const freqBin = Math.floor((1 - y / pxHeight) * maxBin);
          const mag = mags[freqBin] || 0;
          const val = Math.min(1, mag * 25);

          const pIndex = (y * pxWidth + x) * 4;
          imgData.data[pIndex] = val * 255;
          imgData.data[pIndex + 1] = val > 0.4 ? (val - 0.4) * 1.66 * 255 : 0;
          imgData.data[pIndex + 2] = val > 0.8 ? (val - 0.8) * 5 * 255 : (val < 0.3 ? val * 100 : 0);
          imgData.data[pIndex + 3] = 255;
        }
      }
      rawCtx.putImageData(imgData, 0, 0);
      rawCtx.restore();
      // Restore DPR scale for subsequent vector drawing
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Grid lines
    ctx.strokeStyle = showSpectrogram ? 'rgba(255,255,255,0.1)' : '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const y = height - (i / 10) * height;
      ctx.moveTo(0, y); ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Envelope
    if (showEnvelope) {
      ctx.fillStyle = showSpectrogram ? 'rgba(59, 130, 246, 0.4)' : '#3b82f6';
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < envelope.length; i++) {
        const x = (i / envelope.length) * width;
        const y = height - envelope[i] * height;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.fill();
    }

    // Pitch track
    if (showPitchTrack && freqTrack.length > 0) {
      const MAX_FREQ = 5000;
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.3)';
      ctx.setLineDash([2, 4]);
      ctx.fillStyle = 'rgba(249, 115, 22, 0.8)';
      ctx.font = '10px sans-serif';
      for (let f = 1000; f <= 4000; f += 1000) {
        const y = height - (f / MAX_FREQ) * height;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        ctx.fillText(`${f}Hz`, width - 35, y - 4);
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let isDrawing = false;
      for (let i = 0; i < freqTrack.length; i++) {
        const freq = freqTrack[i];
        const x = (i / freqTrack.length) * width;
        if (freq > 0) {
          const y = height - (Math.min(freq, MAX_FREQ) / MAX_FREQ) * height;
          if (!isDrawing) { ctx.moveTo(x, y); isDrawing = true; }
          else ctx.lineTo(x, y);
        } else isDrawing = false;
      }
      ctx.stroke();
    }

    // Segment overlays
    const totalDuration = audioBuffer.duration;
    evaluatedSegments.forEach(seg => {
      if (seg.type === 'tone') {
        const x = (seg.start / totalDuration) * width;
        const w = (seg.duration / totalDuration) * width;
        if (profileSegments.length > 0 && !seg.matched) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'; ctx.fillRect(x, 0, w, height);
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.strokeRect(x, 0, w, height);
        } else {
          ctx.fillStyle = 'rgba(34, 197, 94, 0.3)'; ctx.fillRect(x, 0, w, height);
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.strokeRect(x, 0, w, height);
        }
      }
    });

    // Engine validation tone events (cyan layer)
    if (showEngineLayer && engineResult?.tone_events?.length > 0) {
      engineResult.tone_events.forEach(evt => {
        const x = (evt.timestamp / totalDuration) * width;
        const w = Math.max(2, (evt.duration / totalDuration) * width);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.25)';
        ctx.fillRect(x, 0, w, height);
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x, 0, w, height);
        ctx.setLineDash([]);

        // Frequency label
        ctx.fillStyle = '#06b6d4';
        ctx.font = '9px sans-serif';
        ctx.fillText(`${Math.round(evt.frequency)}Hz`, x + 2, 12);
      });
    }

    // Threshold line
    const thresholdY = height - effectiveThreshold * height;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(0, thresholdY); ctx.lineTo(width, thresholdY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(0, thresholdY - 10, 55, 20);
    ctx.fillStyle = 'white'; ctx.font = '11px sans-serif';
    ctx.fillText(`${Math.round(effectiveThreshold * 100)}%`, 5, thresholdY + 4);
  }, [viewMode, envelope, freqTrack, spectrogram, freqResolution, showEnvelope, showPitchTrack, showSpectrogram, effectiveThreshold, evaluatedSegments, audioBuffer, profileSegments, engineResult, showEngineLayer]);

  // --- JSX ---
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans overflow-x-hidden">
      <div className="max-w-[1400px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2 text-white">
              <Activity className="text-blue-500" /> Acoustic Profile Tuner
            </h1>
            <p className="text-slate-400 mt-1">Extract, tweak, and export YAML alarm configurations.</p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 transition px-4 py-2 rounded-lg flex items-center gap-2 font-medium border border-slate-600 text-sm">
              <Upload size={16} /> Load Audio
              <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
            </label>
            <button onClick={() => setShowYamlImport(!showYamlImport)} className="bg-slate-700 hover:bg-slate-600 transition px-4 py-2 rounded-lg flex items-center gap-2 font-medium border border-slate-600 text-sm text-amber-400">
              <FileUp size={16} /> Import YAML
            </button>
            <button onClick={undo} disabled={undoStackRef.current.length === 0} className="bg-slate-800 hover:bg-slate-700 transition px-4 py-2 rounded-lg flex items-center gap-2 text-slate-300 border border-slate-700 text-sm disabled:opacity-30" title="Undo (Ctrl+Z)">
              <Undo2 size={16} />
            </button>
            <button onClick={generateDemoSignal} className="bg-slate-800 hover:bg-slate-700 transition px-4 py-2 rounded-lg flex items-center gap-2 text-slate-300 border border-slate-700 text-sm">
              <RefreshCw size={16} /> Reset Demo
            </button>
            <button
              onClick={togglePlayback} disabled={!audioBuffer}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition text-sm ${isPlaying ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50' : 'bg-blue-600 hover:bg-blue-500 text-white border border-blue-500'} disabled:opacity-50`}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>
        </div>

        {/* YAML Import Panel */}
        {showYamlImport && (
          <div className="bg-slate-800 p-6 rounded-xl border border-amber-500/30 shadow-lg space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold flex items-center gap-2 text-amber-400"><FileText size={18} /> Import YAML Profile</h2>
              <button onClick={() => setShowYamlImport(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
            </div>
            <div
              className="border-2 border-dashed border-slate-600 rounded-lg p-4 text-center text-slate-400 text-sm"
              onDrop={handleYamlFileDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              Drop a .yaml file here, or paste below
              <label className="ml-2 text-amber-400 underline cursor-pointer">
                browse
                <input type="file" accept=".yaml,.yml" onChange={handleYamlFileDrop} className="hidden" />
              </label>
            </div>
            <textarea
              value={yamlImportText}
              onChange={(e) => setYamlImportText(e.target.value)}
              placeholder={'name: "Smoke_Alarm"\nconfirmation_cycles: 2\nsegments:\n  - type: "tone"\n    frequency: { min: 3150, max: 3350 }\n    duration: { min: 0.5, max: 0.7 }'}
              className="w-full h-40 bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-green-400 resize-y"
            />
            {yamlImportError && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 p-2 rounded">{yamlImportError}</div>
            )}
            <button onClick={importYAML} disabled={!yamlImportText.trim()} className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white font-medium px-6 py-2 rounded-lg transition text-sm">
              Load into Profile Editor
            </button>
          </div>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Left: Analyzer */}
          <div className="space-y-4">
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg">
              {/* File info + View Toggle */}
              {audioBuffer && (
                <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-400 font-mono bg-slate-900 px-3 py-2 rounded-lg border border-slate-700">
                  {fileName && <span className="text-slate-300">{fileName}</span>}
                  <span>{audioBuffer.duration.toFixed(2)}s</span>
                  <span>{audioBuffer.sampleRate}Hz</span>
                  <span>{audioBuffer.numberOfChannels}ch</span>
                  {matchSummary && (
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${matchSummary.allMatch ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                      {matchSummary.matched}/{matchSummary.total} segments matched
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
                  <button onClick={() => setViewMode('timeline')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition ${viewMode === 'timeline' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Timeline</button>
                  <button onClick={() => setViewMode('spectrum')} className={`flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-md transition ${viewMode === 'spectrum' ? 'bg-orange-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><Radio size={14} /> Live Spectrum</button>
                </div>
                <div className="text-xs text-slate-500">Space = play/pause, Ctrl+Z = undo</div>
              </div>

              {/* Canvas */}
              <div
                className={`relative w-full aspect-[21/9] bg-slate-950 rounded-lg overflow-hidden border border-slate-800 ${viewMode === 'timeline' && audioBuffer ? 'cursor-pointer' : ''}`}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverInfo(null)}
                onClick={handleCanvasClick}
              >
                <canvas ref={canvasRef} className="w-full h-full relative z-0" style={{ imageRendering: 'auto' }} />

                {/* Analyzing spinner */}
                {analyzing && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px]">
                    <div className="flex items-center gap-3 bg-slate-800 px-5 py-3 rounded-lg border border-slate-700 shadow-lg">
                      <Loader2 size={20} className="animate-spin text-blue-400" />
                      <span className="text-sm text-slate-300">Analyzing audio...</span>
                    </div>
                  </div>
                )}

                {/* Playhead */}
                {viewMode === 'timeline' && audioBuffer && (
                  <div className="absolute top-0 bottom-0 w-[2px] bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)] z-20 pointer-events-none" style={{ left: `${(currentTime / audioBuffer.duration) * 100}%` }} />
                )}

                {/* Crop overlay */}
                {viewMode === 'timeline' && audioBuffer && (
                  <>
                    <div className="absolute top-0 bottom-0 bg-slate-900/70 border-r border-slate-600 z-10 pointer-events-none" style={{ left: 0, width: `${(cropStart / audioBuffer.duration) * 100}%` }} />
                    <div className="absolute top-0 bottom-0 bg-slate-900/70 border-l border-slate-600 z-10 pointer-events-none" style={{ right: 0, width: `${(1 - cropEnd / audioBuffer.duration) * 100}%` }} />
                  </>
                )}

                {/* Hover tooltip: Timeline */}
                {viewMode === 'timeline' && hoverInfo?.mode === 'timeline' && (
                  <>
                    <div className="absolute top-0 bottom-0 w-[1px] bg-slate-400/50 z-20 pointer-events-none" style={{ left: `${hoverInfo.progress * 100}%` }} />
                    <div
                      className="absolute z-30 pointer-events-none bg-slate-800/90 border border-slate-600 backdrop-blur-sm text-xs rounded shadow-lg p-2 flex flex-col gap-1 whitespace-nowrap"
                      style={{
                        left: `${hoverInfo.progress * 100}%`, top: '10px',
                        transform: hoverInfo.progress > 0.85 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                      }}
                    >
                      <div className="text-slate-300 flex justify-between gap-3"><span>Time:</span> <span className="text-white font-mono">{hoverInfo.time.toFixed(3)}s</span></div>
                      {showPitchTrack && <div className="text-orange-400 flex justify-between gap-3"><span>Pitch:</span> <span className="font-mono">{hoverInfo.freq > 0 ? `${Math.round(hoverInfo.freq)} Hz` : '---'}</span></div>}
                      {showEnvelope && <div className="text-blue-400 flex justify-between gap-3"><span>Volume:</span> <span className="font-mono">{Math.round(hoverInfo.env * 100)}%</span></div>}
                    </div>
                  </>
                )}

                {/* Hover tooltip: Spectrum */}
                {viewMode === 'spectrum' && hoverInfo?.mode === 'spectrum' && (
                  <>
                    <div className="absolute top-0 bottom-0 w-[1px] bg-slate-400/50 z-20 pointer-events-none" style={{ left: `${hoverInfo.progress * 100}%` }} />
                    <div
                      className="absolute w-2 h-2 rounded-full bg-orange-400 z-20 pointer-events-none -ml-1 -mt-1 shadow-[0_0_8px_rgba(249,115,22,0.8)] transition-all duration-75"
                      style={{
                        left: `${hoverInfo.progress * 100}%`,
                        top: `${100 - ((Math.max(specMinIntensity, hoverInfo.db) - specMinIntensity) / (0 - specMinIntensity)) * 100}%`,
                      }}
                    />
                    <div
                      className="absolute z-30 pointer-events-none bg-slate-800/90 border border-slate-600 backdrop-blur-sm text-xs rounded shadow-lg p-2 flex flex-col gap-1 whitespace-nowrap"
                      style={{
                        left: `${hoverInfo.progress * 100}%`, top: '10px',
                        transform: hoverInfo.progress > 0.85 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                      }}
                    >
                      <div className="text-orange-400 flex justify-between gap-3"><span>Freq:</span> <span className="font-mono">{Math.round(hoverInfo.freq)} Hz</span></div>
                      <div className="text-blue-400 flex justify-between gap-3"><span>Intensity:</span> <span className="font-mono">{hoverInfo.db.toFixed(1)} dB</span></div>
                    </div>
                  </>
                )}
              </div>

              {/* Layer toggles / spectrum settings */}
              {viewMode === 'timeline' ? (
                <div className="mt-4 flex flex-wrap items-center gap-6 bg-slate-900 p-3 rounded-lg border border-slate-700">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Layers:</span>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-white transition">
                    <input type="checkbox" checked={showEnvelope} onChange={e => setShowEnvelope(e.target.checked)} className="accent-blue-500 w-4 h-4" /> Volume Envelope
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-white transition">
                    <input type="checkbox" checked={showPitchTrack} onChange={e => setShowPitchTrack(e.target.checked)} className="accent-orange-500 w-4 h-4" /> Pitch Track
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-white transition">
                    <input type="checkbox" checked={showSpectrogram} onChange={e => setShowSpectrogram(e.target.checked)} className="accent-red-500 w-4 h-4" /> Spectrogram Heatmap
                  </label>
                  {engineResult && (
                    <label className="flex items-center gap-2 text-sm text-cyan-400 cursor-pointer hover:text-cyan-300 transition">
                      <input type="checkbox" checked={showEngineLayer} onChange={e => setShowEngineLayer(e.target.checked)} className="accent-cyan-500 w-4 h-4" /> Engine Results
                    </label>
                  )}
                </div>
              ) : (
                <div className="mt-4 bg-slate-900 p-4 rounded-lg border border-slate-700">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 block">Spectrum Analyzer Settings:</span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="flex justify-between text-xs text-slate-400 mb-2">Min Freq <span className="text-white font-mono">{specMinFreq}Hz</span></label>
                      <input type="range" min="0" max="5000" step="100" value={specMinFreq} onChange={e => { const v = parseInt(e.target.value); if (v < specMaxFreq) setSpecMinFreq(v); }} className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <label className="flex justify-between text-xs text-slate-400 mb-2">Max Freq <span className="text-white font-mono">{specMaxFreq}Hz</span></label>
                      <input type="range" min="1000" max="22000" step="100" value={specMaxFreq} onChange={e => { const v = parseInt(e.target.value); if (v > specMinFreq) setSpecMaxFreq(v); }} className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <label className="flex justify-between text-xs text-slate-400 mb-2">Min Intensity <span className="text-white font-mono">{specMinIntensity}dB</span></label>
                      <input type="range" min="-140" max="-30" step="5" value={specMinIntensity} onChange={e => setSpecMinIntensity(parseInt(e.target.value))} className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  </div>
                </div>
              )}

              {/* Crop */}
              <div className="mt-4 p-4 bg-slate-900 border border-slate-700 rounded-lg space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase flex items-center gap-1"><Scissors size={14} /> Crop Tool</h3>
                  {audioBuffer && <span className="text-xs font-mono text-purple-400">{cropStart.toFixed(2)}s — {cropEnd.toFixed(2)}s ({(cropEnd - cropStart).toFixed(2)}s)</span>}
                </div>
                <div className="grid grid-cols-5 gap-3 items-center">
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-500 mb-1 block">Start</label>
                    <input type="range" min="0" max={audioBuffer?.duration || 1} step="0.01" value={cropStart} onChange={(e) => setCropStart(Math.min(parseFloat(e.target.value), cropEnd - 0.1))} className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" disabled={!audioBuffer} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-500 mb-1 block">End</label>
                    <input type="range" min="0" max={audioBuffer?.duration || 1} step="0.01" value={cropEnd} onChange={(e) => setCropEnd(Math.max(parseFloat(e.target.value), cropStart + 0.1))} className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" disabled={!audioBuffer} />
                  </div>
                  <button onClick={applyCrop} disabled={!audioBuffer} className="col-span-1 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-medium py-2 rounded transition mt-4">Crop</button>
                </div>
              </div>

              {/* Detection Settings */}
              <div className="mt-4 p-4 bg-slate-900 border border-slate-700 rounded-lg space-y-4">
                <div>
                  <label className="flex justify-between text-sm font-medium mb-2 text-slate-300">
                    <span className="flex items-center gap-2"><Settings2 size={16} /> Volume Threshold</span>
                    <span className="text-red-400 font-mono">{Math.round(effectiveThreshold * 100)}%{useAdaptiveThreshold ? ' (adaptive)' : ''}</span>
                  </label>
                  <input type="range" min="0.01" max="0.99" step="0.01" value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))} className="w-full accent-red-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer" />

                  <div className="flex flex-wrap gap-4 mt-3">
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-white transition">
                      <input type="checkbox" checked={useAdaptiveThreshold} onChange={e => setUseAdaptiveThreshold(e.target.checked)} className="accent-emerald-500 w-3.5 h-3.5" />
                      Adaptive (noise-floor relative)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-white transition">
                      <input type="checkbox" checked={useSpectralGating} onChange={e => setUseSpectralGating(e.target.checked)} className="accent-emerald-500 w-3.5 h-3.5" />
                      Spectral Gating (reject broadband noise)
                    </label>
                  </div>

                  <div className="flex items-start gap-2 mt-3 p-2 bg-slate-800 rounded border border-slate-700 text-xs text-slate-400">
                    <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
                    <p><strong>Adaptive threshold</strong> computes a noise floor from the quietest 20% of the signal — so the slider means "how far above noise" rather than absolute volume. <strong>Spectral gating</strong> rejects windows where energy is spread across frequencies (door slams, bumps) rather than concentrated in a peak (alarm tones).</p>
                  </div>
                </div>
                <div>
                  <label className="flex justify-between text-sm font-medium mb-2 text-slate-300">
                    <span>Noise Filter (Min Duration)</span>
                    <span className="text-blue-400 font-mono">{minDuration.toFixed(2)}s</span>
                  </label>
                  <input type="range" min="0.01" max="0.5" step="0.01" value={minDuration} onChange={(e) => setMinDuration(parseFloat(e.target.value))} className="w-full accent-blue-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                </div>

                {/* Auto cycle detection info */}
                {autoCycleCount !== null && autoCyclePeriod !== null && (
                  <div className="pt-2 border-t border-slate-700/50">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Activity size={14} className="text-emerald-400" />
                      <span>
                        Auto-detected: <strong className="text-emerald-400">{autoCycleCount} cycle{autoCycleCount > 1 ? 's' : ''}</strong> ({autoCyclePeriod} segments per cycle)
                      </span>
                    </div>
                  </div>
                )}

                <button onClick={extractToProfile} className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-lg shadow-lg flex items-center justify-center gap-2 transition">
                  <Wand2 size={18} /> Extract to Profile {autoCycleCount > 1 ? `(averaging ${autoCycleCount} cycles)` : ''}
                </button>
              </div>

              {/* Detected Segments Table */}
              {evaluatedSegments.length > 0 && (
                <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase">Detected Segments ({evaluatedSegments.length})</h3>
                    {matchSummary && (
                      <span className={`text-[10px] font-bold ${matchSummary.allMatch ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {matchSummary.allMatch ? 'All matched' : `${matchSummary.total - matchSummary.matched} unmatched`}
                      </span>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="text-slate-500 bg-slate-950 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-1.5 font-medium">Type</th>
                          <th className="text-left px-3 py-1.5 font-medium">Freq (Hz)</th>
                          <th className="text-left px-3 py-1.5 font-medium">Duration</th>
                          <th className="text-left px-3 py-1.5 font-medium">Start</th>
                          {profileSegments.length > 0 && <th className="text-center px-3 py-1.5 font-medium">Match</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {evaluatedSegments.map((seg, i) => (
                          <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/50">
                            <td className={`px-3 py-1.5 font-bold ${seg.type === 'tone' ? 'text-green-400' : 'text-slate-500'}`}>
                              {seg.type === 'tone' ? 'TONE' : 'SILENCE'}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-300">
                              {seg.type === 'tone' ? `${Math.round(seg.freq)}` : '—'}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-300">{seg.duration.toFixed(3)}s</td>
                            <td className="px-3 py-1.5 font-mono text-slate-400">{seg.start.toFixed(2)}s</td>
                            {profileSegments.length > 0 && (
                              <td className="px-3 py-1.5 text-center">
                                <span className={`inline-block w-2 h-2 rounded-full ${seg.matched ? 'bg-emerald-400' : 'bg-red-400'}`} />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Profile Editor + Output */}
          <div className="flex flex-col gap-6">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg flex flex-col flex-grow">
              <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-3">
                <h2 className="font-semibold flex items-center gap-2 text-white"><Settings2 size={18} className="text-orange-400" /> Profile Editor</h2>
              </div>

              {/* Profile metadata */}
              <div className="flex flex-wrap gap-4 mb-4">
                <div className="flex-1 min-w-[150px]">
                  <label className="block text-xs text-slate-400 uppercase mb-1">Name</label>
                  <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white" />
                </div>
                <div className="w-20">
                  <label className="block text-xs text-slate-400 uppercase mb-1">Cycles</label>
                  <input type="number" min="1" value={cycles} onChange={(e) => setCycles(parseInt(e.target.value) || 1)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white" />
                </div>
              </div>

              {/* Advanced fields (collapsed by default) */}
              <button
                onClick={() => setShowAdvancedProfile(!showAdvancedProfile)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition mb-3"
              >
                {showAdvancedProfile ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Advanced: Resolution &amp; Timing
              </button>
              {showAdvancedProfile && (
                <div className="flex flex-wrap gap-4 mb-4 p-3 bg-slate-900 rounded-lg border border-slate-700">
                  <div className="w-24">
                    <label className="block text-[10px] text-slate-400 uppercase mb-1 truncate" title="Min Tone Duration">Min Tone Dur</label>
                    <input type="number" step="0.01" min="0" value={minToneDuration} onChange={(e) => setMinToneDuration(parseFloat(e.target.value) || 0)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                  </div>
                  <div className="w-24">
                    <label className="block text-[10px] text-slate-400 uppercase mb-1 truncate" title="Dropout Tolerance">Dropout Tol</label>
                    <input type="number" step="0.01" min="0" value={dropoutTolerance} onChange={(e) => setDropoutTolerance(parseFloat(e.target.value) || 0)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                  </div>
                  <div className="w-24">
                    <label className="block text-[10px] text-slate-400 uppercase mb-1 truncate" title="Reset Timeout">Reset Timeout</label>
                    <input type="number" step="0.5" min="1" value={resetTimeout} onChange={(e) => setResetTimeout(parseFloat(e.target.value) || 10)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                  </div>
                  <div className="flex-1 text-[10px] text-slate-500 self-end pb-1">
                    These are engine-level settings. Only override if the defaults don't work for your alarm pattern.
                  </div>
                </div>
              )}

              {/* Segment list */}
              <div className="bg-slate-950 rounded-lg border border-slate-800 p-3 flex-1 overflow-y-auto max-h-[400px] space-y-3">
                {profileSegments.length === 0 && <div className="text-center text-slate-500 py-8 text-sm">No segments. Use the Analyzer to extract or add them manually.</div>}
                {profileSegments.map((seg) => (
                  <div key={seg.id} className="bg-slate-800 border border-slate-700 p-3 rounded-lg relative group">
                    <div className="flex flex-wrap gap-3 items-end">
                      <div className="w-24">
                        <label className="block text-[10px] text-slate-400 uppercase mb-1">Type</label>
                        <select value={seg.type} onChange={(e) => updateProfileSegment(seg.id, 'type', e.target.value)} className={`w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-bold ${seg.type === 'tone' ? 'text-green-400' : 'text-slate-400'}`}>
                          <option value="tone">Tone</option>
                          <option value="silence">Silence</option>
                        </select>
                      </div>
                      {seg.type === 'tone' && (
                        <div className="flex gap-2">
                          <div><label className="block text-[10px] text-slate-400 uppercase mb-1">Freq Min</label><input type="number" value={seg.freqMin} onChange={(e) => updateProfileSegment(seg.id, 'freqMin', e.target.value)} className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white" /></div>
                          <div><label className="block text-[10px] text-slate-400 uppercase mb-1">Freq Max</label><input type="number" value={seg.freqMax} onChange={(e) => updateProfileSegment(seg.id, 'freqMax', e.target.value)} className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white" /></div>
                        </div>
                      )}
                      <div className="flex gap-2 ml-auto pr-8">
                        <div><label className="block text-[10px] text-slate-400 uppercase mb-1">Dur Min</label><input type="number" step="0.01" value={seg.durMin} onChange={(e) => updateProfileSegment(seg.id, 'durMin', e.target.value)} className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white" /></div>
                        <div><label className="block text-[10px] text-slate-400 uppercase mb-1">Dur Max</label><input type="number" step="0.01" value={seg.durMax} onChange={(e) => updateProfileSegment(seg.id, 'durMax', e.target.value)} className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white" /></div>
                      </div>
                    </div>
                    <button onClick={() => removeProfileSegment(seg.id)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-red-400 p-1"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-4">
                <button onClick={() => addProfileSegment('tone')} className="flex-1 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg py-2 text-xs font-semibold flex justify-center items-center gap-1 transition text-green-400"><Plus size={14} /> Add Tone</button>
                <button onClick={() => addProfileSegment('silence')} className="flex-1 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg py-2 text-xs font-semibold flex justify-center items-center gap-1 transition text-slate-300"><Plus size={14} /> Add Silence</button>
              </div>
            </div>

            {/* Engine Validation */}
            <div className="bg-slate-800 p-6 rounded-xl border border-cyan-500/30 shadow-lg space-y-4">
              <button
                onClick={validateWithEngine}
                disabled={!audioBuffer || profileSegments.length === 0 || engineValidating}
                className="w-full text-white font-bold py-4 rounded-lg shadow-lg flex items-center justify-center gap-3 transition bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500"
              >
                {engineValidating ? <Loader2 size={24} className="animate-spin" /> : <ShieldCheck size={24} />}
                <div className="text-left leading-tight">
                  <div className="text-lg">{engineValidating ? 'Validating...' : 'Validate with Real Engine'}</div>
                  <div className="text-xs font-normal text-cyan-200">Runs the actual detection pipeline against your audio + profile</div>
                </div>
              </button>

              {engineResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${engineResult.detections.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {engineResult.detections.length > 0
                        ? `DETECTED (${engineResult.detections.length} match${engineResult.detections.length > 1 ? 'es' : ''})`
                        : 'NOT DETECTED'}
                    </span>
                    <span className="text-xs text-slate-500">{engineResult.tone_events.length} tone event{engineResult.tone_events.length !== 1 ? 's' : ''}</span>
                  </div>

                  {engineResult.tone_events.length > 0 && (
                    <div className="max-h-32 overflow-y-auto bg-slate-950 rounded border border-slate-800">
                      <table className="w-full text-xs">
                        <thead className="text-slate-500 bg-slate-900 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-1">Time</th>
                            <th className="text-left px-2 py-1">Freq</th>
                            <th className="text-left px-2 py-1">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {engineResult.tone_events.map((evt, i) => (
                            <tr key={i} className="border-t border-slate-800 text-cyan-400">
                              <td className="px-2 py-1 font-mono">{evt.timestamp.toFixed(3)}s</td>
                              <td className="px-2 py-1 font-mono">{Math.round(evt.frequency)}Hz</td>
                              <td className="px-2 py-1 font-mono">{evt.duration.toFixed(3)}s</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-500 flex flex-wrap gap-3">
                    <span>chunk: {engineResult.pipeline.chunk_size}</span>
                    <span>min_tone: {engineResult.pipeline.min_tone_duration}s</span>
                    <span>dropout: {engineResult.pipeline.dropout_tolerance}s</span>
                    <span>freq_filter: {engineResult.pipeline.freq_filter_ranges.map(r => `${r.min}-${r.max}Hz`).join(', ')}</span>
                  </div>
                </div>
              )}

              <div className="text-[10px] text-slate-600 flex items-center gap-2">
                <span>API:</span>
                <input
                  type="text"
                  value={engineApiUrl}
                  onChange={(e) => setEngineApiUrl(e.target.value)}
                  placeholder="same origin (this server)"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-slate-400 font-mono"
                />
              </div>
            </div>

            {/* Synth + Output */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg space-y-4">
              <button onClick={toggleSyntheticAudio} className={`w-full text-white font-bold py-4 rounded-lg shadow-lg flex items-center justify-center gap-3 transition group ${isSynthPlaying ? 'bg-red-600 hover:bg-red-500' : 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500'}`}>
                {isSynthPlaying ? <Square size={24} /> : <Dices size={24} className="group-hover:animate-spin" />}
                <div className="text-left leading-tight">
                  <div className="text-lg">{isSynthPlaying ? 'Stop Synthetic Audio' : 'Test Random Pattern'}</div>
                  <div className="text-xs font-normal text-orange-200">Switch to Live Spectrum to visualize playback</div>
                </div>
              </button>

              <div className="pt-4 border-t border-slate-700">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase">Generated YAML</span>
                  <div className="flex gap-2">
                    <button onClick={() => { navigator.clipboard.writeText(generateYAML()); showToast('YAML copied to clipboard'); }} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1 transition">
                      <Copy size={14} /> Copy
                    </button>
                    <button onClick={downloadYAML} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1 transition">
                      <Download size={14} /> Download
                    </button>
                  </div>
                </div>
                <div className="bg-slate-950 rounded-lg border border-slate-800 p-4 h-48 overflow-auto">
                  <pre className="text-xs font-mono text-green-400 leading-relaxed">{generateYAML()}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-4 border-dashed border-blue-500 rounded-3xl p-16 text-center">
            <Upload size={64} className="text-blue-400 mx-auto mb-4" />
            <div className="text-2xl font-bold text-white">Drop audio file to load</div>
            <div className="text-slate-400 mt-2">WAV, MP3, OGG, FLAC, M4A</div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-700 text-white text-sm px-5 py-2.5 rounded-lg shadow-xl border border-slate-600 animate-[fadeIn_0.15s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}
