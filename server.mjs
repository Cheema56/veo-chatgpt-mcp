import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "25mb" }));

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.GEMINI_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.VEO_MODEL || "veo-3.1-generate-preview";
const jobs = new Map();

async function gemini(path, options = {}) {
  const r = await fetch(BASE + path, options);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`Gemini API ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

function apiHeaders() {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": API_KEY
  };
}

async function startVeo(args) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured on the server.");

  const instance = { prompt: args.prompt };
  if (args.image_base64) {
    instance.image = {
      inlineData: {
        mimeType: args.image_mime_type || "image/jpeg",
        data: args.image_base64
      }
    };
  }

  const parameters = {
    aspectRatio: args.aspect_ratio || "16:9",
    durationSeconds: String(args.duration_seconds || 8),
    resolution: args.resolution || "720p"
  };

  // Veo requires 8 seconds for 1080p and 4K.
  if ((parameters.resolution === "1080p" || parameters.resolution === "4k") &&
      parameters.durationSeconds !== "8") {
    parameters.durationSeconds = "8";
  }

  return gemini(`/models/${MODEL}:predictLongRunning`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ instances: [instance], parameters })
  });
}

async function checkOperation(name) {
  return gemini(`/${name}`, {
    headers: { "x-goog-api-key": API_KEY }
  });
}

function makeServer() {
  const server = new McpServer({
    name: "veo-chatgpt-mcp",
    version: "1.0.0"
  });

  server.registerTool(
    "generate_veo_video",
    {
      title: "Generate Veo 3.1 video",
      description: "Start a Google Veo 3.1 video generation job.",
      inputSchema: {
        prompt: z.string().min(1),
        aspect_ratio: z.enum(["16:9", "9:16"]).optional(),
        duration_seconds: z.number().int().min(4).max(8).optional(),
        resolution: z.enum(["720p", "1080p", "4k"]).optional(),
        image_base64: z.string().optional(),
        image_mime_type: z.string().optional()
      }
    },
    async (args) => {
      const operation = await startVeo(args);
      const job_id = randomUUID();
      jobs.set(job_id, operation.name);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            job_id,
            operation: operation.name,
            status: "started"
          })
        }]
      };
    }
  );

  server.registerTool(
    "check_veo_operation",
    {
      title: "Check Veo generation",
      description: "Check a Veo job until it completes.",
      inputSchema: { job_id: z.string().uuid() }
    },
    async ({ job_id }) => {
      const operationName = jobs.get(job_id);
      if (!operationName) {
        return { isError: true, content: [{ type: "text", text: "Unknown job_id." }] };
      }

      const operation = await checkOperation(operationName);

      if (!operation.done) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ job_id, done: false })
          }]
        };
      }

      jobs.delete(job_id);

      const video =
        operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video ??
        operation.response?.generatedVideos?.[0]?.video ??
        null;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            job_id,
            done: true,
            video_uri: video?.uri ?? null,
            error: operation.error ?? null
          })
        }]
      };
    }
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "veo-chatgpt-mcp" });
});

app.post("/mcp", async (req, res) => {
  try {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Veo MCP server listening on ${PORT}`);
});
