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
    onVideoDeleted: () => void;
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
    videos: SavedVideoResult[];
    onVideoUploadCancelled: () => void;
    onVideoUploaded: (blobPrefix: string) => void
    onVideoTaskCreated: (taskInfo: VideoDetails) => void
    title: string;
    setTitle: any;
}

export interface ProcessVideoDialogProps {
    setOpenProcessDialog: any;
    videoDetails: VideoDetails
    setScenes: any;
    setAudioObjects: any;
    setDescriptionAvailable: any;
    setVideoUrl: any;
    scenes: Segment[];
    shouldContinueWithoutAsking: boolean;
    onVideoProcessed: (blobPrefix: string) => void;
}

export interface VideoDetails {
    title: string;
    metadata: string;
    narrationStyle: string;
    videoUrl: string;
    taskId: string;
    analyzerId: string;
}

export interface SavedVideoResult {
    prefix: string;
    videoUrl: string;
    audioDescriptionJsonUrl: string;
    detailsJsonUrl: string;
}

export interface Segment {
    startTime: string;
    endTime: string;
    description: string;
}