# Image rules for FlintAI (Gemini) image inputs

Enforce before sending images to the backend `/api/ai/chat` (tests will fail otherwise):

- Accepted MIME types: `image/jpeg`, `image/png`, `image/webp` only — transcode SVG/BMP/HEIC first.
- For animated images (GIF/APNG/animated WEBP), extract frame 1 only.
- Resize before encoding — avoid multi-MB base64 payloads.
- Don't send blank or solid-colour images.
- Frontend sends raw base64 (no `data:` prefix); backend wraps each in `ImageContent(image_base64=...)`.
