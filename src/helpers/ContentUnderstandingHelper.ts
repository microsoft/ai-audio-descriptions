import axios from "axios";
import { config } from "../config";
import { delay, msToTime } from "./Helper";
import { Segment } from "../Models";
import { AnalyzerContent, AnalyzerResults, AudioVisualContent } from "../ContentUnderstandingModels";

// Content Understanding GA API version. The previous code targeted
// `2024-12-01-preview`, which is scheduled for retirement on 2026-07-15.
const CU_API_VERSION = "2025-11-01";

// Prebuilt analyzer used for video. `prebuilt-videoSearch` returns scene-segmented
// markdown with per-segment Summary fields, embedded WEBVTT transcripts, and
// key-frame references — everything the rest of the pipeline needs without our
// having to define a custom analyzer up front.
const VIDEO_ANALYZER_ID = "prebuilt-videoSearch";

// AOAI Chat Completions API version that supports multimodal `image_url`
// content with the GPT-5 family.
const AOAI_API_VERSION = "2025-04-01-preview";

// Cap on key-frames sent in a single multimodal description call.
// Each image is base64-encoded into the request body; capping bounds payload
// size and token cost, and is sufficient for AD-grade scene understanding.
const KEYFRAMES_PER_INTERVAL_MAX = 5;

interface SubmitAnalyzeResult {
  // The polling URL returned by the service in the Operation-Location header.
  // Includes its own api-version, so subsequent GETs just hit this URL as-is.
  operationLocation: string;
  // Tracking id pulled out of the polling URL for display / persistence.
  id: string;
}

// Submit a video URL to the prebuilt video analyzer. Returns the polling URL.
export const createAnalyzeFileTask = async (videoUrl: string): Promise<SubmitAnalyzeResult> => {
  const url = `${cuBaseUrl()}/analyzers/${VIDEO_ANALYZER_ID}:analyze?api-version=${CU_API_VERSION}`;
  const data = { inputs: [{ url: videoUrl }] };
  const requestConfig = {
    headers: {
      "Ocp-Apim-Subscription-Key": config.foundry.key,
      "Content-Type": "application/json",
      "x-ms-useragent": "ai-audio-descriptions/1.0",
    },
  };
  const result = await axios.post(url, data, requestConfig);
  const operationLocation = result.headers["operation-location"]?.toString() ?? "";
  if (!operationLocation) {
    throw new Error("Content Understanding analyze response did not include an Operation-Location header.");
  }
  const idMatch = operationLocation.match(/analyzerResults\/([^/?]+)/);
  return { operationLocation, id: idMatch ? idMatch[1] : "" };
};

// Poll the operation URL returned by createAnalyzeFileTask.
export const getAnalyzeTaskInProgress = async (operationLocation: string): Promise<AnalyzerResults> => {
  const requestConfig = {
    headers: {
      "Ocp-Apim-Subscription-Key": config.foundry.key,
      "x-ms-useragent": "ai-audio-descriptions/1.0",
    },
  };
  const result = await axios.get(operationLocation, requestConfig);
  return result.data as AnalyzerResults;
};

// Internal: silent interval enriched with the source CU segments that
// contributed to it. We need the source segments (not just the merged
// description text) so we can pick representative key-frames to send to
// the multimodal model.
interface SourcedInterval {
  startTimeMs: number;
  endTimeMs: number;
  summaryText: string;
  segments: AudioVisualContent[];
}

