const JSON_HEADERS = { "Content-Type": "application/json" };

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
}

function methodNotAllowed() {
  return json(405, { error: "Method Not Allowed" });
}

function parseJsonBody(event) {
  if (!event.body) {
    return {};
  }

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function normalizeBaseUrl(input, fallback) {
  const source = typeof input === "string" && input.trim() ? input.trim() : fallback;
  return source.replace(/\/+$/, "");
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = {
  json,
  methodNotAllowed,
  parseJsonBody,
  normalizeBaseUrl,
  toIsoString,
};
