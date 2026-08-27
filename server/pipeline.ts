import axios from "axios";
import * as SpeechSdk from "microsoft-cognitiveservices-speech-sdk";
import type {
  AnalyzerContent,
  AnalyzerResults,
  AudioVisualContent,
} from "../src/ContentUnderstandingModels";
import type { Segment } from "../src/Models";
import { getCognitiveServicesToken } from "./azure";
import { config, foundryEndpoint, openAiEndpoint } from "./config";
import {
  getStoredVideo,
  getVideoInputUrl,
  saveDescriptions,
  saveVideo,
  uploadAudio,
} from "./storage";
import type { StoredVideo } from "./types";

const contentUnderstandingApiVersion = "2025-11-01";
const openAiApiVersion = "2025-04-01-preview";
const videoAnalyzerId = "prebuilt-videoSearch";
const keyframesPerInterval = 5;
const speechVoice = "en-US-Ava:DragonHDOmniLatestNeural";

interface SubmitAnalyzeResult {
  operationLocation: string;
  id: string;
}

interface AnalyzerError {
  message?: string;
  innererror?: AnalyzerError;
}

interface SourcedInterval {
  startTimeMs: number;
  endTimeMs: number;
  summaryText: string;
  segments: AudioVisualContent[];
}

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

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const analyzerErrorMessage = (error: AnalyzerError): string =>
  error.innererror ? analyzerErrorMessage(error.innererror) : error.message ?? "Content Understanding analysis failed.";

const msToTime = (milliseconds: number): string => {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, "0")).join(":");
};

const submitAnalysis = async (videoUrl: string): Promise<SubmitAnalyzeResult> => {
  const token = await getCognitiveServicesToken();
  const url = `${foundryEndpoint}/contentunderstanding/analyzers/${videoAnalyzerId}:analyze?api-version=${contentUnderstandingApiVersion}`;
  const response = await axios.post(
    url,
    {
      inputs: [{ url: videoUrl }],
      modelDeployments: {
        "prebuilt-analyzer-completion-mini": config.gptDeployment,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-useragent": "ai-audio-descriptions/1.0",
      },
    },
  );
  const operationLocation = response.headers["operation-location"]?.toString();
  if (!operationLocation) {
    throw new Error("Content Understanding did not return an operation location.");
  }
  const id = operationLocation.match(/analyzerResults\/([^/?]+)/)?.[1];
  if (!id) {
    throw new Error("Content Understanding did not return an operation ID.");
  }
  return { operationLocation, id };
};

const waitForAnalysis = async (operationLocation: string): Promise<AnalyzerResults> => {
  while (true) {
    const token = await getCognitiveServicesToken();
    const response = await axios.get<AnalyzerResults>(operationLocation, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-ms-useragent": "ai-audio-descriptions/1.0",
      },
    });
    if (response.data.status === "Succeeded" && response.data.result) {
      return response.data;
    }
    if (response.data.status === "Failed" || response.data.error) {
      throw new Error(
        response.data.error
          ? analyzerErrorMessage(response.data.error)
          : "Content Understanding analysis failed.",
      );
    }
    await delay(15_000);
  }
};

