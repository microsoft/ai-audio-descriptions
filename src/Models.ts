export interface VideoPlayerProps {
    scenes: Segment[];
    setScenes: any;
    lastReadTime: number;
    setLastReadTime: any;
    allVideos: SavedVideoResult[];
    videoPlaying: boolean;
    setVideoPlaying: any;
    descriptionAvailable: boolean;
    setDescriptionAvailable: any;
    title: string;
    setTitle: any;
    videoListLoading: boolean;
    audioObjects: HTMLAudioElement[];
    setAudioObjects: any;
}

export interface DescriptionTableProps {
    scenes: Segment[];
    setScenes: any;
    descriptionAvailable: boolean;
    setDescriptionAvailable: any;
    title: string;
    setAudioObjects: any;
}

export interface UploadDialogProps {
    openUploadDialog: boolean;
    setOpenUploadDialog: any;
    resetState: any;
    title: string;
    setTitle: any;
    videoUrl: string;
    setVideoUrl: any;
    scenes: Segment[];
    setScenes: any;
    setDescriptionAvailable: any;
    setAudioObjects: any;
    setOpenProcessDialog: any;
    metadata: string;
    setMetadata: any;
    narrationStyle: string;
    setNarrationStyle: any;
    setTaskId: any;
    setVideoUploaded: any;
}

export interface ProcessVideoDialogProps {
    openProcessDialog: boolean;
    setOpenProcessDialog: any;
    title: string;
    metadata: string;
    narrationStyle: string;
    taskId: string;
    videoUrl: string;
    setScenes: any;
    setAudioObjects: any;
    setDescriptionAvailable: any;
    setVideoUrl: any;
    scenes: Segment[];
    shouldContinueWithoutAsking: boolean;
}

export interface VideoAnalysisResult {
    name: string;
    status: string;
    taskResult: any;
}

export interface VideoDetails {
    title: string;
    metadata: string;
    narrationStyle: string;
    taskId: string;
}

export interface SavedVideoResult {
    videoUrl: string;
    audioDescriptionJsonUrl: string;
    detailsJsonUrl: string;
}

export interface Segment {
    startTime: string;
    endTime: string;
    description: string;
}