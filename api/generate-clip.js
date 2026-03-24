import { createDirectorPlan, createVideoTask, getConfig, normalizeError, sendJson } from "./_dashscope.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const features = body.features;
    const idea = String(body.idea || "");
    const seconds = Math.max(4, Math.min(12, Number(body.seconds || 8)));
    const resolution = ["480P", "720P"].includes(body.resolution) ? body.resolution : "720P";

    if (!features || typeof features.bpm !== "number") {
      sendJson(res, 400, { message: "Некорректные параметры анализа аудио" });
      return;
    }

    const config = getConfig();
    const plan = await createDirectorPlan({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      qwenModel: config.qwenModel,
      features,
      idea,
      seconds,
    });

    const taskId = await createVideoTask({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      videoModel: config.videoModel,
      plan,
      seconds,
      resolution,
    });

    sendJson(res, 200, {
      taskId,
      directorPlan: plan,
    });
  } catch (error) {
    const normalized = normalizeError(error);
    sendJson(res, normalized.status || 500, { message: normalized.message });
  }
}