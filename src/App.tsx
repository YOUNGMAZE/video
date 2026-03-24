import { useEffect, useMemo, useRef, useState } from "react";

type SceneKind = "spectrum-drive" | "oscillo-ribbon" | "stereo-tunnel" | "pulse-glyph";
type DirectorMode = "ai" | "manual";

type Preset = {
  id: string;
  title: string;
  mood: string;
  accent: string;
  secondary: string;
  glow: string;
  scenes: SceneKind[];
};

type AnalysisResult = {
  tempo: number;
  energy: number;
  bass: number;
  brightness: number;
  stereo: number;
  confidence: number;
  preset: Preset;
};

type TimelineSegment = {
  start: number;
  end: number;
  scene: SceneKind;
};

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const SCENE_OPTIONS: { value: SceneKind; label: string }[] = [
  { value: "spectrum-drive", label: "Spectrum Drive" },
  { value: "oscillo-ribbon", label: "Oscillo Ribbon" },
  { value: "stereo-tunnel", label: "Stereo Tunnel" },
  { value: "pulse-glyph", label: "Pulse Glyph" },
];

const PRESETS: Preset[] = [
  {
    id: "trap-noir",
    title: "Trap Noir",
    mood: "темный, плотный, кинематографичный",
    accent: "#8b5cf6",
    secondary: "#60a5fa",
    glow: "#a78bfa",
    scenes: ["pulse-glyph", "spectrum-drive", "stereo-tunnel"],
  },
  {
    id: "drill-lights",
    title: "Drill Lights",
    mood: "агрессивный, уличный, неон",
    accent: "#06b6d4",
    secondary: "#22d3ee",
    glow: "#67e8f9",
    scenes: ["spectrum-drive", "stereo-tunnel", "pulse-glyph"],
  },
  {
    id: "dream-melodic",
    title: "Dream Melodic",
    mood: "атмосферный, мягкий, воздушный",
    accent: "#f472b6",
    secondary: "#c4b5fd",
    glow: "#f9a8d4",
    scenes: ["oscillo-ribbon", "stereo-tunnel", "pulse-glyph"],
  },
  {
    id: "hyper-glitch",
    title: "Hyper Glitch",
    mood: "яркий, быстрый, глитчевый",
    accent: "#f97316",
    secondary: "#facc15",
    glow: "#fdba74",
    scenes: ["spectrum-drive", "oscillo-ribbon", "pulse-glyph"],
  },
];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const alpha = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0");

const estimateTempo = (signal: Float32Array, sampleRate: number) => {
  const hop = 1024;
  const energies: number[] = [];
  for (let i = 0; i + hop < signal.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j += 1) {
      const s = signal[i + j];
      sum += s * s;
    }
    energies.push(Math.sqrt(sum / hop));
  }

  const mean = energies.reduce((acc, val) => acc + val, 0) / Math.max(1, energies.length);
  const variance = energies.reduce((acc, val) => acc + (val - mean) ** 2, 0) / Math.max(1, energies.length);
  const std = Math.sqrt(variance);
  const threshold = mean + std * 0.75;

  const peaks: number[] = [];
  for (let i = 1; i < energies.length - 1; i += 1) {
    if (energies[i] > threshold && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
      peaks.push(i);
    }
  }

  const bpmVotes = new Map<number, number>();
  for (let i = 0; i < peaks.length; i += 1) {
    for (let j = 1; j <= 6; j += 1) {
      if (i + j >= peaks.length) break;
      const deltaFrames = peaks[i + j] - peaks[i];
      const seconds = (deltaFrames * hop) / sampleRate;
      if (seconds <= 0) continue;

      let bpm = 60 / seconds;
      while (bpm < 70) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const rounded = Math.round(bpm);
      bpmVotes.set(rounded, (bpmVotes.get(rounded) ?? 0) + 1);
    }
  }

  let bestBpm = 120;
  let bestVotes = 0;
  bpmVotes.forEach((votes, bpm) => {
    if (votes > bestVotes) {
      bestVotes = votes;
      bestBpm = bpm;
    }
  });

  return bestBpm;
};

