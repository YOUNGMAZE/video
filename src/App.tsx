import { ChangeEvent, useEffect, useMemo, useState } from "react";

type AudioFeatures = {
  durationSec: number;
  bpm: number;
  energy: number;
  bass: number;
  brightness: number;
  stereoWidth: number;
};

type DirectorPlan = {
  title: string;
  prompt: string;
  negativePrompt: string;
};

type GenerateState = "idle" | "analyzing" | "directing" | "rendering" | "done" | "error";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const estimateBpm = (samples: Float32Array, sampleRate: number) => {
  const hop = 1024;
  const envelope: number[] = [];
  for (let i = 0; i + hop < samples.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j += 1) sum += Math.abs(samples[i + j]);
    envelope.push(sum / hop);
  }

  if (envelope.length < 10) return 120;

  let fluxMean = 0;
  const flux = envelope.map((value, index) => {
    if (index === 0) return 0;
    const delta = Math.max(0, value - envelope[index - 1]);
    fluxMean += delta;
    return delta;
  });
  fluxMean /= flux.length;

  const peaks: number[] = [];
  const threshold = fluxMean * 1.65;
  for (let i = 1; i < flux.length - 1; i += 1) {
    if (flux[i] > threshold && flux[i] > flux[i - 1] && flux[i] > flux[i + 1]) peaks.push(i);
  }

  const votes = new Map<number, number>();
  for (let i = 0; i < peaks.length; i += 1) {
    for (let j = i + 1; j < Math.min(i + 9, peaks.length); j += 1) {
      const seconds = ((peaks[j] - peaks[i]) * hop) / sampleRate;
      if (seconds <= 0.18) continue;
      let bpm = 60 / seconds;
      while (bpm < 70) bpm *= 2;
      while (bpm > 190) bpm /= 2;
      const rounded = Math.round(bpm);
      votes.set(rounded, (votes.get(rounded) ?? 0) + 1);
    }
  }

  let best = 120;
  let max = 0;
  votes.forEach((count, bpm) => {
    if (count > max) {
      max = count;
      best = bpm;
    }
  });
  return best;
};

