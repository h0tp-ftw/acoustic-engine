import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Upload, Play, Square, Pause, Settings2, Activity, Download, Copy, RefreshCw, Scissors, Wand2, Plus, Trash2, Dices, Radio, Mic, Info, FileUp, FileText, ChevronDown, ChevronRight, ShieldCheck, Loader2, Undo2 } from 'lucide-react';
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
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(12);
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

  // Record from the HOST mic (the machine the engine runs on), not the browser.
  // Hits the engine server's /record, then loads the WAV exactly like a file.
  const recordFromMic = useCallback(async () => {
    if (recording) return;
    const secs = Math.max(1, Math.min(Number(recordSeconds) || 12, 30));
    setRecording(true);
    showToast(`Recording ${secs}s from the host mic…`);
    try {
      const url = engineApiUrl
        ? `${engineApiUrl.replace(/\/+$/, '')}/record?seconds=${secs}`
        : new URL(`record?seconds=${secs}`, document.baseURI).href;
      const resp = await fetch(url, { method: 'POST' });
      if (!resp.ok) {
        let msg = `Record failed (${resp.status})`;
        try { const j = await resp.json(); if (j.detail) msg = j.detail; } catch { /* not json */ }
        throw new Error(msg);
      }
      const blob = await resp.blob();
      await ensureAudioContext();
      const buffer = await audioContextRef.current.decodeAudioData(await blob.arrayBuffer());
      setAudioBuffer(buffer);
      setFileName(`mic recording (${secs}s)`);
      setProfileSegments([]);
      runAnalysis(buffer);
      showToast(`Recorded ${buffer.duration.toFixed(1)}s — analyzing`);
    } catch (e) {
      showToast(String(e?.message || e));
    } finally {
      setRecording(false);
    }
    // runAnalysis is called in the body (resolves at call time), not a dep — see undo.
  }, [recording, recordSeconds, engineApiUrl, ensureAudioContext, showToast]);

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
      if (['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].includes(e.target.tagName)) return;
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
      ctx.fillStyle = '#FBF7FF';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(139,114,196,0.14)';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(107,95,125,0.7)';
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
      ctx.strokeStyle = '#8B72C4';
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
      ctx.fillStyle = 'rgba(201,182,240,0.22)';
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
          // Pastel spectrogram: quiet bins fade into the cream paper; louder bins
          // bloom from periwinkle (#A9C8EC) up to dusty-rose (#D98BA3).
          const t = val;
          imgData.data[pIndex]     = Math.round(169 + (217 - 169) * t);
          imgData.data[pIndex + 1] = Math.round(200 + (139 - 200) * t);
          imgData.data[pIndex + 2] = Math.round(236 + (163 - 236) * t);
          imgData.data[pIndex + 3] = Math.round(Math.min(1, val * 1.15) * 235);
        }
      }
      rawCtx.putImageData(imgData, 0, 0);
      rawCtx.restore();
      // Restore DPR scale for subsequent vector drawing
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Grid lines
    ctx.strokeStyle = showSpectrogram ? 'rgba(255,255,255,0.4)' : 'rgba(169,200,236,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const y = height - (i / 10) * height;
      ctx.moveTo(0, y); ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Envelope
    if (showEnvelope) {
      ctx.fillStyle = showSpectrogram ? 'rgba(91,130,186,0.5)' : 'rgba(169,200,236,0.6)';
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
      ctx.strokeStyle = 'rgba(216,148,90,0.3)';
      ctx.setLineDash([2, 4]);
      ctx.fillStyle = 'rgba(165,100,31,0.95)';
      ctx.font = '10px sans-serif';
      for (let f = 1000; f <= 4000; f += 1000) {
        const y = height - (f / MAX_FREQ) * height;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        ctx.fillText(`${f}Hz`, width - 35, y - 4);
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = '#D8945A';
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
          ctx.fillStyle = 'rgba(217,139,163,0.26)'; ctx.fillRect(x, 0, w, height);
          ctx.strokeStyle = '#D98BA3'; ctx.lineWidth = 2; ctx.strokeRect(x, 0, w, height);
        } else {
          ctx.fillStyle = 'rgba(95,169,124,0.22)'; ctx.fillRect(x, 0, w, height);
          ctx.strokeStyle = '#5FA97C'; ctx.lineWidth = 2; ctx.strokeRect(x, 0, w, height);
        }
      }
    });

    // Engine validation tone events (cyan layer)
    if (showEngineLayer && engineResult?.tone_events?.length > 0) {
      engineResult.tone_events.forEach(evt => {
        const x = (evt.timestamp / totalDuration) * width;
        const w = Math.max(2, (evt.duration / totalDuration) * width);
        ctx.fillStyle = 'rgba(91,130,186,0.2)';
        ctx.fillRect(x, 0, w, height);
        ctx.strokeStyle = '#5B82BA';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x, 0, w, height);
        ctx.setLineDash([]);

        // Frequency label
        ctx.fillStyle = '#5B82BA';
        ctx.font = '9px sans-serif';
        ctx.fillText(`${Math.round(evt.frequency)}Hz`, x + 2, 12);
      });
    }

    // Threshold line
    const thresholdY = height - effectiveThreshold * height;
    ctx.strokeStyle = '#D98BA3';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(0, thresholdY); ctx.lineTo(width, thresholdY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#A9526F'; ctx.fillRect(0, thresholdY - 10, 55, 20);
    ctx.fillStyle = '#FFFFFF'; ctx.font = '11px sans-serif';
    ctx.fillText(`${Math.round(effectiveThreshold * 100)}%`, 5, thresholdY + 4);
  }, [viewMode, envelope, freqTrack, spectrogram, freqResolution, showEnvelope, showPitchTrack, showSpectrogram, effectiveThreshold, evaluatedSegments, audioBuffer, profileSegments, engineResult, showEngineLayer]);

  // --- JSX ---
  const tones = analyzerSegments.filter(s => s.type === 'tone');
  const cyclePeriod = autoCyclePeriod || analyzerSegments.length;
  const beepsPerCycle = analyzerSegments.slice(0, cyclePeriod).filter(s => s.type === 'tone').length || tones.length;
  const firstFreq = tones[0]?.freq;
  const patternSummary = analyzing
    ? 'Reading the sound…'
    : analyzerSegments.length === 0
      ? "We couldn't pick out a clear pattern yet. Try trimming to just the alarm, or nudge the loudness cutoff below."
      : `We heard ${beepsPerCycle} beep${beepsPerCycle === 1 ? '' : 's'}` +
        (firstFreq ? ` · about ${Math.round(firstFreq)} Hz` : '') +
        (autoCycleCount > 1 ? ` · repeating ${autoCycleCount}×` : '');

  return (
    <div className="app-shell">
      <div className="app-container">

        {/* Title */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-2xl bg-lilac-tint text-lilac-deep border border-lilac"><Activity size={20} /></span>
              Teach the detector your alarm
            </h1>
            <p className="section-sub">Record a sound, check the pattern, and save it — no settings to learn.</p>
          </div>
          <button onClick={undo} disabled={undoStackRef.current.length === 0} className="btn-icon" title="Undo the last change (Ctrl+Z)">
            <Undo2 size={18} />
          </button>
        </header>

        {/* ============ STEP 1 — Get a sound ============ */}
        <section className="card card-step-1">
          <div className="section-heading">
            <span className="step-number">1</span>
            <div>
              <h2>Get a sound</h2>
              <p className="section-sub">Record your alarm, or drop in a recording you already have.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={recordFromMic} disabled={recording}
              title="Records from the microphone on your Home Assistant device — not this browser"
              className={`btn ${recording ? 'btn-rose animate-pulse' : 'btn-primary'}`}
            >
              {recording ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
              {recording ? `Listening… ${recordSeconds}s` : 'Record'}
            </button>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="number" min="1" max="30" value={recordSeconds}
                onChange={(e) => setRecordSeconds(e.target.value)} disabled={recording}
                title="How long to record (1–30 seconds)"
                className="field field-sm w-16"
              />
              seconds
            </label>
            <label className="btn btn-soft cursor-pointer">
              <Upload size={16} /> Choose a file
              <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
            </label>
            {audioBuffer && (
              <button onClick={togglePlayback} className={`btn ${isPlaying ? 'btn-peach' : 'btn-soft'}`}>
                {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? 'Pause' : 'Play'}
              </button>
            )}
          </div>

          {/* File info chips */}
          {audioBuffer && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {fileName
                ? <span className="pill pill-lilac">{fileName}</span>
                : <span className="pill">Sample sound</span>}
              <span className="pill">{audioBuffer.duration.toFixed(1)}s</span>
              <span className="pill">{audioBuffer.sampleRate} Hz</span>
              <span className="pill">{audioBuffer.numberOfChannels === 1 ? 'mono' : `${audioBuffer.numberOfChannels}ch`}</span>
            </div>
          )}
          {!fileName && (
            <p className="hint mt-3">This is a sample sound — record or choose a file to use your own.</p>
          )}

          {/* More options: open existing profile + start over */}
          <details className="disclosure group mt-4">
            <summary className="disclosure-summary">
              <span>More options — open a saved profile</span>
              <ChevronDown size={16} className="transition group-open:rotate-180" />
            </summary>
            <div className="disclosure-body space-y-4">
              <div>
                <p className="field-label">Open an existing profile</p>
                <div
                  className="rounded-xl border border-dashed border-line-strong p-3 text-center hint"
                  onDrop={handleYamlFileDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  Drop a profile file here, or paste it below
                  <label className="ml-1 text-lilac-deep underline cursor-pointer">
                    browse
                    <input type="file" accept=".yaml,.yml" onChange={handleYamlFileDrop} className="hidden" />
                  </label>
                </div>
                <textarea
                  value={yamlImportText}
                  onChange={(e) => setYamlImportText(e.target.value)}
                  placeholder={'name: "Smoke_Alarm"\nconfirmation_cycles: 2\nsegments:\n  - type: "tone"\n    frequency: { min: 3150, max: 3350 }\n    duration: { min: 0.5, max: 0.7 }'}
                  className="field field-mono h-32 resize-y mt-2 text-xs"
                />
                {yamlImportError && (
                  <div className="text-blush-deep text-xs bg-blush-tint border border-blush rounded-xl p-2 mt-2">{yamlImportError}</div>
                )}
                <button onClick={importYAML} disabled={!yamlImportText.trim()} className="btn btn-soft mt-2">
                  Open this profile
                </button>
              </div>
              <div className="divider pt-3">
                <button onClick={generateDemoSignal} className="btn btn-ghost">
                  <RefreshCw size={16} /> Start over (reload the sample)
                </button>
              </div>
            </div>
          </details>
        </section>

        <div className="step-connector" />

        {/* ============ STEP 2 — What we heard ============ */}
        <section className="card card-step-2">
          <div className="section-heading">
            <span className="step-number step-number-mint">2</span>
            <div>
              <h2>What we heard</h2>
              <p className="section-sub">Here’s your sound as a picture, and the pattern we picked out.</p>
            </div>
          </div>

          {/* Plain-words summary + matched badge */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <span className="pill pill-lilac text-sm">{patternSummary}</span>
            {matchSummary && (
              <span className={`badge ${matchSummary.allMatch ? 'badge-matched' : 'badge-unmatched'}`}>
                {matchSummary.matched}/{matchSummary.total} parts matched
              </span>
            )}
          </div>

          {/* Canvas */}
          <div
            className={`canvas-frame ${viewMode === 'timeline' && audioBuffer ? 'cursor-pointer' : ''}`}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverInfo(null)}
            onClick={handleCanvasClick}
          >
            <canvas ref={canvasRef} className="w-full h-full relative z-0" style={{ imageRendering: 'auto' }} />

            {analyzing && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-paper/70 backdrop-blur-[2px]">
                <div className="subcard flex items-center gap-3">
                  <Loader2 size={20} className="animate-spin text-lilac-deep" />
                  <span className="text-sm text-ink-soft">One moment — reading your sound…</span>
                </div>
              </div>
            )}

            {viewMode === 'timeline' && audioBuffer && (
              <div className="absolute top-0 bottom-0 w-[2px] bg-lilac shadow-[0_0_10px_rgba(201,182,240,0.9)] z-20 pointer-events-none" style={{ left: `${(currentTime / audioBuffer.duration) * 100}%` }} />
            )}

            {viewMode === 'timeline' && audioBuffer && (
              <>
                <div className="absolute top-0 bottom-0 bg-paper/70 border-r border-line-strong z-10 pointer-events-none" style={{ left: 0, width: `${(cropStart / audioBuffer.duration) * 100}%` }} />
                <div className="absolute top-0 bottom-0 bg-paper/70 border-l border-line-strong z-10 pointer-events-none" style={{ right: 0, width: `${(1 - cropEnd / audioBuffer.duration) * 100}%` }} />
              </>
            )}

            {viewMode === 'timeline' && hoverInfo?.mode === 'timeline' && (
              <>
                <div className="absolute top-0 bottom-0 w-[1px] bg-ink-faint/50 z-20 pointer-events-none" style={{ left: `${hoverInfo.progress * 100}%` }} />
                <div
                  className="absolute z-30 pointer-events-none bg-card/95 border border-line-strong text-xs rounded-xl shadow-paper p-2 flex flex-col gap-1 whitespace-nowrap"
                  style={{
                    left: `${hoverInfo.progress * 100}%`, top: '10px',
                    transform: hoverInfo.progress > 0.85 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                  }}
                >
                  <div className="text-ink flex justify-between gap-3"><span>Time</span> <span className="font-mono">{hoverInfo.time.toFixed(3)}s</span></div>
                  {showPitchTrack && <div className="text-peach-deep flex justify-between gap-3"><span>Pitch</span> <span className="font-mono">{hoverInfo.freq > 0 ? `${Math.round(hoverInfo.freq)} Hz` : '—'}</span></div>}
                  {showEnvelope && <div className="text-sky-deep flex justify-between gap-3"><span>Loudness</span> <span className="font-mono">{Math.round(hoverInfo.env * 100)}%</span></div>}
                </div>
              </>
            )}

            {viewMode === 'spectrum' && hoverInfo?.mode === 'spectrum' && (
              <>
                <div className="absolute top-0 bottom-0 w-[1px] bg-ink-faint/50 z-20 pointer-events-none" style={{ left: `${hoverInfo.progress * 100}%` }} />
                <div
                  className="absolute w-2 h-2 rounded-full bg-peach-deep z-20 pointer-events-none -ml-1 -mt-1 shadow-[0_0_8px_rgba(216,148,90,0.6)] transition-all duration-75"
                  style={{
                    left: `${hoverInfo.progress * 100}%`,
                    top: `${100 - ((Math.max(specMinIntensity, hoverInfo.db) - specMinIntensity) / (0 - specMinIntensity)) * 100}%`,
                  }}
                />
                <div
                  className="absolute z-30 pointer-events-none bg-card/95 border border-line-strong text-xs rounded-xl shadow-paper p-2 flex flex-col gap-1 whitespace-nowrap"
                  style={{
                    left: `${hoverInfo.progress * 100}%`, top: '10px',
                    transform: hoverInfo.progress > 0.85 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                  }}
                >
                  <div className="text-peach-deep flex justify-between gap-3"><span>Pitch</span> <span className="font-mono">{Math.round(hoverInfo.freq)} Hz</span></div>
                  <div className="text-sky-deep flex justify-between gap-3"><span>Level</span> <span className="font-mono">{hoverInfo.db.toFixed(1)} dB</span></div>
                </div>
              </>
            )}
          </div>
          <p className="hint mt-2">Space plays · Ctrl+Z undoes · click the graph to jump</p>

          {/* Graph options */}
          <details className="disclosure group mt-4">
            <summary className="disclosure-summary">
              <span>Graph options</span>
              <ChevronDown size={16} className="transition group-open:rotate-180" />
            </summary>
            <div className="disclosure-body space-y-4">
              <div className="seg">
                <button className="seg-item" data-active={viewMode === 'timeline' ? 'true' : 'false'} onClick={() => setViewMode('timeline')}>Sound over time</button>
                <button className="seg-item" data-active={viewMode === 'spectrum' ? 'true' : 'false'} onClick={() => setViewMode('spectrum')}><Radio size={14} /> Frequencies right now</button>
              </div>

              {viewMode === 'timeline' ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span className="field-label mb-0">Show on the graph</span>
                  <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
                    <input type="checkbox" checked={showEnvelope} onChange={e => setShowEnvelope(e.target.checked)} /> Loudness
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
                    <input type="checkbox" checked={showPitchTrack} onChange={e => setShowPitchTrack(e.target.checked)} /> Pitch
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
                    <input type="checkbox" checked={showSpectrogram} onChange={e => setShowSpectrogram(e.target.checked)} /> Frequency heatmap
                  </label>
                  {engineResult && (
                    <label className="flex items-center gap-2 text-sm text-sky-deep cursor-pointer">
                      <input type="checkbox" checked={showEngineLayer} onChange={e => setShowEngineLayer(e.target.checked)} /> What the detector found
                    </label>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <label className="field-label flex justify-between">Lowest pitch shown <span className="font-mono text-ink">{specMinFreq} Hz</span></label>
                    <input type="range" min="0" max="5000" step="100" value={specMinFreq} onChange={e => { const v = parseInt(e.target.value); if (v < specMaxFreq) setSpecMinFreq(v); }} className="range-mint" />
                  </div>
                  <div>
                    <label className="field-label flex justify-between">Highest pitch shown <span className="font-mono text-ink">{specMaxFreq} Hz</span></label>
                    <input type="range" min="1000" max="22000" step="100" value={specMaxFreq} onChange={e => { const v = parseInt(e.target.value); if (v > specMinFreq) setSpecMaxFreq(v); }} className="range-mint" />
                  </div>
                  <div>
                    <label className="field-label flex justify-between">Quietest level shown <span className="font-mono text-ink">{specMinIntensity} dB</span></label>
                    <input type="range" min="-140" max="-30" step="5" value={specMinIntensity} onChange={e => setSpecMinIntensity(parseInt(e.target.value))} className="range-mint" />
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* Advanced: Trim */}
          <details className="disclosure group mt-3">
            <summary className="disclosure-summary">
              <span className="flex items-center gap-2"><Scissors size={15} /> Trim</span>
              <ChevronDown size={16} className="transition group-open:rotate-180" />
            </summary>
            <div className="disclosure-body space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="hint">Keep just the part with the alarm.</p>
                {audioBuffer && <span className="text-xs font-mono text-lilac-deep">{cropStart.toFixed(2)}s — {cropEnd.toFixed(2)}s ({(cropEnd - cropStart).toFixed(2)}s)</span>}
              </div>
              <div className="grid grid-cols-5 gap-3 items-end">
                <div className="col-span-2">
                  <label className="field-label">Start</label>
                  <input type="range" min="0" max={audioBuffer?.duration || 1} step="0.01" value={cropStart} onChange={(e) => setCropStart(Math.min(parseFloat(e.target.value), cropEnd - 0.1))} className="range-lilac" disabled={!audioBuffer} />
                </div>
                <div className="col-span-2">
                  <label className="field-label">End</label>
                  <input type="range" min="0" max={audioBuffer?.duration || 1} step="0.01" value={cropEnd} onChange={(e) => setCropEnd(Math.max(parseFloat(e.target.value), cropStart + 0.1))} className="range-lilac" disabled={!audioBuffer} />
                </div>
                <button onClick={applyCrop} disabled={!audioBuffer} className="btn btn-soft col-span-1">Trim</button>
              </div>
            </div>
          </details>

          {/* See every beep */}
          {evaluatedSegments.length > 0 && (
            <details className="disclosure group mt-3">
              <summary className="disclosure-summary">
                <span>See every beep we found ({evaluatedSegments.length})</span>
                <ChevronDown size={16} className="transition group-open:rotate-180" />
              </summary>
              <div className="disclosure-body">
                <div className="well p-0 overflow-hidden">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="data-table">
                      <thead className="sticky top-0 bg-paper-2">
                        <tr>
                          <th>Beep or gap</th>
                          <th>Pitch (Hz)</th>
                          <th>Length</th>
                          <th>Start</th>
                          {profileSegments.length > 0 && <th className="text-center">Fits</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {evaluatedSegments.map((seg, i) => (
                          <tr key={i}>
                            <td><span className={`badge ${seg.type === 'tone' ? 'badge-tone' : 'badge-silence'}`}>{seg.type === 'tone' ? 'Beep' : 'Gap'}</span></td>
                            <td className="font-mono">{seg.type === 'tone' ? `${Math.round(seg.freq)}` : '—'}</td>
                            <td className="font-mono">{seg.duration.toFixed(3)}s</td>
                            <td className="font-mono text-ink-soft">{seg.start.toFixed(2)}s</td>
                            {profileSegments.length > 0 && (
                              <td className="text-center font-bold">
                                <span className={seg.matched ? 'text-mint-deep' : 'text-blush-deep'} title={seg.matched ? 'Fits your pattern' : 'Does not fit yet'}>{seg.matched ? '✓' : '✗'}</span>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </details>
          )}
        </section>

        <div className="step-connector" />

        {/* ============ STEP 3 — Fine-tune ============ */}
        <section className="card card-step-3">
          <div className="section-heading">
            <span className="step-number step-number-blush">3</span>
            <div>
              <h2>Fine-tune</h2>
              <p className="section-sub">If a beep was missed or added, nudge these until the graph looks right.</p>
            </div>
          </div>

          {/* Loudness cutoff */}
          <div>
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-sm font-medium text-ink">Loudness cutoff</span>
              <span className="text-sm font-mono text-blush-deep">{Math.round(effectiveThreshold * 100)}%{useAdaptiveThreshold ? ' above noise' : ''}</span>
            </div>
            <input type="range" min="0.01" max="0.99" step="0.01" value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))} className="range-blush" />
            <p className="hint mt-1.5">Sounds quieter than this are treated as a gap.</p>
          </div>

          {/* Auto-cycle line */}
          {autoCycleCount !== null && autoCyclePeriod !== null && (
            <p className="hint mt-3 flex items-center gap-2">
              <Activity size={14} className="text-mint-deep" />
              We spotted the repeat: <strong className="text-mint-deep">{autoCycleCount}×</strong> ({autoCyclePeriod} parts each)
            </p>
          )}

          <button onClick={extractToProfile} className="btn-cta btn-cta-mint mt-4">
            <Wand2 size={18} /> Use this as my pattern {autoCycleCount > 1 ? `(averaging ${autoCycleCount} repeats)` : ''}
          </button>

          {/* Your pattern */}
          <div className="divider mt-6 pt-5">
            <h3 className="text-sm font-semibold text-ink mb-3">Your pattern</h3>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[150px]">
                <label className="field-label">Name</label>
                <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="field" />
              </div>
              <div className="w-44">
                <label className="field-label">Repeats before it counts</label>
                <input type="number" min="1" value={cycles} onChange={(e) => setCycles(parseInt(e.target.value) || 1)} className="field" />
              </div>
            </div>

            {/* Segment rows */}
            <div className="space-y-3 mt-4">
              {profileSegments.length === 0 && (
                <p className="hint text-center py-6">No pattern yet. Press “Use this as my pattern” to read it from the graph, or add beeps and gaps by hand.</p>
              )}
              {profileSegments.map((seg) => (
                <div key={seg.id} className="subcard relative">
                  <div className="flex flex-wrap gap-3 items-end pr-8">
                    <div className="w-28">
                      <label className="field-label">Beep or gap</label>
                      <select value={seg.type} onChange={(e) => updateProfileSegment(seg.id, 'type', e.target.value)} className="field field-sm">
                        <option value="tone">Beep</option>
                        <option value="silence">Gap</option>
                      </select>
                    </div>
                    {seg.type === 'tone' && (
                      <div className="flex gap-2">
                        <div><label className="field-label">Lowest pitch</label><input type="number" value={seg.freqMin} onChange={(e) => updateProfileSegment(seg.id, 'freqMin', e.target.value)} className="field field-sm w-20" /></div>
                        <div><label className="field-label">Highest pitch</label><input type="number" value={seg.freqMax} onChange={(e) => updateProfileSegment(seg.id, 'freqMax', e.target.value)} className="field field-sm w-20" /></div>
                      </div>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <div><label className="field-label">Shortest</label><input type="number" step="0.01" value={seg.durMin} onChange={(e) => updateProfileSegment(seg.id, 'durMin', e.target.value)} className="field field-sm w-20" /></div>
                      <div><label className="field-label">Longest</label><input type="number" step="0.01" value={seg.durMax} onChange={(e) => updateProfileSegment(seg.id, 'durMax', e.target.value)} className="field field-sm w-20" /></div>
                    </div>
                  </div>
                  <button onClick={() => removeProfileSegment(seg.id)} className="absolute right-3 top-3 text-ink-faint hover:text-blush-deep p-1" title="Remove"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={() => addProfileSegment('tone')} className="btn btn-soft flex-1"><Plus size={14} /> Add a beep</button>
              <button onClick={() => addProfileSegment('silence')} className="btn btn-soft flex-1"><Plus size={14} /> Add a gap</button>
            </div>
          </div>

          {/* Advanced */}
          <details className="disclosure group mt-5">
            <summary className="disclosure-summary">
              <span>Advanced</span>
              <ChevronDown size={16} className="transition group-open:rotate-180" />
            </summary>
            <div className="disclosure-body space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
                  <input type="checkbox" checked={useAdaptiveThreshold} onChange={e => setUseAdaptiveThreshold(e.target.checked)} />
                  Adjust for background noise
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
                  <input type="checkbox" checked={useSpectralGating} onChange={e => setUseSpectralGating(e.target.checked)} />
                  Only count clear tones
                </label>
              </div>
              <div className="hint-card">
                <Info size={14} className="text-lilac-deep shrink-0 mt-0.5" />
                <p><strong>Adjust for background noise</strong> works out how quiet the room is, so the cutoff means “how far above that.” <strong>Only count clear tones</strong> skips bangs and bumps and keeps steady alarm beeps.</p>
              </div>
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-sm font-medium text-ink">Ignore blips shorter than</span>
                  <span className="text-sm font-mono text-blush-deep">{minDuration.toFixed(2)}s</span>
                </div>
                <input type="range" min="0.01" max="0.5" step="0.01" value={minDuration} onChange={(e) => setMinDuration(parseFloat(e.target.value))} className="range-blush" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="field-label">Shortest real beep</label>
                  <input type="number" step="0.01" min="0" value={minToneDuration} onChange={(e) => setMinToneDuration(parseFloat(e.target.value) || 0)} className="field field-sm" />
                </div>
                <div>
                  <label className="field-label">Allowed dropout</label>
                  <input type="number" step="0.01" min="0" value={dropoutTolerance} onChange={(e) => setDropoutTolerance(parseFloat(e.target.value) || 0)} className="field field-sm" />
                </div>
                <div>
                  <label className="field-label">Forget after</label>
                  <input type="number" step="0.5" min="1" value={resetTimeout} onChange={(e) => setResetTimeout(parseFloat(e.target.value) || 10)} className="field field-sm" />
                </div>
              </div>
              <p className="hint">These are fine engine settings — the defaults suit most alarms.</p>
            </div>
          </details>
        </section>

        <div className="step-connector" />

        {/* ============ STEP 4 — Test & save ============ */}
        <section className="card card-step-4">
          <div className="section-heading">
            <span className="step-number step-number-peach">4</span>
            <div>
              <h2>Test &amp; save</h2>
              <p className="section-sub">Hear a test, let the detector double-check, then copy or download.</p>
            </div>
          </div>

          <button onClick={toggleSyntheticAudio} className={`btn-cta ${isSynthPlaying ? 'btn-cta-blush' : 'btn-cta-peach'} group`}>
            {isSynthPlaying ? <Square size={22} /> : <Dices size={22} className="group-hover:animate-spin" />}
            <div className="text-left leading-tight">
              <div>{isSynthPlaying ? 'Stop test' : 'Play a test beep'}</div>
              <div className="text-xs font-normal opacity-80">Switch the graph to “Frequencies right now” to watch it play</div>
            </div>
          </button>

          <button
            onClick={validateWithEngine}
            disabled={!audioBuffer || profileSegments.length === 0 || engineValidating}
            className="btn-cta btn-cta-sky mt-3"
          >
            {engineValidating ? <Loader2 size={22} className="animate-spin" /> : <ShieldCheck size={22} />}
            <div className="text-left leading-tight">
              <div>{engineValidating ? 'Checking…' : 'Double-check with the detector'}</div>
              <div className="text-xs font-normal opacity-80">Runs the real detector on your recording and pattern</div>
            </div>
          </button>

          {/* Verdict */}
          {engineResult ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`badge ${engineResult.detections.length > 0 ? 'badge-matched' : 'badge-unmatched'}`}>
                  {engineResult.detections.length > 0 ? 'Yes — this would be detected' : 'Not detected yet'}
                </span>
                <span className="hint">{engineResult.tone_events.length} beep{engineResult.tone_events.length !== 1 ? 's' : ''} the detector heard</span>
              </div>

              {engineResult.tone_events.length > 0 && (
                <details className="disclosure group">
                  <summary className="disclosure-summary"><span>Details</span><ChevronDown size={16} className="transition group-open:rotate-180" /></summary>
                  <div className="disclosure-body">
                    <div className="well p-0 overflow-hidden">
                      <div className="max-h-32 overflow-y-auto">
                        <table className="data-table">
                          <thead className="sticky top-0 bg-paper-2"><tr><th>Time</th><th>Pitch</th><th>Length</th></tr></thead>
                          <tbody>
                            {engineResult.tone_events.map((evt, i) => (
                              <tr key={i}>
                                <td className="font-mono text-sky-deep">{evt.timestamp.toFixed(3)}s</td>
                                <td className="font-mono text-sky-deep">{Math.round(evt.frequency)}Hz</td>
                                <td className="font-mono text-sky-deep">{evt.duration.toFixed(3)}s</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="hint mt-2 flex flex-wrap gap-x-3">
                      <span>chunk {engineResult.pipeline.chunk_size}</span>
                      <span>min tone {engineResult.pipeline.min_tone_duration}s</span>
                      <span>dropout {engineResult.pipeline.dropout_tolerance}s</span>
                      <span>pitches {engineResult.pipeline.freq_filter_ranges.map(r => `${r.min}-${r.max}Hz`).join(', ')}</span>
                    </div>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <p className="hint mt-3">Not checked yet. Play a test beep, then let the detector double-check.</p>
          )}

          {/* Your profile file */}
          <div className="divider mt-6 pt-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-ink">Your profile file</h3>
                <p className="hint">Copy or download this into the detector.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(generateYAML()); showToast('Profile copied to clipboard'); }} className="btn btn-soft"><Copy size={14} /> Copy</button>
                <button onClick={downloadYAML} className="btn btn-peach"><Download size={14} /> Download</button>
              </div>
            </div>
            <details className="disclosure group mt-3">
              <summary className="disclosure-summary"><span className="flex items-center gap-2"><FileText size={15} /> Show the file contents</span><ChevronDown size={16} className="transition group-open:rotate-180" /></summary>
              <div className="disclosure-body">
                <div className="code-well h-48"><pre className="text-xs leading-relaxed">{generateYAML()}</pre></div>
              </div>
            </details>
          </div>

          {/* Advanced / connection */}
          <details className="disclosure group mt-3">
            <summary className="disclosure-summary"><span>Advanced · connection</span><ChevronDown size={16} className="transition group-open:rotate-180" /></summary>
            <div className="disclosure-body">
              <label className="field-label">Detector address</label>
              <input
                type="text"
                value={engineApiUrl}
                onChange={(e) => setEngineApiUrl(e.target.value)}
                placeholder="this server (leave blank)"
                className="field field-mono text-xs"
              />
              <p className="hint mt-1.5">Leave blank to use this server. Only change this if the detector runs somewhere else.</p>
            </div>
          </details>
        </section>

      </div>

      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-paper/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-lilac rounded-3xl p-16 text-center">
            <Upload size={64} className="text-lilac-deep mx-auto mb-4" />
            <div className="text-2xl font-bold text-ink">Drop your recording to load it</div>
            <div className="hint mt-2">WAV, MP3, OGG, FLAC or M4A</div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="toast fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-[fadeIn_0.15s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}
