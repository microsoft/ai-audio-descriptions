import type {
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

export const uploadVideo = (
    title: string,
    file: File,
    setUploadPercentage: (percentage: number) => void,
): Promise<VideoResource> =>
    new Promise((resolve, reject) => {
        const data = new FormData();
        data.append("title", title);
        data.append("video", file);

        const upload = new XMLHttpRequest();
        upload.open("POST", "/api/videos");
        upload.responseType = "json";
        upload.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                setUploadPercentage(
                    Math.round(event.loaded / event.total * 100),
                );
            }
        };
        upload.onload = () => {
            if (upload.status >= 200 && upload.status < 300) {
                resolve(upload.response as VideoResource);
                return;
            }
            const body = upload.response as { error?: string } | null;
            reject(new Error(body?.error ?? `Upload failed with status ${upload.status}.`));
        };
        upload.onerror = () => reject(new Error("Upload failed."));
        upload.send(data);
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

export const renderVideo = async (id: string): Promise<Blob> => {
    const response = await fetch(`/api/videos/${encodeURIComponent(id)}/render`, {
        method: "POST",
    });
    if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
    }
    return response.blob();
};

export const deleteVideo = (id: string): Promise<void> =>
    request(`/api/videos/${encodeURIComponent(id)}`, { method: "DELETE" });
