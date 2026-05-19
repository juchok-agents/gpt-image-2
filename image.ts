import { extname, join } from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const codexBaseUrl = "https://chatgpt.com/backend-api/codex/responses";
const codexClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const codexTokenUrl = "https://auth.openai.com/oauth/token";
const accountIdClaim = "https://api.openai.com/auth";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    background: { type: "string" },
    input: { type: "string" },
    "main-model": { type: "string" },
    model: { type: "string" },
    output: { type: "string", short: "o" },
    prompt: { type: "string", short: "p" },
    quality: { type: "string" },
    size: { type: "string" },
  },
});

const command = positionals[0];
const apiKey = process.env.OPENAI_API_KEY?.trim();
const prompt = values.prompt?.trim();
const output = values.output?.trim();
const imageModel = values.model?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
const mainModel = values["main-model"]?.trim() || process.env.OPENAI_IMAGE_MAIN_MODEL?.trim() || "gpt-5.5";

if (!command || !["generate", "edit"].includes(command)) {
  throw new Error("Usage: image.ts <generate|edit> --prompt <text> --output <file> [--input <file>]");
}
if (!prompt) {
  throw new Error("--prompt is required.");
}
if (!output) {
  throw new Error("--output is required.");
}
if (command === "edit" && !values.input?.trim()) {
  throw new Error("--input is required for edit.");
}

const image = apiKey ? await runOpenAIImagesApi(apiKey) : await runCodexImageGeneration();

await writeFile(output, Buffer.from(image, "base64"));
console.log(output);

async function runOpenAIImagesApi(key: string) {
  return command === "generate" ? await generateImage(key) : await editImage(key, values.input?.trim() ?? "");
}

async function generateImage(key: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    body: JSON.stringify({
      background: values.background,
      model: imageModel,
      prompt,
      quality: values.quality,
      size: values.size,
    }),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  return await readImagesApiResponse(response);
}

async function editImage(key: string, input: string) {
  const form = new FormData();
  form.set("model", imageModel);
  form.set("prompt", prompt ?? "");
  form.set("image", Bun.file(input));
  if (values.background) {
    form.set("background", values.background);
  }
  if (values.quality) {
    form.set("quality", values.quality);
  }
  if (values.size) {
    form.set("size", values.size);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    body: form,
    headers: {
      authorization: `Bearer ${key}`,
    },
    method: "POST",
  });

  return await readImagesApiResponse(response);
}

async function readImagesApiResponse(response: Response) {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI image request failed with ${response.status}: ${body}`);
  }

  const data = JSON.parse(body) as { data?: Array<{ b64_json?: string }> };
  const image = data.data?.[0]?.b64_json;
  if (!image) {
    throw new Error("OpenAI image response did not include data[0].b64_json.");
  }

  return image;
}

async function runCodexImageGeneration() {
  const auth = await loadCodexAuth();
  const input = await buildCodexInput();
  const tool = stripUndefined({
    action: command,
    background: values.background,
    model: imageModel,
    quality: values.quality,
    size: values.size,
    type: "image_generation",
  });

  const response = await fetch(codexBaseUrl, {
    body: JSON.stringify({
      instructions: "Generate or edit the requested image and return the image_generation result.",
      input,
      model: mainModel,
      store: false,
      stream: true,
      tool_choice: { type: "image_generation" },
      tools: [tool],
    }),
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${auth.access}`,
      "chatgpt-account-id": auth.accountId,
      "content-type": "application/json",
      "openai-beta": "responses=experimental",
      originator: "pi",
      "user-agent": "pi image skill",
    },
    method: "POST",
  });

  return await readCodexImageResponse(response);
}

async function buildCodexInput() {
  const content: Array<Record<string, string>> = [{ text: prompt ?? "", type: "input_text" }];
  const input = values.input?.trim();
  if (input) {
    const bytes = await readFile(input);
    content.push({
      image_url: `data:${mimeType(input)};base64,${bytes.toString("base64")}`,
      type: "input_image",
    });
  }

  return [{ content, role: "user" }];
}