const analyzeAudio = async (file: File): Promise<AudioFeatures> => {
  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));

  const left = decoded.getChannelData(0);
  const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) mono[i] = (left[i] + right[i]) * 0.5;

  let sumSq = 0;
  let bassSq = 0;
  let hf = 0;
  let low = 0;
  const lowPassFactor = 0.04;
  for (let i = 0; i < mono.length; i += 1) {
    const x = mono[i];
    low += lowPassFactor * (x - low);
    const high = x - low;
    sumSq += x * x;
    bassSq += low * low;
    hf += Math.abs(high);
  }

  const rms = Math.sqrt(sumSq / Math.max(1, mono.length));
  const energy = clamp(rms * 2.8);
  const bass = clamp(Math.sqrt(bassSq / Math.max(1, mono.length)) / (rms + 1e-6));
  const brightness = clamp((hf / Math.max(1, mono.length)) * 3.5);

  let lrs = 0;
  let rrs = 0;
  let drs = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    lrs += l * l;
    rrs += r * r;
    const d = l - r;
    drs += d * d;
  }

  const stereoWidth = clamp(Math.sqrt(drs / Math.max(1, length)) / (Math.sqrt((lrs + rrs) / Math.max(1, length)) + 1e-6));
  const bpm = estimateBpm(mono, decoded.sampleRate);
  await context.close();

  return {
    durationSec: decoded.duration,
    bpm,
    energy,
    bass,
    brightness,
    stereoWidth,
  };
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [idea, setIdea] = useState("");
  const [seconds, setSeconds] = useState(8);
  const [resolution, setResolution] = useState("720P");

  const [directorPlan, setDirectorPlan] = useState<DirectorPlan | null>(null);
  const [taskId, setTaskId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [state, setState] = useState<GenerateState>("idle");
  const [statusText, setStatusText] = useState("Загрузи трек. Остальное сайт сделает сам.");
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const featuresText = useMemo(() => {
    if (!features) return "Нет анализа";
    return `BPM ${features.bpm}, energy ${features.energy.toFixed(2)}, bass ${features.bass.toFixed(2)}, bright ${features.brightness.toFixed(2)}, stereo ${features.stereoWidth.toFixed(2)}`;
  }, [features]);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setVideoUrl("");
    setDirectorPlan(null);
    setTaskId("");
    setErrorText("");
    setState("analyzing");
    setStatusText("Анализирую бит: темп, энергия, спектр...");

    try {
      const result = await analyzeAudio(file);
      setFeatures(result);
      setState("idle");
      setStatusText("Анализ готов. Жми генерацию клипа.");
    } catch {
      setState("error");
      setErrorText("Не удалось прочитать аудио. Попробуй MP3/WAV/M4A.");
      setStatusText("Ошибка анализа аудио.");
    }
  };

  const pollTask = async (id: string) => {
    for (let i = 0; i < 80; i += 1) {
      const response = await fetch(`/api/task-status?id=${encodeURIComponent(id)}`);
      const json = (await response.json()) as {
        status?: string;
        videoUrl?: string;
        message?: string;
      };

      if (!response.ok) throw new Error(json.message ?? "Ошибка проверки статуса задачи.");

      const status = (json.status ?? "").toUpperCase();
      if (status === "SUCCEEDED") {
        if (!json.videoUrl) throw new Error("Видео готово, но URL не пришел.");
        return json.videoUrl;
      }
      if (status === "FAILED" || status === "CANCELED") throw new Error(json.message ?? "Генерация завершилась ошибкой.");

      setStatusText(`Рендер клипа: ${status || "RUNNING"}. Жду результат...`);
      await sleep(8000);
    }
    throw new Error("Таймаут ожидания. Попробуй еще раз.");
  };

  const generateClip = async () => {
    if (!audioFile || !features) {
      setErrorText("Сначала загрузи трек и дождись анализа.");
      return;
    }

    setErrorText("");
    setVideoUrl("");
    setDirectorPlan(null);

    try {
      setState("directing");
      setStatusText("Qwen пишет режиссерский промпт под твой бит...");

      const response = await fetch("/api/generate-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features,
          idea,
          seconds,
          resolution,
          filename: audioFile.name,
        }),
      });

      const json = (await response.json()) as {
        taskId?: string;
        directorPlan?: DirectorPlan;
        message?: string;
      };

      if (!response.ok || !json.taskId || !json.directorPlan) {
        throw new Error(json.message ?? "Не удалось создать задачу генерации.");
      }

      setDirectorPlan(json.directorPlan);
      setTaskId(json.taskId);

      setState("rendering");
      setStatusText("Клип рендерится на сервере...");
      const resultUrl = await pollTask(json.taskId);
      setVideoUrl(resultUrl);
      setState("done");
      setStatusText("Клип готов. Можно смотреть и скачать MP4.");
    } catch (error) {
      setState("error");
      setErrorText(error instanceof Error ? error.message : "Неизвестная ошибка генерации.");
      setStatusText("Генерация не завершилась.");
    }
  };

  const downloadMp4 = async () => {
    if (!videoUrl) return;
    const fileBase = audioFile?.name.replace(/\.[^.]+$/, "") || "clip";
    const filename = `${fileBase}-ai-clip.mp4`;

    try {
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error("Не удалось загрузить файл для сохранения.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(videoUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto w-full max-w-6xl px-6 py-8 md:py-12">
        <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">Beat To Music Video</h1>
        <p className="mt-3 max-w-3xl text-zinc-300">
          Загружаешь трек, сайт сам анализирует бит и через Qwen + video model генерирует клип. Никаких API ключей в интерфейсе.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
            <label className="block text-sm font-medium">Трек</label>
            <input type="file" accept="audio/*" onChange={onFileChange} className="w-full text-sm" />

            <label className="block text-sm font-medium">Референс (опционально)</label>
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder="night drive, luxury cars, cinematic rain, west coast vibe"
              className="h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
            />

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Resolution
                <select
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
                >
                  <option value="480P">480P</option>
                  <option value="720P">720P</option>
                </select>
              </label>
              <label className="text-sm">
                Длина: {seconds} сек
                <input
                  type="range"
                  min={4}
                  max={12}
                  step={1}
                  value={seconds}
                  onChange={(event) => setSeconds(Number(event.target.value))}
                  className="mt-3 w-full"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={generateClip}
              disabled={state === "analyzing" || state === "directing" || state === "rendering"}
              className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
            >
              {state === "directing" || state === "rendering" ? "Генерирую..." : "Сгенерировать клип"}
            </button>
          </div>

          <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
            <p className="text-sm text-zinc-300">Статус: {statusText}</p>
            <p className="text-sm text-zinc-300">Анализ: {featuresText}</p>
            {taskId ? <p className="text-xs text-zinc-400">Task ID: {taskId}</p> : null}
            {errorText ? <p className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">{errorText}</p> : null}

            {audioUrl ? <audio controls src={audioUrl} className="w-full" /> : null}

            {directorPlan ? (
              <div className="rounded-xl border border-zinc-700 bg-zinc-950/70 p-4">
                <p className="text-sm font-semibold">Режиссерская идея: {directorPlan.title}</p>
                <p className="mt-2 text-xs text-zinc-300">{directorPlan.prompt}</p>
              </div>
            ) : null}

            {videoUrl ? (
              <div className="space-y-3">
                <video src={videoUrl} controls className="aspect-video w-full rounded-xl border border-zinc-700 bg-black" />
                <button
                  type="button"
                  onClick={downloadMp4}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold transition hover:bg-emerald-500"
                >
                  Скачать MP4
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}