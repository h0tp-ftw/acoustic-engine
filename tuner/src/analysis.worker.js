import { analyzeAudio } from './audio.js';

self.onmessage = (e) => {
  const { channelData, sampleRate, windowMs } = e.data;

  const fakeBuffer = {
    getChannelData: () => channelData,
    sampleRate,
  };

  const result = analyzeAudio(fakeBuffer, windowMs);

  // Convert spectrogram Float32Arrays to regular arrays for structured clone
  const spectrogram = result.spectrogram.map(frame => Array.from(frame));

  self.postMessage({
    envelope: result.envelope,
    freqTrack: result.freqTrack,
    spectrogram,
    freqResolution: result.freqResolution,
    tonalFlags: result.tonalFlags,
  });
};
