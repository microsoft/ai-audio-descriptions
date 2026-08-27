import React, { useEffect } from "react";
import {
    Button,
    Dialog,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    ProgressBar,
} from "@fluentui/react-components";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { deleteVideo, getVideo } from "./api";
import DeleteVideoDialog from "./DeleteVideoDialog";
import { timeToSeconds } from "./helpers/Helper";
import { loadAudioFilesIntoMemory } from "./helpers/TtsHelper";
import {
    Segment,
    VideoPlayerProps,
    VideoResource,
    VideoSummary,
} from "./Models";
import { ProcessVideoDialog } from "./ProcessVideoDialog";
import { UploadVideoDialog } from "./UploadVideoDialog";

export const VideoPlayer: React.FC<VideoPlayerProps> = (props) => {
    const {
        setAudioObjects,
        setDescriptionAvailable,
        setLastReadTime,
        setScenes,
        setVideoPlaying,
    } = props;
    const [openUploadDialog, setOpenUploadDialog] = React.useState(false);
    const [openProcessVideoDialog, setOpenProcessVideoDialog] = React.useState(false);
    const [currentDescription, setCurrentDescription] = React.useState("");
    const [videoPlayerReady, setVideoPlayerReady] = React.useState(false);
    const [currentAudio, setCurrentAudio] = React.useState<HTMLAudioElement>();
    const [isAudioOrVideoPlaying, setIsAudioOrVideoPlaying] = React.useState<boolean>();
    const [videoUrl, setVideoUrl] = React.useState("");
    const [isPreparingForDownload, setIsPreparingForDownload] = React.useState(false);
    const [selectedVideo, setSelectedVideo] = React.useState<VideoSummary>();
    const [processingVideo, setProcessingVideo] = React.useState<VideoResource>();
    const [continueWithoutAsking, setContinueWithoutAsking] = React.useState(false);
    const [videos, setVideos] = React.useState<VideoSummary[]>([]);

    const ffmpeg = new FFmpeg();
    const playerRef = React.useRef<HTMLVideoElement>(null);

    const resetState = React.useCallback(() => {
        setScenes([]);
        setAudioObjects([]);
        setVideoPlaying(false);
        setDescriptionAvailable(false);
        setLastReadTime(-1);
        setVideoUrl("");
        setIsAudioOrVideoPlaying(false);
        setVideoPlayerReady(false);
        setCurrentDescription("");
        setIsPreparingForDownload(false);
        setSelectedVideo(undefined);
    }, [
        setAudioObjects,
        setDescriptionAvailable,
        setLastReadTime,
        setScenes,
        setVideoPlaying,
    ]);

    useEffect(() => {
        resetState();
        setVideos(props.allVideos);
    }, [props.allVideos, resetState]);

    const handlePlayClick = () => {
        props.setVideoPlaying(true);
        setIsAudioOrVideoPlaying(true);
    };

    const handlePauseClick = () => {
        props.setVideoPlaying(false);
        setIsAudioOrVideoPlaying(false);
        currentAudio?.pause();
    };

    const { videoPlaying } = props;
    useEffect(() => {
        const video = playerRef.current;
        if (!video) {
            return;
        }
        if (videoPlaying) {
            void video.play().catch(() => {
                setVideoPlaying(false);
                setIsAudioOrVideoPlaying(false);
            });
        } else {
            video.pause();
        }
    }, [videoPlaying, setVideoPlaying]);

    const handleStopClick = () => {
        if (playerRef.current) {
            playerRef.current.currentTime = 0;
            handlePauseClick();
            props.setLastReadTime(-1);
            setCurrentDescription("");
        }
    };

    const loadReadyVideo = async (video: VideoResource) => {
        setVideoUrl(video.videoUrl);
        props.setScenes(video.descriptions);
        props.setDescriptionAvailable(true);
        await loadAudioFilesIntoMemory(video.audioUrls, props.setAudioObjects);
    };

    const loadVideoFromList = async (summary: VideoSummary) => {
        const video = await getVideo(summary.id);
        resetState();
        props.setTitle(video.title);
        props.setVideoId(video.id);
        setSelectedVideo(summary);
        setVideoUrl(video.videoUrl);
        if (video.status === "ready") {
            await loadReadyVideo(video);
            return;
        }
        setProcessingVideo(video);
        setContinueWithoutAsking(false);
        setOpenProcessVideoDialog(true);
    };

    const download = async () => {
        setIsPreparingForDownload(true);
        const baseUrl = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript"),
            wasmURL: await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, "application/wasm"),
        });
        const ffmpegParams = [];
        await ffmpeg.writeFile("video.mp4", await fetchFile(videoUrl));
        ffmpegParams.push("-i", "video.mp4");

        const fetchedFiles = await Promise.all(
            props.audioObjects.map(audio => fetchFile(audio.src)),
        );
        await Promise.all(fetchedFiles.map((audio, index) => {
            ffmpegParams.push("-i", `audio_${index}.wav`);
            return ffmpeg.writeFile(`audio_${index}.wav`, audio);
        }));

        let delayedAudio = "";
        let mixedAudio = "[0]";
        props.scenes.forEach((scene, index) => {
            const delayMs = timeToSeconds(scene.startTime) * 1000;
            delayedAudio += `[${index + 1}]adelay=${delayMs}|${delayMs}[a${index}];`;
            mixedAudio += `[a${index}]`;
        });
        mixedAudio += `amix=${props.scenes.length + 1}`;

        ffmpegParams.push("-filter_complex", delayedAudio + mixedAudio);
        ffmpegParams.push("-c:v", "copy", "output.mp4");
        await ffmpeg.exec(ffmpegParams);

        try {
            const data = await ffmpeg.readFile("output.mp4");
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([data as BlobPart], { type: "video/mp4" }));
            link.download = `${props.title}_output.mp4`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } finally {
            setIsPreparingForDownload(false);
        }
    };

    const readDescription = (scenes: Segment[]) => {
        const currentTime = playerRef.current!.currentTime;
        for (let index = 0; index < scenes.length; index++) {
            const scene = scenes[index];
            if (
                currentTime >= timeToSeconds(scene.startTime)
                && currentTime <= timeToSeconds(scene.endTime)
            ) {
                setCurrentDescription(scene.description);
                if (props.descriptionAvailable) {
                    void props.audioObjects[index].play();
                    setIsAudioOrVideoPlaying(true);
                    setCurrentAudio(props.audioObjects[index]);
                }
            }
        }
    };

    const onProgress = (event: React.SyntheticEvent<HTMLVideoElement>) => {
        if (!props.videoPlaying) {
            return;
        }
        const currentTime = event.currentTarget.currentTime;
        const activeScene = props.scenes.find(scene =>
            currentTime >= timeToSeconds(scene.startTime)
            && currentTime <= timeToSeconds(scene.endTime));
        if (!activeScene) {
            return;
        }
        const descriptionTime = timeToSeconds(activeScene.startTime);
        if (descriptionTime - props.lastReadTime > 0.1) {
            props.setLastReadTime(descriptionTime);
            readDescription(props.scenes);
        }
    };

    const handleDeleteVideo = async (id: string) => {
        resetState();
        await deleteVideo(id);
        props.onVideoDeleted();
    };

    const updateVideoSummary = (video: VideoResource) => {
        const summary = { id: video.id, title: video.title, status: video.status };
        setVideos(current => {
            const remaining = current.filter(item => item.id !== video.id);
            return [...remaining, summary].sort((left, right) => left.title.localeCompare(right.title));
        });
        setSelectedVideo(summary);
    };

    const handleVideoUploaded = (video: VideoResource) => {
        props.setTitle(video.title);
        props.setVideoId(video.id);
        setVideoUrl(video.videoUrl);
        setProcessingVideo(video);
        updateVideoSummary(video);
        setContinueWithoutAsking(true);
        setOpenUploadDialog(false);
        setOpenProcessVideoDialog(true);
    };

    const handleVideoChanged = (video: VideoResource) => {
        updateVideoSummary(video);
        setProcessingVideo(video);
        setContinueWithoutAsking(false);
    };

    const displayWidth = window.innerWidth
        || document.documentElement.clientWidth
        || document.body.clientWidth;
    const playerWidth = displayWidth > 1000 ? "640px" : "90vw";
    const playerHeight = displayWidth > 1000 ? "360px" : "70vw";

    return (
        <>
            {openUploadDialog && (
                <UploadVideoDialog
                    videos={videos}
                    onVideoUploadCancelled={() => setOpenUploadDialog(false)}
                    onVideoUploaded={handleVideoUploaded}
                    title={props.title}
                    setTitle={props.setTitle} />
            )}
            {openProcessVideoDialog && processingVideo && (
                <ProcessVideoDialog
                    video={processingVideo}
                    setScenes={props.setScenes}
                    setAudioObjects={props.setAudioObjects}
                    setDescriptionAvailable={props.setDescriptionAvailable}
                    setVideoUrl={setVideoUrl}
                    onVideoChanged={handleVideoChanged}
                    setOpenProcessDialog={setOpenProcessVideoDialog}
                    shouldContinueWithoutAsking={continueWithoutAsking} />
            )}
            <Dialog open={isPreparingForDownload} modalType="modal">
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Downloading...</DialogTitle>
                        <DialogContent>
                            <div style={{ marginTop: "20px" }}>
                                <ProgressBar />
                            </div>
                        </DialogContent>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
            <h2>Upload a new video</h2>
            <Button appearance="primary" onClick={() => setOpenUploadDialog(true)}>Upload</Button>
            <div>
                <h2>Select a video from the list</h2>
                {props.videoListLoading
                    ? (
                        <div style={{ maxWidth: "20vw" }}>
                            <Field validationMessage="Loading..." validationState="none">
                                <ProgressBar />
                            </Field>
                        </div>
                    )
                    : videos.length === 0
                        ? <p>No videos available.</p>
                        : (
                            <ul>
                                {videos.map(video => (
                                    <li key={video.id}>
                                        <button className="button-link" onClick={() => loadVideoFromList(video)}>
                                            {video.title}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
            </div>
            <div className="video-player">
                <h2>Video Player</h2>
                <div className="player-button-group">
                    <div className="player-button">
                        <Button
                            appearance="primary"
                            onClick={isAudioOrVideoPlaying ? handlePauseClick : handlePlayClick}
                            disabled={!videoPlayerReady}>
                            Play/Pause
                        </Button>
                    </div>
                    <div className="player-button">
                        <Button
                            appearance="primary"
                            onClick={download}
                            disabled={props.scenes.length === 0}>
                            Download
                        </Button>
                    </div>
                    {selectedVideo && selectedVideo.status !== "processing" && (
                        <DeleteVideoDialog
                            video={selectedVideo}
                            onVideoDelete={handleDeleteVideo} />
                    )}
                </div>
                <video
                    ref={playerRef}
                    src={videoUrl}
                    style={{ width: playerWidth, height: playerHeight }}
                    playsInline
                    preload="metadata"
                    onTimeUpdate={onProgress}
                    onEnded={handleStopClick}
                    onCanPlay={() => setVideoPlayerReady(true)}
                />
                <p>{currentDescription}</p>
            </div>
        </>
    );
};
