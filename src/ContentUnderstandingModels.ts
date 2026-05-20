// Response shape for the Content Understanding GA API (2025-11-01),
// specifically the `prebuilt-videoSearch` analyzer.
//
// Reference: https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/video/overview
// Reference: SDK sample
//   https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/contentunderstanding/ai-content-understanding/samples/v1/typescript/src/analyzeUrl.ts

export interface Field {
  type: string;
  value?: string;
  valueString?: string;
}

// Per-segment content. `prebuilt-videoSearch` returns items with kind "audioVisual".
// Each segment contains a markdown block (description + embedded WEBVTT transcript
// + key-frame references) plus structured fields like `Summary`.
export interface AudioVisualContent {
  kind: "audioVisual";
  markdown: string;
  startTimeMs: number;
  endTimeMs: number;
  width?: number;
  height?: number;
  fields?: Record<string, Field>;
}

export type AnalyzerContent = AudioVisualContent;

export interface AnalyzerResult {
  analyzerId: string;
  apiVersion: string;
  createdAt: string;
  warnings: unknown[];
  contents: AnalyzerContent[];
}

// Top-level shape of a GET on `/analyzerResults/{id}`.
export interface AnalyzerResults {
  id: string;
  status: "NotStarted" | "Running" | "Succeeded" | "Failed";
  error?: { code?: string; message?: string };
  result?: AnalyzerResult;
}