async function readCodexImageResponse(response: Response) {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Codex image request failed with ${response.status}: ${body}`);
  }

  for (const event of parseServerSentEvents(body)) {
    const image = findImageBase64(event);
    if (image) {
      return image;
    }
  }

  throw new Error("Codex image response did not include an image_generation result.");
}

function parseServerSentEvents(body: string) {
  const events: unknown[] = [];
  for (const chunk of body.split(/\n\n+/)) {
    const data = chunk
      .split(/\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") {
      continue;
    }
    events.push(JSON.parse(data));
  }
  return events;
}

function findImageBase64(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "image_generation_call" && typeof record.result === "string") {
    return record.result;
  }
  if (typeof record.b64_json === "string") {
    return record.b64_json;
  }
  if (typeof record.partial_image_b64 === "string") {
    return record.partial_image_b64;
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findImageBase64(item);
        if (found) {
          return found;
        }
      }
      continue;
    }
    const found = findImageBase64(child);
    if (found) {
      return found;
    }
  }
  return undefined;
}

async function loadCodexAuth() {
  const authPath = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(process.env.HOME ?? "", ".codex"), "auth.json");
  return await withAuthLock(authPath, async () => {
    const auth = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    const credential = readStoredCodexCredential(auth);
    if (!credential) {
      throw new Error("OPENAI_API_KEY or Codex auth in PI_CODING_AGENT_DIR/auth.json is required.");
    }

    if (Date.now() < credential.expires - 60_000) {
      return credential;
    }

    const refreshed = await refreshCodexCredential(credential.refresh);
    auth["openai-codex"] = {
      type: "oauth",
      access: refreshed.access,
      refresh: refreshed.refresh,
      expires: refreshed.expires,
      accountId: refreshed.accountId,
    };
    if (typeof auth.tokens === "object" && auth.tokens !== null) {
      Object.assign(auth.tokens as Record<string, unknown>, {
        access_token: refreshed.access,
        account_id: refreshed.accountId,
        refresh_token: refreshed.refresh,
      });
    }
    await writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
    return refreshed;
  });
}

async function withAuthLock<T>(authPath: string, fn: () => Promise<T>) {
  const lockPath = `${authPath}.lock`;
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch {
      if (Date.now() - startedAt > 30_000) {
        throw new Error(`Timed out waiting for auth lock: ${lockPath}`);
      }
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > 60_000) {
          await rm(lockPath, { force: true, recursive: true });
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

function readStoredCodexCredential(auth: Record<string, unknown>) {
  const piCredential = auth["openai-codex"];
  if (typeof piCredential === "object" && piCredential !== null) {
    const record = piCredential as Record<string, unknown>;
    if (typeof record.access === "string" && typeof record.refresh === "string") {
      return {
        access: record.access,
        accountId: typeof record.accountId === "string" ? record.accountId : accountIdFromToken(record.access),
        expires: typeof record.expires === "number" ? record.expires : expiresFromToken(record.access),
        refresh: record.refresh,
      };
    }
  }

  const tokens = auth.tokens;
  if (typeof tokens === "object" && tokens !== null) {
    const record = tokens as Record<string, unknown>;
    if (typeof record.access_token === "string" && typeof record.refresh_token === "string") {
      return {
        access: record.access_token,
        accountId: typeof record.account_id === "string" ? record.account_id : accountIdFromToken(record.access_token),
        expires: expiresFromToken(record.access_token),
        refresh: record.refresh_token,
      };
    }
  }

  return undefined;
}

async function refreshCodexCredential(refreshToken: string) {
  const response = await fetch(codexTokenUrl, {
    body: new URLSearchParams({
      client_id: codexClientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Codex token refresh failed with ${response.status}: ${body}`);
  }

  const data = JSON.parse(body) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== "number") {
    throw new Error(`Codex token refresh returned an invalid response: ${body}`);
  }

  return {
    access: data.access_token,
    accountId: accountIdFromToken(data.access_token),
    expires: Date.now() + data.expires_in * 1000,
    refresh: data.refresh_token,
  };
}

function accountIdFromToken(token: string) {
  const accountId = decodeJwtPayload(token)[accountIdClaim]?.chatgpt_account_id;
  if (typeof accountId !== "string") {
    throw new Error("Codex access token does not include a ChatGPT account id.");
  }
  return accountId;
}

function expiresFromToken(token: string) {
  const exp = decodeJwtPayload(token).exp;
  if (typeof exp !== "number") {
    throw new Error("Codex access token does not include an expiration timestamp.");
  }
  return exp * 1000;
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];
  if (!payload) {
    throw new Error("Invalid JWT token.");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, any>;
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function mimeType(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}
