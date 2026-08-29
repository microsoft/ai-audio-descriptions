import { spawn } from "node:child_process";

const ffmpegExecutable = process.env.FFMPEG_PATH ?? "ffmpeg";

export const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const process = spawn(ffmpegExecutable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";

    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (data: string) => {
      stderr = (stderr + data).slice(-16_000);
    });
    process.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          `FFmpeg was not found. Install it on the server or set FFMPEG_PATH. Tried: ${ffmpegExecutable}`,
        ));
        return;
      }
      reject(error);
    });
    process.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg exited with code ${code}.${stderr ? `\n${stderr}` : ""}`));
    });
  });
