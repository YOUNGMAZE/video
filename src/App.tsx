import { useEffect, useMemo, useRef, useState } from "react";

type VisualStyle = "neon-bars" | "orbital-wave" | "pulse-ring";

const STYLE_OPTIONS: { value: VisualStyle; label: string }[] = [
  { value: "neon-bars", label: "Neon Bars" },
  { value: "orbital-wave", label: "Orbital Wave" },
  { value: "pulse-ring", label: "Pulse Ring" },
];

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [audioSrc, setAudioSrc] = useState<string>("");
  const [trackName, setTrackName] = useState<string>("Выберите трек");
  const [isVisualizerReady, setIsVisualizerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [style, setStyle] = useState<VisualStyle>("neon-bars");
  const [accentColor, setAccentColor] = useState("#8b5cf6");
  const [sensitivity, setSensitivity] = useState(1.1);
  const [smoothing, setSmoothing] = useState(0.82);
  const [hideUi, setHideUi] = useState(false);

  const helperText = useMemo(() => {
    if (!audioSrc) return "Загрузи MP3/WAV, нажми play и визуализация оживет в реальном времени.";
    if (!isVisualizerReady) return "Нажми play на плеере, чтобы браузер разрешил аудио-анализ.";
    return "Нажми Fullscreen перед записью экрана для чистого 16:9 кадра.";
  }, [audioSrc, isVisualizerReady]);

  const setupAudioGraph = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    if (!sourceRef.current) {
      sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
    }

    if (!analyserRef.current) {
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = smoothing;
      sourceRef.current.connect(analyser);
      analyser.connect(audioContextRef.current.destination);
      analyserRef.current = analyser;
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    setIsVisualizerReady(true);
  };

  useEffect(() => {
    if (analyserRef.current) {
      analyserRef.current.smoothingTimeConstant = smoothing;
    }
  }, [smoothing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    if (!analyser) {
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return;
    }

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const waveformData = new Uint8Array(analyser.fftSize);

    const drawNeonBars = () => {
      analyser.getByteFrequencyData(frequencyData);
      const centerX = CANVAS_WIDTH / 2;
      const centerY = CANVAS_HEIGHT / 2;
      const radius = 180;
      const bars = 190;
      const step = Math.floor(frequencyData.length / bars);

      for (let i = 0; i < bars; i += 1) {
        const value = frequencyData[i * step] / 255;
        const boosted = Math.pow(value, 1.25) * 220 * sensitivity;
        const angle = (Math.PI * 2 * i) / bars;
        const startX = centerX + Math.cos(angle) * radius;
        const startY = centerY + Math.sin(angle) * radius;
        const endX = centerX + Math.cos(angle) * (radius + boosted);
        const endY = centerY + Math.sin(angle) * (radius + boosted);

        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 22;
        ctx.shadowColor = accentColor;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    };

    const drawOrbitalWave = () => {
      analyser.getByteTimeDomainData(waveformData);
      const centerY = CANVAS_HEIGHT / 2;
      const baseAmplitude = 220 * sensitivity;

      ctx.lineWidth = 3;
      ctx.strokeStyle = accentColor;
      ctx.shadowBlur = 18;
      ctx.shadowColor = accentColor;

      ctx.beginPath();
      for (let x = 0; x < CANVAS_WIDTH; x += 1) {
        const index = Math.floor((x / CANVAS_WIDTH) * waveformData.length);
        const sample = (waveformData[index] - 128) / 128;
        const y = centerY + sample * baseAmplitude;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      for (let x = 0; x < CANVAS_WIDTH; x += 1) {
        const index = Math.floor((x / CANVAS_WIDTH) * waveformData.length);
        const sample = (waveformData[index] - 128) / 128;
        const y = centerY - sample * baseAmplitude;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const drawPulseRing = (time: number) => {
      analyser.getByteFrequencyData(frequencyData);

      let lowEnergy = 0;
      const lowBand = Math.floor(frequencyData.length * 0.15);
      for (let i = 0; i < lowBand; i += 1) lowEnergy += frequencyData[i];
      lowEnergy = lowEnergy / lowBand / 255;

      const pulseRadius = 170 + lowEnergy * 260 * sensitivity;
      const centerX = CANVAS_WIDTH / 2;
      const centerY = CANVAS_HEIGHT / 2;

      ctx.lineWidth = 10;
      ctx.strokeStyle = accentColor;
      ctx.shadowBlur = 34;
      ctx.shadowColor = accentColor;
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();

      const particles = 120;
      for (let i = 0; i < particles; i += 1) {
        const angle = (Math.PI * 2 * i) / particles + time * 0.00035;
        const orbit = pulseRadius + 90 + (i % 11) * 7;
        const px = centerX + Math.cos(angle) * orbit;
        const py = centerY + Math.sin(angle) * orbit;
        const alpha = 0.2 + lowEnergy * 0.8;

        ctx.fillStyle = `${accentColor}${Math.round(alpha * 255)
          .toString(16)
          .padStart(2, "0")}`;
        ctx.beginPath();
        ctx.arc(px, py, 2 + lowEnergy * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const render = (time: number) => {
      const bg = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      bg.addColorStop(0, "#020617");
      bg.addColorStop(0.6, "#0b1120");
      bg.addColorStop(1, "#020617");

      ctx.fillStyle = bg;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.globalAlpha = 1;

      if (style === "neon-bars") drawNeonBars();
      if (style === "orbital-wave") drawOrbitalWave();
      if (style === "pulse-ring") drawPulseRing(time);

      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = "600 56px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(trackName || "Untitled Track", CANVAS_WIDTH / 2, CANVAS_HEIGHT - 90);

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

  const handleToggleUi = () => {
    setHideUi((prev) => !prev);
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
      <div className="bg-shift pointer-events-none absolute inset-0 opacity-60" />

      <main className="relative mx-auto flex w-full max-w-[1300px] flex-col gap-6 px-4 py-5 sm:px-6 md:py-8">
        <header className={`space-y-3 transition-all duration-500 ${hideUi ? "opacity-0 -translate-y-6" : "opacity-100"}`}>
          <p className="text-sm uppercase tracking-[0.24em] text-violet-300/80">BeatFrame Studio</p>
          <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">Загрузи трек и получи визуал, который можно сразу выложить на YouTube</h1>
          <p className="max-w-3xl text-sm text-slate-300 sm:text-base">{helperText}</p>
        </header>

        <section ref={stageRef} className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
          <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="h-full w-full" />
        </section>

        <section
          className={`grid gap-3 rounded-xl border border-white/10 bg-slate-950/75 p-3 backdrop-blur-md transition-all duration-500 sm:grid-cols-2 lg:grid-cols-3 ${
            hideUi ? "pointer-events-none translate-y-8 opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          <label className="flex items-center justify-center rounded-lg border border-dashed border-violet-300/40 bg-violet-400/10 px-3 py-2 text-sm font-medium text-violet-100 transition hover:border-violet-200/80 hover:bg-violet-300/15">
            Выбрать аудио (MP3/WAV)
            <input type="file" accept="audio/*" onChange={handleUpload} className="hidden" />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-slate-400">Стиль</span>
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
              max={2.2}
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
              onClick={handleToggleUi}
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
      </main>
    </div>
  );
}
