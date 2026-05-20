import axios from "axios";
import { aiServicesResource, aiServicesKey, gptDeployment } from "../keys";
import { delay, msToTime, timeToMs } from "./Helper";
import { Segment } from "../Models";
import { AnalyzerContent, AnalyzerResults } from "../ContentUnderstandingModels";

// Content Understanding GA API version. The previous code targeted
// `2024-12-01-preview`, which is scheduled for retirement on 2026-07-15.
const CU_API_VERSION = "2025-11-01";

// Prebuilt analyzer used for video. `prebuilt-videoSearch` returns scene-segmented
// markdown with per-segment Summary fields, embedded WEBVTT transcripts, and
// key-frame references — everything the rest of the pipeline needs without our
// having to define a custom analyzer up front.
const VIDEO_ANALYZER_ID = "prebuilt-videoSearch";

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
  const config = {
    headers: {
      "Ocp-Apim-Subscription-Key": aiServicesKey,
      "Content-Type": "application/json",
      "x-ms-useragent": "ai-audio-descriptions/1.0",
    },
  };
  const result = await axios.post(url, data, config);
  const operationLocation = result.headers["operation-location"]?.toString() ?? "";
  if (!operationLocation) {
    throw new Error("Content Understanding analyze response did not include an Operation-Location header.");
  }
  const idMatch = operationLocation.match(/analyzerResults\/([^/?]+)/);
  return { operationLocation, id: idMatch ? idMatch[1] : "" };
};

// Poll the operation URL returned by createAnalyzeFileTask.
export const getAnalyzeTaskInProgress = async (operationLocation: string): Promise<AnalyzerResults> => {
  const config = {
    headers: {
      "Ocp-Apim-Subscription-Key": aiServicesKey,
      "x-ms-useragent": "ai-audio-descriptions/1.0",
    },
  };
  const result = await axios.get(operationLocation, config);
  return result.data as AnalyzerResults;
};

// Pull description text and silence info out of a `prebuilt-videoSearch` result and
// produce a list of silent intervals with GPT-rewritten descriptions sized to fit.
export const getAudioDescriptionsFromAnalyzeResult = async (
  contents: AnalyzerContent[],
  title: string,
  metadata: string,
  narrationStyle: string
): Promise<Segment[]> => {
  // Reduce each prebuilt segment to the bits we care about for AD insertion.
  const allSegmentsInTheVideo = contents.map((segment) => ({
    startTime: segment.startTimeMs,
    endTime: segment.endTimeMs,
    description: extractSegmentDescription(segment),
    isSilent: !markdownHasDialog(segment.markdown),
  }));

  // Group consecutive silent segments into single silent intervals; concatenate
  // their descriptions so the GPT rewrite has the full context for that gap.
  const silentIntervals: Segment[] = [];
  let silentInterval: Segment | null = null;
  for (const segment of allSegmentsInTheVideo) {
    if (segment.isSilent) {
      if (!silentInterval) {
        silentInterval = {
          startTime: msToTime(segment.startTime),
          endTime: msToTime(segment.endTime),
          description: segment.description,
        };
      } else {
        silentInterval.endTime = msToTime(segment.endTime);
        silentInterval.description += " " + segment.description;
      }
    } else if (silentInterval) {
      silentIntervals.push(silentInterval);
      silentInterval = null;
    }
  }
  if (silentInterval) {
    silentIntervals.push(silentInterval);
  }

  const wordCountPerSecond = 3;
  const systemMessage =
    "Rewrite each *description* in no more than *maxWords*. Prefer clarity over length. " +
    "Do not explain what things mean. Use *metadata* to improve the *description*. " +
    "Do not repeat information in *previousDescription*. Output only the rewritten *description*.";
  let previousDescription = "";
  for (const segment of silentIntervals) {
    const duration = timeToMs(segment.endTime) - timeToMs(segment.startTime);
    const durationInSeconds = duration / 1000;
    const wordCount = Math.max(1, Math.round(durationInSeconds * wordCountPerSecond));

    const userMessage: string = JSON.stringify({
      metadata: { title, context: metadata, writingStyle: narrationStyle },
      description: segment.description,
      previousDescription,
      maxWords: wordCount,
    });

    const rewriteResult = await getGptOutput(systemMessage, userMessage);
    segment.description = rewriteResult;
    previousDescription = rewriteResult;
  }
  return silentIntervals;
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
  // Drop the top `# Video: HH:MM:SS => HH:MM:SS` heading if present.
  let body = markdown.replace(/^\s*#\s+Video:[^\n]*\n+/i, "");
  // Stop at the first sub-section heading ("## ..." or "Transcript" or "Key Frames").
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

const getGptOutput = async (systemMessage: string, userMessage: string): Promise<string> => {
  const data = {
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: 4096,
  };

  const url = `https://${aiServicesResource}.openai.azure.com/openai/deployments/${gptDeployment}/chat/completions?api-version=2024-10-21`;
  const config = {
    headers: {
      "Content-Type": "application/json",
      "api-key": aiServicesKey,
    },
  };
  try {
    const result = await axios.post(url, data, config);
    return result.data.choices[0].message.content;
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 429) {
      console.log(error);
      await delay(20000);
      return await getGptOutput(systemMessage, userMessage);
    }
    return "";
  }
};

const cuBaseUrl = (): string => `https://${aiServicesResource}.cognitiveservices.azure.com/contentunderstanding`;