// Pull description text and silence info out of a `prebuilt-videoSearch` result and
// produce a list of silent intervals with GPT-rewritten descriptions sized to fit.
//
// `operationId` is required because we fetch key-frame images for each interval
// via the Content Understanding result-files endpoint and pass them to the
// multimodal description model.
export const getAudioDescriptionsFromAnalyzeResult = async (
  contents: AnalyzerContent[],
  title: string,
  metadata: string,
  narrationStyle: string,
  operationId: string
): Promise<Segment[]> => {
  // Reduce each prebuilt segment to the bits we care about for AD insertion,
  // keeping the source AudioVisualContent so we can pull key-frames later.
  const allSegmentsInTheVideo = contents.map((segment) => ({
    source: segment,
    isSilent: !markdownHasDialog(segment.markdown),
    description: extractSegmentDescription(segment),
  }));

  // Group consecutive silent segments into single silent intervals.
  const silentIntervals: SourcedInterval[] = [];
  let current: SourcedInterval | null = null;
  for (const segment of allSegmentsInTheVideo) {
    if (segment.isSilent) {
      if (!current) {
        current = {
          startTimeMs: segment.source.startTimeMs,
          endTimeMs: segment.source.endTimeMs,
          summaryText: segment.description,
          segments: [segment.source],
        };
      } else {
        current.endTimeMs = segment.source.endTimeMs;
        current.summaryText += " " + segment.description;
        current.segments.push(segment.source);
      }
    } else if (current) {
      silentIntervals.push(current);
      current = null;
    }
  }
  if (current) {
    silentIntervals.push(current);
  }

  const wordCountPerSecond = 3;
  let previousDescription = "";
  const result: Segment[] = [];
  for (const interval of silentIntervals) {
    const durationMs = interval.endTimeMs - interval.startTimeMs;
    const wordBudget = Math.max(1, Math.round((durationMs / 1000) * wordCountPerSecond));

    // Pick representative key-frames across the contributing segments, then
    // fetch their bytes from CU and convert to base64 data URLs for the
    // multimodal request body.
    const frameTimesMs = pickKeyframes(interval.segments.flatMap((s) => s.keyFrameTimesMs ?? []));
    const frameDataUrls = await Promise.all(frameTimesMs.map((t) => getKeyframeDataUrl(operationId, t).catch(() => null)));
    const usableFrames = frameDataUrls.filter((u): u is string => !!u);

    const rewriteResult = await getAdDescription({
      title,
      metadata,
      narrationStyle,
      sceneSummary: interval.summaryText,
      previousDescription,
      maxWords: wordBudget,
      durationSeconds: durationMs / 1000,
      keyframeDataUrls: usableFrames,
    });

    result.push({
      startTime: msToTime(interval.startTimeMs),
      endTime: msToTime(interval.endTimeMs),
      description: rewriteResult,
    });
    previousDescription = rewriteResult;
  }
  return result;
};

// Extract the natural-language description of a segment. Prefer the structured
// `Summary` field if present; fall back to stripping the markdown.
const extractSegmentDescription = (segment: AnalyzerContent): string => {
  const summary = segment.fields?.["Summary"]?.value ?? segment.fields?.["Summary"]?.valueString;
  if (summary) {
    return summary;
  }
  return stripMarkdownSummary(segment.markdown);
};

