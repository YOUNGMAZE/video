import { getConfig, getTaskStatus, normalizeError, sendJson } from "./_dashscope.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { message: "Method not allowed" });
    return;
  }

  try {
    const taskId = String(req.query?.id || "");
    if (!taskId) {
      sendJson(res, 400, { message: "Требуется query-параметр id" });
      return;
    }

    const config = getConfig();
    const result = await getTaskStatus({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      taskId,
    });

    sendJson(res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error);
    sendJson(res, normalized.status || 500, { message: normalized.message });
  }
}