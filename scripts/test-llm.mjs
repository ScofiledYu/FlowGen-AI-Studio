import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const username = os.userInfo().username || "unknown_user";

function repoRoot() {
  // This script lives at <root>/scripts/test-llm.mjs
  return path.resolve(import.meta.dirname, "..");
}

function readChatPanelSource() {
  const p = path.join(repoRoot(), "components", "ChatPanel.tsx");
  return { path: p, src: fs.readFileSync(p, "utf8") };
}

function extractStringProp(objName, propName, src) {
  // Example:
  // const GEMINI_API_CONFIG = { ... API_KEY: 'xxx', MODEL_NAME: 'yyy' }
  // Keep it intentionally simple: we only support string literal values.
  const objRe = new RegExp(
    String.raw`const\s+${objName}\s*=\s*\{[\s\S]*?\}`,
    "m"
  );
  const objMatch = src.match(objRe);
  if (!objMatch) return null;

  const body = objMatch[0];
  const propRe = new RegExp(
    String.raw`${propName}\s*:\s*(['"])(.*?)\1`,
    "m"
  );
  const m = body.match(propRe);
  return m ? m[2] : null;
}

function must(value, label) {
  if (!value) throw new Error(`Missing ${label} in components/ChatPanel.tsx`);
  return value;
}

function mkId(prefix) {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${username}_${ts}_${rnd}`;
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${text}`);
  }
  return { res, text };
}

// Parse SSE: data: {json}\n
function parseSSEToContent(raw) {
  let content = "";
  let reasoning = "";

  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const jsonStr = line.slice(5).trim();
    if (!jsonStr) continue;

    try {
      const obj = JSON.parse(jsonStr);
      if (obj?.error) throw new Error(JSON.stringify(obj.error));
      if (typeof obj.content === "string") content += obj.content;
      if (typeof obj.reasoning_content === "string") reasoning += obj.reasoning_content;
      if (obj.isDone) break;
    } catch {
      // Ignore malformed chunks
    }
  }

  return { content, reasoning };
}

function tryExtractAssistantText(text) {
  try {
    const j = JSON.parse(text);
    return j?.choices?.[0]?.message?.content ?? text;
  } catch {
    return text;
  }
}

function loadConfigFromChatPanel() {
  const { src } = readChatPanelSource();

  const qwen = {
    urlPath: must(
      extractStringProp("QWEN_API_CONFIG", "URL_TEXT", src) ||
        extractStringProp("QWEN_API_CONFIG", "URL", src),
      "QWEN_API_CONFIG.URL_TEXT"
    ),
    apiKey: must(extractStringProp("QWEN_API_CONFIG", "API_KEY", src), "QWEN_API_CONFIG.API_KEY"),
    model: must(extractStringProp("QWEN_API_CONFIG", "MODEL_NAME", src), "QWEN_API_CONFIG.MODEL_NAME"),
  };

  const gemini = {
    url: must(extractStringProp("GEMINI_API_CONFIG", "URL", src), "GEMINI_API_CONFIG.URL"),
    apiKey: must(extractStringProp("GEMINI_API_CONFIG", "API_KEY", src), "GEMINI_API_CONFIG.API_KEY"),
    model: must(extractStringProp("GEMINI_API_CONFIG", "MODEL_NAME", src), "GEMINI_API_CONFIG.MODEL_NAME"),
  };

  const claude = {
    url: must(extractStringProp("CLAUDE_API_CONFIG", "URL", src), "CLAUDE_API_CONFIG.URL"),
    apiKey: must(extractStringProp("CLAUDE_API_CONFIG", "API_KEY", src), "CLAUDE_API_CONFIG.API_KEY"),
    model: must(extractStringProp("CLAUDE_API_CONFIG", "MODEL_NAME", src), "CLAUDE_API_CONFIG.MODEL_NAME"),
  };

  return { qwen, gemini, claude };
}

async function testQwen({ qwen }) {
  // Qwen uses the same path as the frontend; needs dev server proxy to be running.
  const baseUrl = process.env.QWEN_BASE_URL || "http://localhost:5173";
  const url = new URL(qwen.urlPath, baseUrl).toString();

  const payload = {
    model: qwen.model,
    // Your requirement: use local OS username.
    user: username,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `ping from ${username}. Reply: QWEN_OK` }],
      },
    ],
    max_tokens: Number(process.env.QWEN_MAX_TOKENS || 2048),
  };

  const { text } = await postJson(url, { Authorization: `Bearer ${qwen.apiKey}` }, payload);
  return tryExtractAssistantText(text);
}

async function testAitopSee({ url, apiKey, model }, label) {
  const id = mkId("id");
  const payload = {
    // Your requirement: id_<local_username>_...
    id,
    message: `ping from ${username}. Reply: ${label}_OK`,
    model,
    tip: " ",
    webSearch: false,
    thinkingLevel: "low",
  };

  const { text } = await postJson(url, { "api-key": apiKey }, payload);

  // This endpoint is typically SSE; support both.
  try {
    const j = JSON.parse(text);
    return j?.content ?? j?.data ?? text;
  } catch {
    const { content, reasoning } = parseSSEToContent(text);
    return content + (reasoning ? `\n\n[reasoning]\n${reasoning}` : "");
  }
}

async function main() {
  const { path: chatPanelPath } = readChatPanelSource();
  console.log("Local username =", username);
  console.log("Reading config from =", chatPanelPath);

  const cfg = loadConfigFromChatPanel();

  try {
    const out = await testQwen(cfg);
    console.log("\n[QWEN] OK\n", out);
  } catch (e) {
    console.error("\n[QWEN] FAIL\n", e?.message || e);
  }

  try {
    const out = await testAitopSee(cfg.gemini, "GEMINI");
    console.log("\n[GEMINI] OK\n", out);
  } catch (e) {
    console.error("\n[GEMINI] FAIL\n", e?.message || e);
  }

  try {
    const out = await testAitopSee(cfg.claude, "CLAUDE");
    console.log("\n[CLAUDE] OK\n", out);
  } catch (e) {
    console.error("\n[CLAUDE] FAIL\n", e?.message || e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