const extractSegmentDescription = (segment: AnalyzerContent): string => {
  const summary = segment.fields?.Summary?.value ?? segment.fields?.Summary?.valueString;
  if (summary) {
    return summary;
  }
  let body = segment.markdown.replace(/^\s*#\s+Video:[^\n]*\n+/i, "");
  const stopMatch = body.match(/(\n##\s|\nTranscript\b|\nKey Frames\b)/i);
  if (stopMatch?.index !== undefined) {
    body = body.slice(0, stopMatch.index);
  }
  return body.trim();
};

const webVttCue =
  /\d{1,2}:\d{2}(?::\d{2})?\.\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?\.\d{1,3}/;

const pickKeyframes = (frameTimes: number[]): number[] => {
  const uniqueTimes = Array.from(new Set(frameTimes)).sort((left, right) => left - right);
  if (uniqueTimes.length <= keyframesPerInterval) {
    return uniqueTimes;
  }
  const step = (uniqueTimes.length - 1) / (keyframesPerInterval - 1);
  return Array.from(
    { length: keyframesPerInterval },
    (_, index) => uniqueTimes[Math.round(index * step)],
  );
};

const getKeyframeDataUrl = async (operationId: string, frameTimeMs: number): Promise<string> => {
  const token = await getCognitiveServicesToken();
  const url = `${foundryEndpoint}/contentunderstanding/analyzerResults/${operationId}/files/keyframes/${frameTimeMs}?api-version=${contentUnderstandingApiVersion}`;
  const response = await axios.get<ArrayBuffer>(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });
  const mimeType = response.headers["content-type"]?.toString() ?? "image/jpeg";
  return `data:${mimeType};base64,${Buffer.from(response.data).toString("base64")}`;
};

const createDescription = async (request: AdRequest): Promise<string> => {
  const token = await getCognitiveServicesToken();
  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        `metadata: ${JSON.stringify({
          title: request.title,
          context: request.metadata,
          writingStyle: request.narrationStyle,
        })}\n` +
        `sceneSummary: ${request.sceneSummary}\n` +
        `previousDescription: ${request.previousDescription || "(none)"}\n` +
        `gapDurationSeconds: ${request.durationSeconds.toFixed(1)}\n` +
        `maxWords: ${request.maxWords}`,
    },
    ...request.keyframeDataUrls.map((url) => ({
      type: "image_url",
      image_url: { url, detail: "low" },
    })),
  ];
  const url = `${openAiEndpoint}/openai/deployments/${config.gptDeployment}/chat/completions?api-version=${openAiApiVersion}`;
  const response = await axios.post(
    url,
    {
      messages: [
        {
          role: "system",
          content:
            "You are writing audio descriptions for blind and low-vision viewers. " +
            "Look at the key-frames provided and write a single concise description that fits in the silent gap. " +
            "Hard rules: " +
            "use no more than the *maxWords* word budget; " +
            "prefer clarity over length; " +
            "describe what is visible, do not explain meaning; " +
            "do not repeat information from *previousDescription*; " +
            "match the requested *writingStyle* and use *context* only to disambiguate. " +
            "Output only the description text, no preamble.",
        },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: 1024,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  const description = response.data.choices?.[0]?.message?.content;
  if (!description) {
    throw new Error("GPT did not return an audio description.");
  }
  return description;
};

const createDescriptionWithRetry = async (request: AdRequest): Promise<string> => {
  try {
    return await createDescription(request);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      await delay(20_000);
      return createDescriptionWithRetry(request);
    }
    return "";
  }
};

const createDescriptions = async (
  contents: AnalyzerContent[],
  video: StoredVideo,
  operationId: string,
): Promise<Segment[]> => {
  const silentIntervals: SourcedInterval[] = [];
  let current: SourcedInterval | undefined;

  for (const segment of contents) {
    if (!webVttCue.test(segment.markdown)) {
      if (!current) {
        current = {
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
          summaryText: extractSegmentDescription(segment),
          segments: [segment],
        };
      } else {
        current.endTimeMs = segment.endTimeMs;
        current.summaryText += ` ${extractSegmentDescription(segment)}`;
        current.segments.push(segment);
      }
    } else if (current) {
      silentIntervals.push(current);
      current = undefined;
    }
  }
  if (current) {
    silentIntervals.push(current);
  }

  const descriptions: Segment[] = [];
  let previousDescription = "";
  for (const interval of silentIntervals) {
    const durationMs = interval.endTimeMs - interval.startTimeMs;
    const frameTimes = pickKeyframes(
      interval.segments.flatMap((segment) => segment.keyFrameTimesMs ?? []),
    );
    const keyframeDataUrls = (
      await Promise.all(
        frameTimes.map((frameTime) =>
          getKeyframeDataUrl(operationId, frameTime).catch(() => undefined)),
      )
    ).filter((url): url is string => url !== undefined);
    const description = await createDescriptionWithRetry({
      title: video.title,
      metadata: video.metadata,
      narrationStyle: video.narrationStyle,
      sceneSummary: interval.summaryText,
      previousDescription,
      maxWords: Math.max(1, Math.round((durationMs / 1000) * 3)),
      durationSeconds: durationMs / 1000,
      keyframeDataUrls,
    });
    descriptions.push({
      startTime: msToTime(interval.startTimeMs),
      endTime: msToTime(interval.endTimeMs),
      description,
    });
    previousDescription = description;
  }
  return descriptions;
};

const synthesizeSpeech = async (text: string): Promise<ArrayBuffer> => {
  const token = await getCognitiveServicesToken();
  const authorizationToken = `aad#${config.foundryResourceId}#${token}`;
  const speechConfig = SpeechSdk.SpeechConfig.fromEndpoint(
    new URL(`${foundryEndpoint}/`),
    "",
  );
  speechConfig.authorizationToken = authorizationToken;
  speechConfig.speechSynthesisVoiceName = speechVoice;
  const synthesizer = new SpeechSdk.SpeechSynthesizer(speechConfig, null!);
  return new Promise<ArrayBuffer>((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === SpeechSdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(result.audioData);
          return;
        }
        reject(new Error(result.errorDetails || "Speech synthesis failed."));
      },
      (error) => {
        synthesizer.close();
        reject(new Error(error));
      },
    );
  });
};

