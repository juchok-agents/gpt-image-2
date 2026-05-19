import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    background: { type: "string" },
    input: { type: "string" },
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
const model = values.model?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";

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
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required. Codex / ChatGPT auth can be used only when a compatible OpenAI image CLI is installed separately.");
}

const image =
  command === "generate"
    ? await generateImage()
    : await editImage(values.input?.trim() ?? "");

await writeFile(output, Buffer.from(image, "base64"));
console.log(output);

async function generateImage() {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    body: JSON.stringify({
      background: values.background,
      model,
      prompt,
      quality: values.quality,
      size: values.size,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  return await readImage(response);
}

async function editImage(input: string) {
  const form = new FormData();
  form.set("model", model);
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
      authorization: `Bearer ${apiKey}`,
    },
    method: "POST",
  });

  return await readImage(response);
}

async function readImage(response: Response) {
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
