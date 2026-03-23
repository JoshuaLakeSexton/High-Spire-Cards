const BASE_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function withHeaders(extraHeaders) {
  return { ...BASE_HEADERS, ...(extraHeaders || {}) };
}

function json(statusCode, payload, extraHeaders) {
  return {
    statusCode,
    headers: withHeaders(extraHeaders),
    body: JSON.stringify(payload),
  };
}

function methodNotAllowed(extraHeaders) {
  return json(405, { error: "Method Not Allowed" }, extraHeaders);
}

function optionsResponse(extraHeaders) {
  return {
    statusCode: 204,
    headers: withHeaders(extraHeaders),
    body: "",
  };
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
  BASE_HEADERS,
  json,
  methodNotAllowed,
  optionsResponse,
  parseJsonBody,
  normalizeBaseUrl,
  toIsoString,
};
