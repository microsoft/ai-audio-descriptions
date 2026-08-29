import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { credential } from "./azure";
import { config } from "./config";
import type { StoredVideo, VideoResource, VideoSummary } from "./types";

const blobServiceClient = new BlobServiceClient(
  `https://${config.storageAccount}.blob.core.windows.net`,
  credential,
);
const containerClient = blobServiceClient.getContainerClient(config.containerName);

const detailsBlobName = (id: string) => `${id}/details.json`;
const videoBlobName = (id: string) => `${id}/${id}.mp4`;
const descriptionsBlobName = (id: string) => `${id}/${id}.json`;
const audioBlobName = (id: string, index: number) => `${id}/${id}_${index}.wav`;
let cachedDelegationKey:
  | { key: UserDelegationKey; startsOn: Date; expiresOn: Date }
  | undefined;

const readJson = async <T>(blobName: string): Promise<T> => {
  const buffer = await containerClient.getBlockBlobClient(blobName).downloadToBuffer();
  return JSON.parse(buffer.toString("utf8")) as T;
};

const blobExists = (blobName: string): Promise<boolean> =>
  containerClient.getBlockBlobClient(blobName).exists();

const getDelegationKey = async (): Promise<{
  key: UserDelegationKey;
  startsOn: Date;
}> => {
  if (
    cachedDelegationKey
    && cachedDelegationKey.expiresOn.getTime() > Date.now() + 9 * 60 * 60 * 1000
  ) {
    return cachedDelegationKey;
  }
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const key = await blobServiceClient.getUserDelegationKey(startsOn, expiresOn);
  cachedDelegationKey = { key, startsOn, expiresOn };
  return cachedDelegationKey;
};

const createBlobUrl = (
  blobName: string,
  permissions: string,
  startsOn: Date,
  expiresOn: Date,
  delegationKey: UserDelegationKey,
): string => {
  const sas = generateBlobSASQueryParameters(
    {
      containerName: config.containerName,
      blobName,
      permissions: BlobSASPermissions.parse(permissions),
      protocol: SASProtocol.Https,
      startsOn,
      expiresOn,
    },
    delegationKey,
    config.storageAccount,
  );
  return `${containerClient.getBlockBlobClient(blobName).url}?${sas}`;
};

export const createVideo = async (
  title: string,
  metadata: string,
  narrationStyle: string,
): Promise<{ video: VideoResource; uploadUrl: string }> => {
  const video: StoredVideo = {
    id: title,
    title,
    metadata,
    narrationStyle,
    status: "uploaded",
    descriptions: [],
    audioGenerated: 0,
  };
  const expiresOn = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const { key, startsOn } = await getDelegationKey();
  return {
    video: toVideoResource(video),
    uploadUrl: createBlobUrl(videoBlobName(title), "cw", startsOn, expiresOn, key),
  };
};

export const saveVideo = async (video: StoredVideo): Promise<void> => {
  const details = {
    title: video.title,
    metadata: video.metadata,
    narrationStyle: video.narrationStyle,
    operationLocation: video.operationLocation,
    videoUrl: video.videoUrl,
    status: video.status,
    stage: video.stage,
    error: video.error,
    audioGenerated: video.audioGenerated,
  };
  await containerClient
    .getBlockBlobClient(detailsBlobName(video.id))
    .uploadData(Buffer.from(JSON.stringify(details)), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
};

export const saveDescriptions = async (
  id: string,
  descriptions: StoredVideo["descriptions"],
): Promise<void> => {
  await containerClient
    .getBlockBlobClient(descriptionsBlobName(id))
    .uploadData(Buffer.from(JSON.stringify(descriptions)), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
};

export const getStoredVideo = async (id: string): Promise<StoredVideo> => {
  const hasDetails = await blobExists(detailsBlobName(id));
  const hasDescriptions = await blobExists(descriptionsBlobName(id));
  const details = hasDetails
    ? await readJson<Partial<StoredVideo>>(detailsBlobName(id))
    : {};
  const descriptions = hasDescriptions
    ? await readJson<StoredVideo["descriptions"]>(descriptionsBlobName(id))
    : [];
  return {
    id,
    title: details.title ?? id,
    metadata: details.metadata ?? "",
    narrationStyle: details.narrationStyle ?? "",
    operationLocation: details.operationLocation,
    videoUrl: details.videoUrl,
    status: details.status ?? (hasDescriptions ? "ready" : "uploaded"),
    stage: details.stage,
    error: details.error,
    descriptions,
    audioGenerated: details.audioGenerated ?? descriptions.length,
  };
};

export const listVideos = async (): Promise<VideoSummary[]> => {
  const ids = new Set<string>();
  for await (const blob of containerClient.listBlobsFlat()) {
    const parts = blob.name.split("/");
    if (parts.length === 2 && parts[1] === `${parts[0]}.mp4`) {
      ids.add(parts[0]);
    }
  }
  const videos = await Promise.all(
    [...ids].map(async (id) => {
      const video = await getStoredVideo(id);
      return { id, title: video.title, status: video.status };
    }),
  );
  return videos.sort((left, right) => left.title.localeCompare(right.title));
};

export const getVideo = async (id: string): Promise<VideoResource> =>
  toVideoResource(await getStoredVideo(id));

const toVideoResource = (video: StoredVideo): VideoResource => ({
  ...video,
  videoUrl: `/api/videos/${encodeURIComponent(video.id)}/content`,
  audioUrls: video.descriptions.map(
    (_, index) => `/api/videos/${encodeURIComponent(video.id)}/audio/${index}`,
  ),
});

export const getVideoInputUrl = async (id: string): Promise<string> => {
  const expiresOn = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const { key, startsOn } = await getDelegationKey();
  return createBlobUrl(videoBlobName(id), "r", startsOn, expiresOn, key);
};

export const getVideoContentUrl = async (id: string): Promise<string> => {
  const expiresOn = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const { key, startsOn } = await getDelegationKey();
  return createBlobUrl(videoBlobName(id), "r", startsOn, expiresOn, key);
};

export const getAudioContentUrl = async (
  id: string,
  index: number,
): Promise<string> => {
  const expiresOn = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const { key, startsOn } = await getDelegationKey();
  return createBlobUrl(audioBlobName(id, index), "r", startsOn, expiresOn, key);
};

export const downloadVideo = async (
  id: string,
  destinationPath: string,
): Promise<void> => {
  await containerClient
    .getBlockBlobClient(videoBlobName(id))
    .downloadToFile(destinationPath);
};

export const downloadAudio = async (
  id: string,
  index: number,
  destinationPath: string,
): Promise<void> => {
  await containerClient
    .getBlockBlobClient(audioBlobName(id, index))
    .downloadToFile(destinationPath);
};

export const videoExists = async (id: string): Promise<boolean> =>
  blobExists(videoBlobName(id));

export const uploadAudio = async (
  id: string,
  index: number,
  audio: ArrayBuffer,
): Promise<void> => {
  await containerClient.getBlockBlobClient(audioBlobName(id, index)).uploadData(
    Buffer.from(audio),
    { blobHTTPHeaders: { blobContentType: "audio/wav" } },
  );
};

export const deleteVideo = async (id: string): Promise<void> => {
  for await (const blob of containerClient.listBlobsFlat({ prefix: `${id}/` })) {
    await containerClient.deleteBlob(blob.name);
  }
};