const pickPreset = (tempo: number, energy: number, bass: number, brightness: number): Preset => {
  if (tempo > 145 && bass > 0.52) return PRESETS[1];
  if (brightness > 0.62 && tempo > 128) return PRESETS[3];
  if (energy < 0.34 || tempo < 100) return PRESETS[2];
  return PRESETS[0];
};

const sceneByTime = (timeline: TimelineSegment[], currentTime: number, fallback: SceneKind) => {
  const active = timeline.find((segment) => currentTime >= segment.start && currentTime < segment.end);
  return active?.scene ?? fallback;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const masterAnalyserRef = useRef<AnalyserNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const leftAnalyserRef = useRef<AnalyserNode | null>(null);
  const rightAnalyserRef = useRef<AnalyserNode | null>(null);

  const animationRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [audioSrc, setAudioSrc] = useState("");
  const [trackName, setTrackName] = useState("Выберите трек");
  const [trackDuration, setTrackDuration] = useState(0);
  const [isVisualizerReady, setIsVisualizerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<DirectorMode>("ai");
  const [manualScene, setManualScene] = useState<SceneKind>("spectrum-drive");
  const [timeline, setTimeline] = useState<TimelineSegment[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [accentColor, setAccentColor] = useState("#8b5cf6");
  const [secondaryColor, setSecondaryColor] = useState("#60a5fa");
  const [glowColor, setGlowColor] = useState("#a78bfa");
  const [sensitivity, setSensitivity] = useState(1.05);
  const [smoothing, setSmoothing] = useState(0.82);
  const [hideUi, setHideUi] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState(0);
  const [recordError, setRecordError] = useState("");

  const helperText = useMemo(() => {
    if (!audioSrc) return "Загрузи бит или трек: AI Director проанализирует звук и соберет стиль клипа автоматически.";
    if (isAnalyzing) return "AI Director анализирует темп, энергию и яркость трека...";
    if (!isVisualizerReady) return "Нажми Play, чтобы браузер включил Web Audio и визуализация стала живой.";
    if (isRecording) return "Идет запись клипа. Дождись конца трека, после этого файл .webm скачается автоматически.";
    return "Для YouTube: включи Fullscreen + Чистый кадр + Скачать клип.";
  }, [audioSrc, isAnalyzing, isVisualizerReady, isRecording]);

  const setupAudioGraph = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }
    const ctx = audioContextRef.current;

    if (!sourceRef.current) {
      sourceRef.current = ctx.createMediaElementSource(audio);
    }

    if (!masterAnalyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = smoothing;
      sourceRef.current.connect(analyser);
      analyser.connect(ctx.destination);
      masterAnalyserRef.current = analyser;
    }

    if (!splitterRef.current) {
      splitterRef.current = ctx.createChannelSplitter(2);
      sourceRef.current.connect(splitterRef.current);
    }

    if (!leftAnalyserRef.current || !rightAnalyserRef.current) {
      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      left.fftSize = 2048;
      right.fftSize = 2048;
      left.smoothingTimeConstant = smoothing;
      right.smoothingTimeConstant = smoothing;
      splitterRef.current.connect(left, 0);
      splitterRef.current.connect(right, 1);
      leftAnalyserRef.current = left;
      rightAnalyserRef.current = right;
    }

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    setIsVisualizerReady(true);
  };

  const analyzeTrack = async (file: File) => {
    setIsAnalyzing(true);
    setAnalysisError("");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const tempCtx = new AudioContext();
      const buffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));

      const channelCount = buffer.numberOfChannels;
      const left = buffer.getChannelData(0);
      const right = channelCount > 1 ? buffer.getChannelData(1) : left;
      const length = Math.min(left.length, right.length);
      const mixed = new Float32Array(length);

      for (let i = 0; i < length; i += 1) {
        mixed[i] = (left[i] + right[i]) * 0.5;
      }

      let rmsAcc = 0;
      let hpAcc = 0;
      let low = 0;
      let bassAcc = 0;
      let stereoAcc = 0;
      let last = 0;

      for (let i = 0; i < mixed.length; i += 1) {
        const x = mixed[i];
        rmsAcc += x * x;
        const hp = x - last;
        hpAcc += Math.abs(hp);
        low += 0.04 * (x - low);
        bassAcc += Math.abs(low);
        stereoAcc += Math.abs(left[i] - right[i]);
        last = x;
      }

      const energy = clamp(Math.sqrt(rmsAcc / mixed.length) * 3.2);
      const brightness = clamp((hpAcc / mixed.length) * 5.8);
      const bass = clamp((bassAcc / mixed.length) * 3.8);
      const stereo = clamp((stereoAcc / mixed.length) * 2.7);
      const tempo = estimateTempo(mixed, buffer.sampleRate);

      const preset = pickPreset(tempo, energy, bass, brightness);
      const confidence = clamp(0.56 + Math.abs(energy - 0.5) * 0.22 + Math.abs(tempo - 120) / 220);

      setAnalysis({ tempo, energy, bass, brightness, stereo, confidence, preset });
      setAccentColor(preset.accent);
      setSecondaryColor(preset.secondary);
      setGlowColor(preset.glow);
      setSensitivity(clamp(0.86 + energy * 0.9, 0.7, 1.75));
      setSmoothing(clamp(0.88 - brightness * 0.18, 0.62, 0.9));
      setManualScene(preset.scenes[0]);

      await tempCtx.close();
    } catch (error) {
      setAnalysis(null);
      setAnalysisError("Не удалось проанализировать файл. Попробуй MP3 или WAV.");
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (masterAnalyserRef.current) masterAnalyserRef.current.smoothingTimeConstant = smoothing;
    if (leftAnalyserRef.current) leftAnalyserRef.current.smoothingTimeConstant = smoothing;
    if (rightAnalyserRef.current) rightAnalyserRef.current.smoothingTimeConstant = smoothing;
  }, [smoothing]);

  useEffect(() => {
    if (!trackDuration || !analysis) {
      setTimeline([]);
      return;
    }

    const measureSec = (60 / Math.max(70, analysis.tempo)) * 4;
    const segmentSec = clamp(measureSec * 2.2, 4.2, 9.5);
    const segments: TimelineSegment[] = [];
    let cursor = 0;
    let sceneIndex = 0;

    while (cursor < trackDuration) {
      const next = Math.min(trackDuration, cursor + segmentSec);
      const pool = analysis.preset.scenes;
      const scene = pool[sceneIndex % pool.length];
      segments.push({ start: cursor, end: next, scene });
      sceneIndex += 1;
      cursor = next;
    }

    setTimeline(segments);
  }, [analysis, trackDuration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const masterAnalyser = masterAnalyserRef.current;
    const leftAnalyser = leftAnalyserRef.current ?? masterAnalyser;
    const rightAnalyser = rightAnalyserRef.current ?? masterAnalyser;
    const audio = audioRef.current;

    if (!masterAnalyser || !leftAnalyser || !rightAnalyser || !audio) {
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return;
    }

    const frequencyData = new Uint8Array(masterAnalyser.frequencyBinCount);
    const waveformData = new Uint8Array(masterAnalyser.fftSize);
    const leftWaveData = new Uint8Array(leftAnalyser.fftSize);
    const rightWaveData = new Uint8Array(rightAnalyser.fftSize);
    const spectrumPeak = new Float32Array(96);
    const pulseState = { ring: 0, flash: 0 };

    const drawBackdrop = (time: number, bassLevel: number) => {
      const top = `#020617`;
      const bottom = `#0b1022`;
      const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      gradient.addColorStop(0, top);
      gradient.addColorStop(1, bottom);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const driftX = Math.sin(time * 0.00027) * 190;
      const flare = ctx.createRadialGradient(
        CANVAS_WIDTH * 0.4 + driftX,
        CANVAS_HEIGHT * 0.5,
        80,
        CANVAS_WIDTH * 0.4 + driftX,
        CANVAS_HEIGHT * 0.5,
        CANVAS_WIDTH * 0.7,
      );
      flare.addColorStop(0, `${glowColor}${alpha(0.19 + bassLevel * 0.18)}`);
      flare.addColorStop(1, "transparent");
      ctx.fillStyle = flare;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.strokeStyle = "#ffffff16";
      ctx.lineWidth = 1;
      const rows = 18;
      for (let i = 0; i <= rows; i += 1) {
        const y = (CANVAS_HEIGHT / rows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      const scan = ((time * 0.14) % (CANVAS_HEIGHT + 220)) - 110;
      const scanGradient = ctx.createLinearGradient(0, scan - 80, 0, scan + 80);
      scanGradient.addColorStop(0, "transparent");
      scanGradient.addColorStop(0.5, `${accentColor}${alpha(0.2)}`);
      scanGradient.addColorStop(1, "transparent");
      ctx.fillStyle = scanGradient;
      ctx.fillRect(0, scan - 80, CANVAS_WIDTH, 160);
    };

    const drawSpectrumDrive = (bassLevel: number) => {
      const bars = spectrumPeak.length;
      const chartTop = 170;
      const chartBottom = CANVAS_HEIGHT - 210;
      const chartHeight = chartBottom - chartTop;
      const stepX = CANVAS_WIDTH / bars;
      const sampleStep = Math.max(1, Math.floor(frequencyData.length / bars));

      for (let i = 0; i < bars; i += 1) {
        const value = Math.pow(frequencyData[i * sampleStep] / 255, 1.12) * sensitivity;
        const height = clamp(value, 0, 1.1) * chartHeight;
        const x = i * stepX + stepX * 0.14;
        const width = stepX * 0.72;

        spectrumPeak[i] = Math.max(value, spectrumPeak[i] - 0.015);

        const gradient = ctx.createLinearGradient(0, chartBottom, 0, chartBottom - height);
        gradient.addColorStop(0, `${secondaryColor}${alpha(0.86)}`);
        gradient.addColorStop(1, `${accentColor}${alpha(0.96)}`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, chartBottom - height, width, height);

        const peakY = chartBottom - clamp(spectrumPeak[i], 0, 1.2) * chartHeight;
        ctx.fillStyle = `${glowColor}${alpha(0.95)}`;
        ctx.fillRect(x, peakY, width, 4);
      }

      ctx.fillStyle = `${accentColor}${alpha(0.18 + bassLevel * 0.2)}`;
      ctx.fillRect(0, chartBottom - 6, CANVAS_WIDTH, 12);
    };

    const drawOscilloRibbon = () => {
      const centerY = CANVAS_HEIGHT * 0.52;
      const amp = 260 * sensitivity;

      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff25";
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(CANVAS_WIDTH, centerY);
      ctx.stroke();

      ctx.lineWidth = 5;
      ctx.shadowBlur = 30;
      ctx.shadowColor = glowColor;
      const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, 0);
      gradient.addColorStop(0, accentColor);
      gradient.addColorStop(1, secondaryColor);
      ctx.strokeStyle = gradient;
      ctx.beginPath();

      for (let x = 0; x < CANVAS_WIDTH; x += 1) {
        const idx = Math.floor((x / CANVAS_WIDTH) * waveformData.length);
        const sample = (waveformData[idx] - 128) / 128;
        const y = centerY + sample * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    const drawStereoTunnel = () => {
      const centerX = CANVAS_WIDTH / 2;
      const centerY = CANVAS_HEIGHT / 2;

      ctx.lineWidth = 1;
      for (let d = 100; d < 760; d += 58) {
        const ratio = d / 760;
        ctx.strokeStyle = `${accentColor}${alpha(0.07 + ratio * 0.2)}`;
        ctx.beginPath();
        ctx.moveTo(centerX - d, centerY - d * 0.36);
        ctx.lineTo(centerX + d, centerY - d * 0.36);
        ctx.lineTo(centerX + d, centerY + d * 0.36);
        ctx.lineTo(centerX - d, centerY + d * 0.36);
        ctx.closePath();
        ctx.stroke();
      }

      ctx.fillStyle = `${secondaryColor}${alpha(0.28)}`;
      for (let i = 0; i < leftWaveData.length; i += 3) {
        const l = (leftWaveData[i] - 128) / 128;
        const r = (rightWaveData[i] - 128) / 128;
        const depth = i / leftWaveData.length;
        const x = centerX + (l + r) * 460 * (1 - depth * 0.55);
        const y = centerY + (l - r) * 270 * (1 - depth * 0.48);
        const size = 1 + depth * 1.5;
        ctx.fillRect(x, y, size, size);
      }
    };

    const drawPulseGlyph = (bassLevel: number) => {
      pulseState.ring = Math.max(bassLevel, pulseState.ring * 0.93);
      pulseState.flash = Math.max(bassLevel * 1.4, pulseState.flash * 0.9);

      const centerX = CANVAS_WIDTH / 2;
      const centerY = CANVAS_HEIGHT / 2;
      const base = 180 + pulseState.ring * 170;

      for (let i = 0; i < 5; i += 1) {
        const radius = base + i * 74;
        ctx.strokeStyle = `${accentColor}${alpha(0.32 - i * 0.05)}`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = `${secondaryColor}${alpha(0.16 + pulseState.flash * 0.26)}`;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 120 + pulseState.flash * 120, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `${glowColor}${alpha(0.85)}`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(centerX - 210, centerY);
      ctx.lineTo(centerX + 210, centerY);
      ctx.moveTo(centerX, centerY - 210);
      ctx.lineTo(centerX, centerY + 210);
      ctx.stroke();
    };

    const drawOverlay = (scene: SceneKind) => {
      ctx.fillStyle = "rgba(226,232,240,0.9)";
      ctx.font = "500 24px Inter, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("BeatFrame AI Director", 72, 70);

      const sceneLabel = SCENE_OPTIONS.find((item) => item.value === scene)?.label ?? scene;
      ctx.fillStyle = "rgba(148,163,184,0.9)";
      ctx.font = "500 20px Inter, system-ui, sans-serif";
      ctx.fillText(`Scene: ${sceneLabel}`, 72, 104);

      ctx.fillStyle = "rgba(248,250,252,0.95)";
      ctx.font = "700 52px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(trackName, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 82);
    };

    const render = (time: number) => {
      masterAnalyser.getByteFrequencyData(frequencyData);
      masterAnalyser.getByteTimeDomainData(waveformData);
      leftAnalyser.getByteTimeDomainData(leftWaveData);
      rightAnalyser.getByteTimeDomainData(rightWaveData);

      const lowBins = Math.floor(frequencyData.length * 0.1);
      let bassAcc = 0;
      for (let i = 0; i < lowBins; i += 1) bassAcc += frequencyData[i];
      const bassLevel = clamp((bassAcc / Math.max(1, lowBins) / 255) * sensitivity, 0, 1.2);

      const currentScene =
        mode === "ai"
          ? sceneByTime(timeline, audio.currentTime, analysis?.preset.scenes[0] ?? "spectrum-drive")
          : manualScene;

      drawBackdrop(time, bassLevel);

      if (currentScene === "spectrum-drive") drawSpectrumDrive(bassLevel);
      if (currentScene === "oscillo-ribbon") drawOscilloRibbon();
      if (currentScene === "stereo-tunnel") drawStereoTunnel();
      if (currentScene === "pulse-glyph") drawPulseGlyph(bassLevel);

      drawOverlay(currentScene);
      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analysis, mode, manualScene, timeline, trackName, accentColor, secondaryColor, glowColor, sensitivity]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      audioContextRef.current?.close();
    };
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setRecordError("");
    setRecordProgress(0);

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);

    const src = URL.createObjectURL(file);
    objectUrlRef.current = src;
    setAudioSrc(src);
    setTrackName(file.name.replace(/\.[^/.]+$/, ""));
    setIsVisualizerReady(false);
    setIsPlaying(false);
    setTrackDuration(0);
    await analyzeTrack(file);
  };

  const handleFullscreen = async () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await stageRef.current.requestFullscreen();
  };

  const handleDownloadFrame = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `${trackName || "visual"}-frame.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  const handleRecordClip = async () => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || !audioSrc) return;

    if (typeof MediaRecorder === "undefined") {
      setRecordError("Этот браузер не поддерживает запись видео. Попробуй Chrome/Edge.");
      return;
    }

    setRecordError("");
    setIsRecording(true);
    setRecordProgress(0);

    try {
      await setupAudioGraph();
      audio.pause();
      audio.currentTime = 0;

      const canvasStream = canvas.captureStream(60);
      const output = new MediaStream();
      canvasStream.getVideoTracks().forEach((track) => output.addTrack(track));

      const audioWithCapture = audio as HTMLAudioElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const capture = audioWithCapture.captureStream?.() ?? audioWithCapture.mozCaptureStream?.();
      capture?.getAudioTracks().forEach((track: MediaStreamTrack) => output.addTrack(track));

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm;codecs=vp8,opus";

      const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 10_000_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.start(300);
      await audio.play();
      setIsPlaying(true);

      const progressTimer = window.setInterval(() => {
        const duration = audio.duration || trackDuration || 1;
        setRecordProgress(clamp(audio.currentTime / duration));
      }, 150);

      await new Promise<void>((resolve) => {
        const endRecording = () => {
          if (recorder.state !== "inactive") recorder.stop();
          window.clearInterval(progressTimer);
          audio.removeEventListener("ended", endRecording);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${trackName || "clip"}-beatframe.webm`;
          link.click();
          URL.revokeObjectURL(url);
          setRecordProgress(1);
          resolve();
        };

        audio.addEventListener("ended", endRecording, { once: true });
      });
    } catch (error) {
      setRecordError("Не получилось записать клип. Проверь, что трек загружен и браузер разрешает звук.");
      console.error(error);
    } finally {
      setIsRecording(false);
    }
  };

  const analysisLine = analysis
    ? `AI выбрал стиль ${analysis.preset.title} (${analysis.preset.mood}). Tempo ${analysis.tempo} BPM, confidence ${Math.round(analysis.confidence * 100)}%.`
    : "AI пока не анализировал трек.";

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="bg-shift pointer-events-none absolute inset-0 opacity-55" />

      <main className="relative mx-auto flex w-full max-w-[1340px] flex-col gap-6 px-4 py-5 sm:px-6 md:py-8">
        <header className={`space-y-3 transition-all duration-500 ${hideUi ? "-translate-y-8 opacity-0" : "opacity-100"}`}>
          <p className="text-sm uppercase tracking-[0.24em] text-violet-300/85">BeatFrame AI</p>
          <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">Готовый клип из твоего бита: анализ, сцены, экспорт</h1>
          <p className="max-w-4xl text-sm text-slate-300 sm:text-base">{helperText}</p>
          <p className="text-sm text-slate-400">{analysisLine}</p>
          {analysisError ? <p className="text-sm text-rose-300">{analysisError}</p> : null}
          {recordError ? <p className="text-sm text-rose-300">{recordError}</p> : null}
        </header>

        <section ref={stageRef} className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/80">
          <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="h-full w-full" />
          {isRecording ? (
            <div className="absolute left-4 right-4 top-4 h-2 overflow-hidden rounded-full bg-black/60">
              <div className="h-full bg-violet-400 transition-[width] duration-150" style={{ width: `${recordProgress * 100}%` }} />
            </div>
          ) : null}
        </section>

        <section
          className={`grid gap-3 rounded-xl border border-white/10 bg-slate-950/75 p-3 backdrop-blur-md transition-all duration-500 sm:grid-cols-2 lg:grid-cols-3 ${
            hideUi ? "pointer-events-none translate-y-8 opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          <label className="flex h-10 items-center justify-center rounded-lg border border-dashed border-violet-300/45 bg-violet-400/10 px-3 text-sm font-medium text-violet-100 transition hover:border-violet-200/85 hover:bg-violet-300/15">
            Загрузить бит/трек (MP3/WAV)
            <input type="file" accept="audio/*" onChange={handleUpload} className="hidden" />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("ai")}
              className={`h-10 flex-1 rounded-lg border px-3 text-sm transition ${
                mode === "ai" ? "border-violet-300 bg-violet-400/20 text-violet-100" : "border-white/20"
              }`}
            >
              AI Director
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`h-10 flex-1 rounded-lg border px-3 text-sm transition ${
                mode === "manual" ? "border-violet-300 bg-violet-400/20 text-violet-100" : "border-white/20"
              }`}
            >
              Ручной
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-slate-400">Сцена (manual)</span>
            <select
              value={manualScene}
              onChange={(event) => setManualScene(event.target.value as SceneKind)}
              disabled={mode !== "manual"}
              className="h-10 rounded-lg border border-white/15 bg-slate-900 px-3 text-sm outline-none transition disabled:opacity-45 focus:border-violet-400"
            >
              {SCENE_OPTIONS.map((scene) => (
                <option key={scene.value} value={scene.value}>
                  {scene.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-wider text-slate-400">Accent</label>
            <input
              type="color"
              value={accentColor}
              onChange={(event) => setAccentColor(event.target.value)}
              className="h-10 w-16 cursor-pointer rounded border border-white/15 bg-slate-900"
            />
            <input
              type="color"
              value={secondaryColor}
              onChange={(event) => setSecondaryColor(event.target.value)}
              className="h-10 w-16 cursor-pointer rounded border border-white/15 bg-slate-900"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider text-slate-400">Чувствительность: {sensitivity.toFixed(2)}</label>
            <input
              type="range"
              min={0.7}
              max={1.8}
              step={0.01}
              value={sensitivity}
              onChange={(event) => setSensitivity(Number(event.target.value))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider text-slate-400">Плавность: {smoothing.toFixed(2)}</label>
            <input
              type="range"
              min={0.6}
              max={0.9}
              step={0.01}
              value={smoothing}
              onChange={(event) => setSmoothing(Number(event.target.value))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
            <button
              type="button"
              onClick={handleRecordClip}
              disabled={!audioSrc || isRecording || isAnalyzing}
              className="h-10 rounded-lg border border-violet-300/45 bg-violet-400/15 px-4 text-sm text-violet-100 transition hover:border-violet-200 hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isRecording ? "Запись..." : "Скачать клип .webm"}
            </button>
            <button
              type="button"
              onClick={handleFullscreen}
              className="h-10 rounded-lg border border-white/20 px-3 text-sm transition hover:border-violet-300 hover:text-violet-200"
            >
              Fullscreen
            </button>
            <button
              type="button"
              onClick={handleDownloadFrame}
              className="h-10 rounded-lg border border-white/20 px-3 text-sm transition hover:border-violet-300 hover:text-violet-200"
            >
              PNG кадр
            </button>
            <button
              type="button"
              onClick={() => setHideUi((prev) => !prev)}
              className="h-10 rounded-lg border border-white/20 px-3 text-sm transition hover:border-violet-300 hover:text-violet-200"
            >
              Чистый кадр
            </button>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <audio
              ref={audioRef}
              src={audioSrc}
              controls
              className="h-10 w-full"
              onLoadedMetadata={(event) => setTrackDuration(event.currentTarget.duration || 0)}
              onPlay={async () => {
                await setupAudioGraph();
                setIsPlaying(true);
              }}
              onPause={() => setIsPlaying(false)}
            />
            <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span className="truncate pr-4">Трек: {trackName}</span>
              <span className={isPlaying ? "text-emerald-300" : "text-slate-400"}>{isPlaying ? "Playback: On" : "Playback: Off"}</span>
            </div>
          </div>
        </section>

        {hideUi ? (
          <button
            type="button"
            onClick={() => setHideUi(false)}
            className="absolute right-6 top-6 z-20 h-10 rounded-lg border border-white/30 bg-black/40 px-3 text-sm text-slate-100 backdrop-blur transition hover:border-violet-300 hover:text-violet-100"
          >
            Показать UI
          </button>
        ) : null}
      </main>
    </div>
  );
}
