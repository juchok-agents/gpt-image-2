# GPT Image 2

Use this skill when the user asks to generate or edit raster images.

This skill is a CLI-first interface. Call it from bash; do not expect an agent tool.

## Requirements

One of these authentication methods must be configured in the workstation:

- `OPENAI_API_KEY` for direct OpenAI API access.
- Codex / ChatGPT auth in `$PI_CODING_AGENT_DIR/auth.json`.

## Usage

Generate an image:

```bash
bun "$MEMORY_DIR/main/skills/gpt-image-2/image.ts" generate \
  --prompt "A clean product render of a compact desk lamp" \
  --output ./image.png
```

The default image model is `gpt-image-2`. Override it with `--model` or `OPENAI_IMAGE_MODEL`.

When using Codex / ChatGPT auth, the CLI calls the Responses API image generation tool through a text-capable mainline model. The default mainline model is `gpt-5.5`. Override it with `--main-model` or `OPENAI_IMAGE_MAIN_MODEL`.

Edit an image:

```bash
bun "$MEMORY_DIR/main/skills/gpt-image-2/image.ts" edit \
  --prompt "Remove the background and keep natural shadows" \
  --input ./source.png \
  --output ./edited.png
```

The CLI should fail loudly when authentication is missing.
