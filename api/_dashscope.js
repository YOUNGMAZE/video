const REGION_URL = {
  intl: "https://dashscope-intl.aliyuncs.com",
  china: "https://dashscope.aliyuncs.com",
  us: "https://dashscope-us.aliyuncs.com",
};

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const parseJsonFromModelText = (raw) => {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed?.title || !parsed?.prompt) return null;
    return {
      title: parsed.title,
      prompt: parsed.prompt,
      negativePrompt: parsed.negativePrompt || "low quality, blurry, watermark, text, logo, artifacts",
    };
  } catch {
    return null;
  }
};

const extractTaskId = (payload) => payload?.output?.task_id || payload?.task_id || "";

const extractVideoUrl = (payload) =>
  payload?.output?.video_url ||
  payload?.output?.result_url ||
  payload?.output?.results?.[0]?.video_url ||
  payload?.output?.results?.[0]?.url ||
  "";

export const getConfig = () => {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new ApiError("Сервер не настроен: отсутствует DASHSCOPE_API_KEY", 500);

  const region = process.env.DASHSCOPE_REGION || "intl";
  const endpoint = REGION_URL[region] || REGION_URL.intl;
  return {
    endpoint,
    apiKey,
    qwenModel: process.env.QWEN_MODEL || "qwen-plus",
    videoModel: process.env.VIDEO_MODEL || "wan2.2-t2v-plus",
  };
};

const dashscopeFetch = async (url, init, apiKey) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }

  if (!response.ok) {
    const message = json?.message || json?.code || text || "DashScope API error";
    throw new ApiError(message, response.status);
  }
  return json;
};

export const createDirectorPlan = async ({ endpoint, apiKey, qwenModel, features, idea, seconds }) => {
  const body = {
    model: qwenModel,
    messages: [
      {
        role: "system",
        content:
          "You are a world-class music video creative director. Return only valid JSON with keys: title, prompt, negativePrompt. Prompt must be in English, very cinematic, realistic, high-end cinematography, no text on screen.",
      },
      {
        role: "user",
        content: `Build a video concept from audio features: bpm=${features.bpm}, energy=${Number(features.energy).toFixed(2)}, bass=${Number(features.bass).toFixed(2)}, brightness=${Number(features.brightness).toFixed(2)}, stereoWidth=${Number(features.stereoWidth).toFixed(2)}, duration=${seconds}s. Extra user direction: ${idea || "none"}.`,
      },
    ],
    temperature: 0.85,
  };

  const json = await dashscopeFetch(`${endpoint}/compatible-mode/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify(body),
  }, apiKey);

  const modelText = json?.choices?.[0]?.message?.content || "";
  return (
    parseJsonFromModelText(modelText) || {
      title: "Beat Driven Cinema",
      prompt:
        "A premium cinematic night music video, dynamic camera movement, realistic locations, dramatic lighting, anamorphic lens flares, rhythm-synced edits, high production value, stylish wardrobe, smooth motion, 4k look",
      negativePrompt: "low quality, blurry, watermark, text, logo, artifacts",
    }
  );
};

export const createVideoTask = async ({ endpoint, apiKey, videoModel, plan, seconds, resolution }) => {
  const payload = {
    model: videoModel,
    input: {
      prompt: plan.prompt,
      negative_prompt: plan.negativePrompt,
    },
    parameters: {
      resolution,
      duration: seconds,
      prompt_extend: true,
    },
  };

  const json = await dashscopeFetch(
    `${endpoint}/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: "POST",
      headers: {
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(payload),
    },
    apiKey,
  );

  const taskId = extractTaskId(json);
  if (!taskId) throw new ApiError("Не удалось получить task_id от video API", 500);
  return taskId;
};

export const getTaskStatus = async ({ endpoint, apiKey, taskId }) => {
  const json = await dashscopeFetch(`${endpoint}/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: "GET" }, apiKey);
  const status = String(json?.output?.task_status || "").toUpperCase();
  const message = json?.output?.message || json?.message || "";
  const videoUrl = status === "SUCCEEDED" ? extractVideoUrl(json) : "";
  return { status, message, videoUrl };
};

export const sendJson = (res, statusCode, data) => {
  res.status(statusCode).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
};

export const normalizeError = (error) => {
  if (error instanceof ApiError) return error;
  return new ApiError(error instanceof Error ? error.message : "Неизвестная ошибка сервера", 500);
};