import { useEffect, useMemo, useRef, useState } from "react";

type VisualStyle = "mini-spectrum" | "mini-scope" | "mini-stereo" | "mini-dual";

const STYLE_OPTIONS: { value: VisualStyle; label: string }[] = [
  { value: "mini-spectrum", label: "MiniMeters Spectrum" },
  { value: "mini-scope", label: "MiniMeters Oscilloscope" },
  { value: "mini-stereo", label: "MiniMeters Stereo Field" },
  { value: "mini-dual", label: "MiniMeters Dual Bars" },
];

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

const alphaHex = (alpha: number) => Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");

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
  const [isVisualizerReady, setIsVisualizerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [style, setStyle] = useState<VisualStyle>("mini-spectrum");
  const [accentColor, setAccentColor] = useState("#7c3aed");
  const [sensitivity, setSensitivity] = useState(1);
  const [smoothing, setSmoothing] = useState(0.83);
  const [hideUi, setHideUi] = useState(false);

  const helperText = useMemo(() => {
    if (!audioSrc) return "Загрузи MP3/WAV и выбери стиль визуализации в духе MiniMeters.";
    if (!isVisualizerReady) return "Нажми play на плеере, чтобы браузер разрешил аудио-анализ.";
    return "Для записи на YouTube включи Fullscreen и кнопку Чистый кадр.";
  }, [audioSrc, isVisualizerReady]);

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

  useEffect(() => {
    if (masterAnalyserRef.current) masterAnalyserRef.current.smoothingTimeConstant = smoothing;
    if (leftAnalyserRef.current) leftAnalyserRef.current.smoothingTimeConstant = smoothing;
    if (rightAnalyserRef.current) rightAnalyserRef.current.smoothingTimeConstant = smoothing;
  }, [smoothing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const masterAnalyser = masterAnalyserRef.current;
    if (!masterAnalyser) {
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return;
    }

    const leftAnalyser = leftAnalyserRef.current ?? masterAnalyser;
    const rightAnalyser = rightAnalyserRef.current ?? masterAnalyser;

    const frequencyData = new Uint8Array(masterAnalyser.frequencyBinCount);
    const waveformData = new Uint8Array(masterAnalyser.fftSize);
    const leftWaveData = new Uint8Array(leftAnalyser.fftSize);
    const rightWaveData = new Uint8Array(rightAnalyser.fftSize);
    const leftFreqData = new Uint8Array(leftAnalyser.frequencyBinCount);
    const rightFreqData = new Uint8Array(rightAnalyser.frequencyBinCount);

    const spectrumPeak = new Float32Array(88);
    const leftPeak = { current: 0 };
    const rightPeak = { current: 0 };

    const drawBackdrop = (time: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      bg.addColorStop(0, "#020617");
      bg.addColorStop(1, "#050b1a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.strokeStyle = `#ffffff1a`;
      ctx.lineWidth = 1;
      const rows = 20;
      for (let i = 0; i <= rows; i += 1) {
        const y = (CANVAS_HEIGHT / rows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      const scanline = ((time * 0.09) % (CANVAS_HEIGHT + 260)) - 130;
      const scanGradient = ctx.createLinearGradient(0, scanline - 100, 0, scanline + 100);
      scanGradient.addColorStop(0, "transparent");
      scanGradient.addColorStop(0.5, `${accentColor}${alphaHex(0.18)}`);
      scanGradient.addColorStop(1, "transparent");
      ctx.fillStyle = scanGradient;
      ctx.fillRect(0, scanline - 100, CANVAS_WIDTH, 200);
    };

    const drawMiniSpectrum = () => {
      masterAnalyser.getByteFrequencyData(frequencyData);

      const bars = spectrumPeak.length;
      const chartTop = 150;
      const chartBottom = CANVAS_HEIGHT - 190;
      const chartHeight = chartBottom - chartTop;
      const stepX = CANVAS_WIDTH / bars;
      const segHeight = 12;
      const segGap = 4;
      const sampleStep = Math.max(1, Math.floor(frequencyData.length / bars));

      for (let i = 0; i < bars; i += 1) {
        const value = Math.pow(frequencyData[i * sampleStep] / 255, 1.15) * sensitivity;
        const clamped = Math.min(value, 1.1);
        const activeHeight = clamped * chartHeight;
        const x = i * stepX + stepX * 0.16;
        const width = stepX * 0.68;

        spectrumPeak[i] = Math.max(clamped, spectrumPeak[i] - 0.012);
        const peakY = chartBottom - spectrumPeak[i] * chartHeight;

        const segments = Math.floor(activeHeight / (segHeight + segGap));
        for (let j = 0; j < segments; j += 1) {
          const y = chartBottom - (j + 1) * (segHeight + segGap);
          const alpha = 0.35 + (j / Math.max(1, segments)) * 0.65;
          ctx.fillStyle = `${accentColor}${alphaHex(alpha)}`;
          ctx.fillRect(x, y, width, segHeight);
        }

        ctx.fillStyle = `${accentColor}${alphaHex(0.95)}`;
        ctx.fillRect(x, peakY, width, 5);
      }
    };

    const drawMiniScope = () => {
      masterAnalyser.getByteTimeDomainData(waveformData);

      const centerY = CANVAS_HEIGHT / 2;
      const amp = 290 * sensitivity;

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff29";
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(CANVAS_WIDTH, centerY);
      ctx.stroke();

      ctx.lineWidth = 4;
      ctx.shadowBlur = 26;
      ctx.shadowColor = accentColor;
      ctx.strokeStyle = accentColor;
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

    const drawMiniStereoField = () => {
      leftAnalyser.getByteTimeDomainData(leftWaveData);
      rightAnalyser.getByteTimeDomainData(rightWaveData);

      const centerX = CANVAS_WIDTH / 2;
      const centerY = CANVAS_HEIGHT / 2;
      const spread = 360 * sensitivity;

      ctx.strokeStyle = "#ffffff24";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - 290);
      ctx.lineTo(centerX, centerY + 290);
      ctx.moveTo(centerX - 290, centerY);
      ctx.lineTo(centerX + 290, centerY);
      ctx.stroke();

      ctx.fillStyle = `${accentColor}${alphaHex(0.22)}`;
      for (let i = 0; i < leftWaveData.length; i += 2) {
        const l = (leftWaveData[i] - 128) / 128;
        const r = (rightWaveData[i] - 128) / 128;
        const x = centerX + (l + r) * spread;
        const y = centerY + (l - r) * spread;
        ctx.fillRect(x, y, 2, 2);
      }
    };

    const drawMiniDualBars = () => {
      leftAnalyser.getByteFrequencyData(leftFreqData);
      rightAnalyser.getByteFrequencyData(rightFreqData);

      const meterWidth = CANVAS_WIDTH * 0.78;
      const meterX = (CANVAS_WIDTH - meterWidth) / 2;
      const meterHeight = 56;
      const topY = CANVAS_HEIGHT * 0.38;
      const bottomY = CANVAS_HEIGHT * 0.55;

      const avgChannel = (data: Uint8Array) => {
        let sum = 0;
        const limit = Math.floor(data.length * 0.22);
        for (let i = 0; i < limit; i += 1) sum += data[i];
        return (sum / Math.max(1, limit) / 255) * sensitivity;
      };

      const leftLevel = Math.min(avgChannel(leftFreqData), 1);
      const rightLevel = Math.min(avgChannel(rightFreqData), 1);

      leftPeak.current = Math.max(leftLevel, leftPeak.current - 0.009);
      rightPeak.current = Math.max(rightLevel, rightPeak.current - 0.009);

      const drawMeter = (label: string, y: number, level: number, peak: number) => {
        ctx.fillStyle = "#ffffff18";
        ctx.fillRect(meterX, y, meterWidth, meterHeight);

        const fillWidth = meterWidth * level;
        ctx.fillStyle = `${accentColor}${alphaHex(0.88)}`;
        ctx.fillRect(meterX, y, fillWidth, meterHeight);

        const peakX = meterX + meterWidth * peak;
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(peakX - 2, y - 4, 4, meterHeight + 8);

        ctx.fillStyle = "#e2e8f0";
        ctx.font = "600 30px Inter, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(label, meterX - 55, y + meterHeight / 2 + 10);
      };

      drawMeter("L", topY, leftLevel, leftPeak.current);
      drawMeter("R", bottomY, rightLevel, rightPeak.current);
    };

    const drawOverlayLabels = () => {
      ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
      ctx.font = "500 22px Inter, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("BeatFrame x MiniMeters", 70, 64);

      ctx.fillStyle = "rgba(241, 245, 249, 0.92)";
      ctx.font = "700 52px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(trackName || "Untitled Track", CANVAS_WIDTH / 2, CANVAS_HEIGHT - 84);
    };

    const render = (time: number) => {
      drawBackdrop(time);

      if (style === "mini-spectrum") drawMiniSpectrum();
      if (style === "mini-scope") drawMiniScope();
      if (style === "mini-stereo") drawMiniStereoField();
      if (style === "mini-dual") drawMiniDualBars();

      drawOverlayLabels();
      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [trackName, style, accentColor, sensitivity, isVisualizerReady]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      audioContextRef.current?.close();
    };
  }, []);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const nextSrc = URL.createObjectURL(file);
    objectUrlRef.current = nextSrc;
    setAudioSrc(nextSrc);
    setTrackName(file.name.replace(/\.[^/.]+$/, ""));
    setIsVisualizerReady(false);
    setIsPlaying(false);
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="bg-shift pointer-events-none absolute inset-0 opacity-55" />

      <main className="relative mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-4 py-5 sm:px-6 md:py-8">
        <header className={`space-y-3 transition-all duration-500 ${hideUi ? "-translate-y-6 opacity-0" : "opacity-100"}`}>
          <p className="text-sm uppercase tracking-[0.24em] text-violet-300/85">BeatFrame Studio</p>
          <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">MiniMeters-стиль визуализации для твоего трека</h1>
          <p className="max-w-3xl text-sm text-slate-300 sm:text-base">{helperText}</p>
        </header>

        <section ref={stageRef} className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/80">
          <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="h-full w-full" />
        </section>

        <section
          className={`grid gap-3 rounded-xl border border-white/10 bg-slate-950/75 p-3 backdrop-blur-md transition-all duration-500 sm:grid-cols-2 lg:grid-cols-3 ${
            hideUi ? "pointer-events-none translate-y-8 opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          <label className="flex h-10 items-center justify-center rounded-lg border border-dashed border-violet-300/45 bg-violet-400/10 px-3 text-sm font-medium text-violet-100 transition hover:border-violet-200/85 hover:bg-violet-300/15">
            Выбрать аудио (MP3/WAV)
            <input type="file" accept="audio/*" onChange={handleUpload} className="hidden" />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-slate-400">Режим</span>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value as VisualStyle)}
              className="h-10 rounded-lg border border-white/15 bg-slate-900 px-3 text-sm outline-none transition focus:border-violet-400"
            >
              {STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-wider text-slate-400">Акцент</label>
            <input
              type="color"
              value={accentColor}
              onChange={(event) => setAccentColor(event.target.value)}
              className="h-10 w-20 cursor-pointer rounded border border-white/15 bg-slate-900"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider text-slate-400">Чувствительность: {sensitivity.toFixed(1)}</label>
            <input
              type="range"
              min={0.5}
              max={2.1}
              step={0.1}
              value={sensitivity}
              onChange={(event) => setSensitivity(Number(event.target.value))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider text-slate-400">Плавность: {smoothing.toFixed(2)}</label>
            <input
              type="range"
              min={0.55}
              max={0.95}
              step={0.01}
              value={smoothing}
              onChange={(event) => setSmoothing(Number(event.target.value))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
