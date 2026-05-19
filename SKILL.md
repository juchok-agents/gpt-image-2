# GPT Image 2

Use this skill when the user asks to generate or edit raster images.

This skill is a CLI-first interface. Call it from bash; do not expect an agent tool.

## Requirements

One of these authentication methods must be configured in the workstation:

- `OPENAI_API_KEY` for direct OpenAI API access.
- Codex / ChatGPT auth available to the workstation, when the installed CLI supports it.

## Usage

Generate an image:

```bash
bun run "$MEMORY_DIR/main/skills/gpt-image-2/image.ts" generate \
  --prompt "A clean product render of a compact desk lamp" \
  --output ./image.png
```

The default model is `gpt-image-2`. Override it with `--model` or `OPENAI_IMAGE_MODEL` if the workstation is configured for a different GPT Image model.

Edit an image:

```bash
bun run "$MEMORY_DIR/main/skills/gpt-image-2/image.ts" edit \
  --prompt "Remove the background and keep natural shadows" \
  --input ./source.png \
  --output ./edited.png
```

The CLI should fail loudly when authentication is missing.
