# Veo 3.1 ChatGPT MCP

A small MCP server that starts Veo 3.1 jobs through Google's Gemini API.

## Render
1. Create a Node Web Service from this GitHub repository.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add environment variable `GEMINI_API_KEY` in Render. Never commit the key to GitHub.
5. Health check: `/health`
6. MCP endpoint: `/mcp`

## MCP tools
- `generate_veo_video`
- `check_veo_operation`

Google Veo 3.1 API uses long-running generation operations. The client starts a job, then polls the operation until `done` is true.

The public Gemini API's current Veo documentation supports 16:9/9:16, 4/6/8 seconds, and 720p/1080p/4K with the documented duration restrictions.
