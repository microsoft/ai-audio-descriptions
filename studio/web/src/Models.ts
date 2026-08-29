export interface VideoPlayerProps {
    scenes: Segment[];
    setScenes: any;
    lastReadTime: number;
    setLastReadTime: any;
    allVideos: VideoSummary[];
    videoPlaying: boolean;
    setVideoPlaying: any;
    descriptionAvailable: boolean;
    setDescriptionAvailable: any;
    title: string;
    setTitle: any;
    setVideoId: any;
    videoListLoading: boolean;
    audioObjects: HTMLAudioElement[];
    setAudioObjects: any;
    onVideoDeleted: () => void;
}

export interface DescriptionTableProps {
    scenes: Segment[];
    setScenes: any;
    descriptionAvailable: boolean;
    setDescriptionAvailable: any;
    videoId: string;
    setAudioObjects: any;
}

export interface UploadDialogProps {
    videos: VideoSummary[];
    onVideoUploadCancelled: () => void;
    onVideoUploaded: (video: VideoResource) => void
    title: string;
    setTitle: any;
}

export interface ProcessVideoDialogProps {
    setOpenProcessDialog: any;
    video: VideoResource;
    setScenes: any;
    setAudioObjects: any;
    setDescriptionAvailable: any;
    setVideoUrl: any;
    shouldContinueWithoutAsking: boolean;
    onVideoChanged: (video: VideoResource) => void;
}

export type VideoStatus = "uploaded" | "processing" | "ready" | "failed";
export type ProcessingStage =
    | "preparing"
    | "transcribing"
    | "detecting_shots"
    | "describing"
    | "writing_vtt"
    | "synthesizing";

export interface VideoSummary {
    id: string;
    title: string;
    status: VideoStatus;
}

export interface VideoResource extends VideoSummary {
    videoUrl: string;
    audioUrls: string[];
    descriptions: Segment[];
    audioGenerated: number;
    stage?: ProcessingStage;
    error?: string;
}

export interface Segment {
    startTime: string;
    endTime: string;
    description: string;
}