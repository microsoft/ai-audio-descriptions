export interface TranscriptPhrase {
  speaker: string;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  confidence: number;
  words: string[];
  locale: string;
}

export interface Content {
  markdown: string;
  fields: {
    description: {
      type: string;
      valueString: string;
    };
  };
  kind: string;
  startTimeMs: number;
  endTimeMs: number;
  width: number;
  height: number;
  transcriptPhrases: TranscriptPhrase[];
  faces: any[];
}

export interface Result {
  analyzerId: string;
  apiVersion: string;
  createdAt: string;
  warnings: any[];
  contents: Content[];
}

export interface ContentUnderstandingResults {
  id: string;
  status: string;
  result: Result;
}