// Pull the description text out of a segment's markdown block. Each segment
// markdown begins with a `# Video: ...` heading, then prose, then "Transcript"
// (WEBVTT), then "Key Frames" sections. We want just the prose between the
// heading and the first sub-section heading.
const stripMarkdownSummary = (markdown: string): string => {
  if (!markdown) return "";
  let body = markdown.replace(/^\s*#\s+Video:[^\n]*\n+/i, "");
  const stopMatch = body.match(/(\n##\s|\nTranscript\b|\nKey Frames\b)/i);
  if (stopMatch && stopMatch.index !== undefined) {
    body = body.slice(0, stopMatch.index);
  }
  return body.trim();
};

// True if a segment's embedded WEBVTT block contains at least one timed cue.
// We treat segments without spoken dialog as candidate silent intervals.
const WEBVTT_CUE = /\d{1,2}:\d{2}(?::\d{2})?\.\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?\.\d{1,3}/;
const markdownHasDialog = (markdown: string): boolean => {
  if (!markdown) return false;
  return WEBVTT_CUE.test(markdown);
};

// Pick up to KEYFRAMES_PER_INTERVAL_MAX key-frames, evenly spaced across the
// candidates. With a small N this is sufficient for the model to grasp the
// arc of the silent interval without blowing the token budget on near-dupes.
const pickKeyframes = (allFrameTimesMs: number[]): number[] => {
  const unique = Array.from(new Set(allFrameTimesMs)).sort((a, b) => a - b);
  if (unique.length <= KEYFRAMES_PER_INTERVAL_MAX) return unique;
  const step = (unique.length - 1) / (KEYFRAMES_PER_INTERVAL_MAX - 1);
  return Array.from({ length: KEYFRAMES_PER_INTERVAL_MAX }, (_, i) => unique[Math.round(i * step)]);
};

// Fetch a single key-frame image from the CU result-files endpoint and
// return it as a base64 data URL ready for the multimodal request body.
const getKeyframeDataUrl = async (operationId: string, frameTimeMs: number): Promise<string> => {
  const url = `${cuBaseUrl()}/analyzerResults/${operationId}/files/keyframes/${frameTimeMs}?api-version=${CU_API_VERSION}`;
  const response = await axios.get(url, {
    headers: { "Ocp-Apim-Subscription-Key": config.foundry.key },
    responseType: "arraybuffer",
  });
  const mime = (response.headers["content-type"] as string | undefined) ?? "image/jpeg";
  const base64 = arrayBufferToBase64(response.data as ArrayBuffer);
  return `data:${mime};base64,${base64}`;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

interface AdRequest {
  title: string;
  metadata: string;
  narrationStyle: string;
  sceneSummary: string;
  previousDescription: string;
  maxWords: number;
  durationSeconds: number;
  keyframeDataUrls: string[];
}

// Single multimodal call: writes a budget-fitted AD line for one silent gap,
// given the prebuilt scene summary, the gap duration, the previous AD line
// (for de-dup), and a handful of key-frames so the model can see the visuals.
//
// This replaces the v0 two-step "describe each shot then rewrite to fit" loop
// (gpt-4o, text-only) with a single GPT-5.5 multimodal call per gap.
const getAdDescription = async (req: AdRequest): Promise<string> => {
  const systemMessage =
    "You are writing audio descriptions for blind and low-vision viewers. " +
    "Look at the key-frames provided and write a single concise description that fits in the silent gap. " +
    "Hard rules: " +
    "use no more than the *maxWords* word budget; " +
    "prefer clarity over length; " +
    "describe what is visible, do not explain meaning; " +
    "do not repeat information from *previousDescription*; " +
    "match the requested *writingStyle* and use *context* only to disambiguate. " +
    "Output only the description text, no preamble.";

  const userText =
    `metadata: ${JSON.stringify({ title: req.title, context: req.metadata, writingStyle: req.narrationStyle })}\n` +
    `sceneSummary: ${req.sceneSummary}\n` +
    `previousDescription: ${req.previousDescription || "(none)"}\n` +
    `gapDurationSeconds: ${req.durationSeconds.toFixed(1)}\n` +
    `maxWords: ${req.maxWords}`;

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: userText }];
  for (const dataUrl of req.keyframeDataUrls) {
    userContent.push({ type: "image_url", image_url: { url: dataUrl, detail: "low" } });
  }

  const data = {
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userContent },
    ],
    temperature: 0,
    max_tokens: 4096,
  };

  const url = `${config.foundry.openAiEndpoint}/openai/deployments/${config.foundry.gptDeployment}/chat/completions?api-version=${AOAI_API_VERSION}`;
  const requestConfig = {
    headers: {
      "Content-Type": "application/json",
      "api-key": config.foundry.key,
    },
  };
  try {
    const result = await axios.post(url, data, requestConfig);
    return result.data.choices[0].message.content ?? "";
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 429) {
      console.log(error);
      await delay(20000);
      return await getAdDescription(req);
    }
    return "";
  }
};

const cuBaseUrl = (): string => config.foundry.contentUnderstandingEndpoint;
