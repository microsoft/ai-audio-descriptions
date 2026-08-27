import type { Segment } from "../src/Models";

export type VideoStatus = "uploaded" | "processing" | "ready" | "failed";
export type ProcessingStage = "analyzing" | "describing" | "synthesizing";

export interface StoredVideo {
  id: string;
  title: string;
  metadata: string;
  narrationStyle: string;
  operationLocation?: string;
  videoUrl?: string;
  status: VideoStatus;
  stage?: ProcessingStage;
  error?: string;
  descriptions: Segment[];
  audioGenerated: number;
}

export interface VideoSummary {
  id: string;
  title: string;
  status: VideoStatus;
}

export interface VideoResource extends VideoSummary {
  metadata: string;
  narrationStyle: string;
  stage?: ProcessingStage;
  error?: string;
  descriptions: Segment[];
  audioGenerated: number;
  videoUrl: string;
  audioUrls: string[];
}
