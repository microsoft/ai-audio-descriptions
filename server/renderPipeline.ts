import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg";
import {
  downloadAudio,
  downloadVideo,
  getStoredVideo,
} from "./storage";

export interface RenderedVideo {
  fileName: string;
  path: string;
  cleanup: () => Promise<void>;
}

const timeToMilliseconds = (time: string): number => {
  const parts = time.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid description start time: ${time}`);
  }
  return Math.round(((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000);
};

export const renderVideo = async (id: string): Promise<RenderedVideo> => {
  const video = await getStoredVideo(id);
  if (video.descriptions.length === 0) {
    throw new Error("The video has no audio descriptions to render.");
  }

  const directory = await mkdtemp(path.join(tmpdir(), "aiad-render-"));
  const inputPath = path.join(directory, "video.mp4");
  const outputPath = path.join(directory, "output.mp4");
  const audioPaths = video.descriptions.map(
    (_, index) => path.join(directory, `audio_${index}.wav`),
  );

  try {
    await Promise.all([
      downloadVideo(id, inputPath),
      ...audioPaths.map((audioPath, index) => downloadAudio(id, index, audioPath)),
    ]);

    const args = ["-y", "-i", inputPath];
    for (const audioPath of audioPaths) {
      args.push("-i", audioPath);
    }

    const delayedAudio = video.descriptions.map((description, index) => {
      const delay = timeToMilliseconds(description.startTime);
      return `[${index + 1}:a]adelay=${delay}|${delay}[a${index}]`;
    });
    const mixedInputs = [
      "[0:a]",
      ...video.descriptions.map((_, index) => `[a${index}]`),
    ].join("");
    const filter = [
      ...delayedAudio,
      `${mixedInputs}amix=inputs=${video.descriptions.length + 1}[mixed]`,
    ].join(";");

    args.push(
      "-filter_complex",
      filter,
      "-map",
      "0:v?",
      "-map",
      "[mixed]",
      "-c:v",
      "copy",
      outputPath,
    );
    await runFfmpeg(args);

    return {
      fileName: `${video.title}_output.mp4`,
      path: outputPath,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