const generateAudio = async (video: StoredVideo): Promise<void> => {
  video.stage = "synthesizing";
  video.audioGenerated = 0;
  await saveVideo(video);
  for (let index = 0; index < video.descriptions.length; index++) {
    const audio = await synthesizeSpeech(video.descriptions[index].description);
    await uploadAudio(video.id, index, audio);
    video.audioGenerated = index + 1;
    await saveVideo(video);
  }
};

const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.message
      ?? error.response?.data?.message
      ?? error.message;
  }
  return error instanceof Error ? error.message : "Video processing failed.";
};

const processVideoCore = async (id: string): Promise<void> => {
  const video = await getStoredVideo(id);
  if (video.status === "failed") {
    video.operationLocation = undefined;
  }
  video.status = "processing";
  video.stage = "analyzing";
  video.error = undefined;
  video.audioGenerated = 0;
  await saveVideo(video);

  try {
    let operationLocation = video.operationLocation;
    let operationId = operationLocation?.match(/analyzerResults\/([^/?]+)/)?.[1];
    if (!operationLocation || !operationId) {
      const analysis = await submitAnalysis(await getVideoInputUrl(id));
      operationLocation = analysis.operationLocation;
      operationId = analysis.id;
      video.operationLocation = operationLocation;
      video.videoUrl = `/api/videos/${encodeURIComponent(id)}/content`;
      await saveVideo(video);
    }
    const result = await waitForAnalysis(operationLocation);
    video.stage = "describing";
    await saveVideo(video);
    video.descriptions = await createDescriptions(
      result.result!.contents,
      video,
      operationId,
    );
    await saveDescriptions(id, video.descriptions);
    await generateAudio(video);
    video.status = "ready";
    video.stage = undefined;
    await saveVideo(video);
  } catch (error) {
    video.status = "failed";
    video.stage = undefined;
    video.error = errorMessage(error);
    await saveVideo(video);
    console.error(`Processing ${id} failed:`, error);
  }
};

const activeProcessing = new Map<string, Promise<void>>();

export const processVideo = (id: string): Promise<void> => {
  const existing = activeProcessing.get(id);
  if (existing) {
    return existing;
  }
  const processing = processVideoCore(id).finally(() => {
    activeProcessing.delete(id);
  });
  activeProcessing.set(id, processing);
  return processing;
};

export const prepareVideo = async (
  id: string,
  title: string,
  metadata: string,
  narrationStyle: string,
): Promise<void> => {
  const analysis = await submitAnalysis(await getVideoInputUrl(id));
  const video: StoredVideo = {
    id,
    title,
    metadata,
    narrationStyle,
    operationLocation: analysis.operationLocation,
    videoUrl: `/api/videos/${encodeURIComponent(id)}/content`,
    status: "uploaded",
    descriptions: [],
    audioGenerated: 0,
  };
  await saveVideo(video);
};

export const updateDescriptions = async (id: string, descriptions: Segment[]): Promise<void> => {
  const video = await getStoredVideo(id);
  video.status = "processing";
  video.descriptions = descriptions;
  video.error = undefined;
  try {
    await generateAudio(video);
    await saveDescriptions(id, descriptions);
    video.status = "ready";
    video.stage = undefined;
    await saveVideo(video);
  } catch (error) {
    video.status = "failed";
    video.stage = undefined;
    video.error = errorMessage(error);
    await saveVideo(video);
    throw error;
  }
};
