import { BlockBlobClient, type BlockBlobParallelUploadOptions } from "@azure/storage-blob";
import type {
    CreateVideoResult,
    Segment,
    VideoResource,
    VideoSummary,
} from "./Models";

const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
    }
    const body = await response.text();
    return body ? JSON.parse(body) as T : undefined as T;
};

export const getVideos = (): Promise<VideoSummary[]> => request("/api/videos");

export const createVideo = (
    title: string,
    metadata: string,
    narrationStyle: string,
): Promise<CreateVideoResult> =>
    request("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, metadata, narrationStyle }),
    });

export const uploadVideo = async (
    uploadUrl: string,
    file: File,
    setUploadPercentage: (percentage: number) => void,
): Promise<void> => {
    const options: BlockBlobParallelUploadOptions = {
        blockSize: 4 * 1024 * 1024,
        maxSingleShotSize: 0,
        blobHTTPHeaders: { blobContentType: file.type || "video/mp4" },
        onProgress: ({ loadedBytes }) =>
            setUploadPercentage(Math.round(loadedBytes / file.size * 100)),
    };
    await new BlockBlobClient(uploadUrl).uploadData(file, options);
};

export const completeVideoUpload = (
    id: string,
    title: string,
    metadata: string,
    narrationStyle: string,
): Promise<VideoResource> =>
    request(`/api/videos/${encodeURIComponent(id)}/upload-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, metadata, narrationStyle }),
    });

export const getVideo = (id: string): Promise<VideoResource> =>
    request(`/api/videos/${encodeURIComponent(id)}`);

export const startVideoProcessing = (id: string): Promise<void> =>
    request(`/api/videos/${encodeURIComponent(id)}/process`, { method: "POST" });

export const updateVideoDescriptions = (
    id: string,
    descriptions: Segment[],
): Promise<VideoResource> =>
    request(`/api/videos/${encodeURIComponent(id)}/descriptions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptions }),
    });

export const deleteVideo = (id: string): Promise<void> =>
    request(`/api/videos/${encodeURIComponent(id)}`, { method: "DELETE" });
