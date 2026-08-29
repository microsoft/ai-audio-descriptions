import axios from "axios";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Segment } from "../src/Models";
import { config } from "./config";
import { prepareVideo, processVideo, updateDescriptions } from "./pipeline";
import { renderVideo } from "./renderPipeline";
import {
  createVideo,
  deleteVideo,
  getAudioContentUrl,
  getVideo,
  getVideoContentUrl,
  listVideos,
  videoExists,
} from "./storage";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/videos", async (_request, response, next) => {
  try {
    response.json(await listVideos());
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos", async (request, response, next) => {
  try {
    const { title, metadata = "", narrationStyle = "" } = request.body;
    if (typeof title !== "string" || !title.trim()) {
      response.status(400).json({ error: "A video title is required." });
      return;
    }
    if (await videoExists(title)) {
      response.status(409).json({
        error: "There is already an existing video file that has the same title, please use a different title.",
      });
      return;
    }
    response.status(201).json(await createVideo(title, metadata, narrationStyle));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/upload-complete", async (request, response, next) => {
  try {
    const { title, metadata = "", narrationStyle = "" } = request.body;
    if (!await videoExists(request.params.id)) {
      response.status(409).json({ error: "The video upload did not complete." });
      return;
    }
    await prepareVideo(request.params.id, title, metadata, narrationStyle);
    response.json(await getVideo(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id", async (request, response, next) => {
  try {
    response.json(await getVideo(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/content", async (request, response, next) => {
  try {
    response.redirect(await getVideoContentUrl(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/videos/:id/audio/:index", async (request, response, next) => {
  try {
    response.redirect(
      await getAudioContentUrl(request.params.id, Number(request.params.index)),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/process", async (request, response, next) => {
  try {
    if (!await videoExists(request.params.id)) {
      response.status(409).json({ error: "Upload the video before processing it." });
      return;
    }
    void processVideo(request.params.id).catch(error => {
      console.error(`Unable to start processing ${request.params.id}:`, error);
    });
    response.status(202).end();
  } catch (error) {
    next(error);
  }
});

app.put("/api/videos/:id/descriptions", async (request, response, next) => {
  try {
    const descriptions = request.body.descriptions as Segment[] | undefined;
    if (!Array.isArray(descriptions)) {
      response.status(400).json({ error: "Descriptions must be an array." });
      return;
    }
    await updateDescriptions(request.params.id, descriptions);
    response.json(await getVideo(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/:id/render", async (request, response, next) => {
  try {
    if (!await videoExists(request.params.id)) {
      response.status(404).json({ error: "Video not found." });
      return;
    }
    const rendered = await renderVideo(request.params.id);
    response.download(rendered.path, rendered.fileName, (error) => {
      void rendered.cleanup().catch((cleanupError) => {
        console.error(`Unable to clean up rendered video ${request.params.id}:`, cleanupError);
      }).then(() => {
        if (error) {
          next(error);
        }
      });
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/videos/:id", async (request, response, next) => {
  try {
    await deleteVideo(request.params.id);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const status = axios.isAxiosError(error) ? error.response?.status ?? 500 : 500;
  const message = axios.isAxiosError(error)
    ? error.response?.data?.error?.message
      ?? error.response?.data?.message
      ?? error.message
    : error instanceof Error ? error.message : "The request failed.";
  console.error(error);
  response.status(status).json({ error: message });
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`API listening on http://127.0.0.1:${config.port}`);
});
