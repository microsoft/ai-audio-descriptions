import React, { useEffect } from "react";
import ReactPlayer from "react-player";
import { SavedVideoResult, Segment, VideoDetails, VideoPlayerProps } from "./Models";
import { OnProgressProps } from "react-player/base";
import axios from "axios";
import { timeToSeconds } from "./helpers/Helper";
import { UploadVideoDialog } from "./UploadVideoDialog";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, ProgressBar } from "@fluentui/react-components";
import { loadAudioFilesIntoMemory } from "./helpers/TtsHelper";
import { ProcessVideoDialog } from "./ProcessVideoDialog";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { blobSasToken, blobUri, STORAGE_CONTAINER_NAME } from "./keys";
import { deleteBlobWithPrefix, getUploadedVideos } from "./helpers/BlobHelper";
import DeleteVideoDialog from "./DeleteVideoDialog";

export const VideoPlayer: React.FC<VideoPlayerProps> = (props: VideoPlayerProps) => {
    const [openUploadDialog, setOpenUploadDialog] = React.useState(false);
    const [openProcessVideoDialog, setOpenProcessVideoDialog] = React.useState(false);
    const [currentDescription, setCurrentDescription] = React.useState('');
    const playPauseString = 'Play/Pause';
    const [videoPlayerReady, setVideoPlayerReady] = React.useState(false);
    const [currentAudio, setCurrentAudio] = React.useState<HTMLAudioElement>();
    const [isAudioOrVideoPlaying, setIsAudioOrVideoPlaying] = React.useState<boolean>();
    const [videoUploaded, setVideoUploaded] = React.useState(false);
    const [taskId, setTaskId] = React.useState<string>("");
    const [analyzerId, setAnalyzerId] = React.useState<string>("");
    const [metadata, setMetadata] = React.useState("");
    const [narrationStyle, setNarrationStyle] = React.useState("");
    const [videoUrl, setVideoUrl] = React.useState("");
    const [isPreparingForDownload, setIsPreparingForDownload] = React.useState(false);
    const [selectedVideo, setSelectedVideo] = React.useState<SavedVideoResult>();
    const [videos, setVideos] = React.useState<SavedVideoResult[]>([]);

    const ffmpeg = new FFmpeg();

    const resetState = () => {
        props.setScenes([]);
        props.setAudioObjects([]);
        props.setVideoPlaying(false);
        props.setDescriptionAvailable(false);
        props.setLastReadTime(-1);
        setVideoUrl('');
        setIsAudioOrVideoPlaying(false);
        setVideoPlayerReady(false);
        setCurrentDescription('');
        setIsPreparingForDownload(false);
        setSelectedVideo(undefined);
    }

    useEffect(() => {
        resetState();
        setVideos(props.allVideos);
    }, [props.allVideos]
    );

    const handlePlayClick = () => {
        props.setVideoPlaying(true);
        setIsAudioOrVideoPlaying(true);
    }

    const handlePauseClick = () => {
        props.setVideoPlaying(false);
        setIsAudioOrVideoPlaying(false);
        currentAudio?.pause();
    }

    const playPauseHandler = isAudioOrVideoPlaying ? handlePauseClick : handlePlayClick;

    const playerRef = React.useRef<ReactPlayer>(null);

    const handleStopClick = () => {
        if (playerRef.current) {
            playerRef.current.seekTo(0);
            handlePauseClick();
            props.setLastReadTime(-1);
            setCurrentDescription('');
        }
    };

    const handleOnReady = () => {
        setVideoPlayerReady(true);
    }

    const loadVideoFromList = async (selectedVideo: SavedVideoResult) => {
        if (selectedVideo.videoUrl === videoUrl) {
            return;
        }
        resetState();
        const title = selectedVideo.videoUrl.split('?')[0].split('/')[selectedVideo.videoUrl.split('?')[0].split('/').length - 1].split('.')[0];
        props.setTitle(title);
        setVideoUrl(selectedVideo.videoUrl);
        setSelectedVideo(selectedVideo);
        if (selectedVideo.audioDescriptionJsonUrl !== '') {
            setVideoUrl(selectedVideo.videoUrl);
            const jsonResult = await axios.get(selectedVideo.audioDescriptionJsonUrl);
            const audioDescriptions: any = jsonResult.data;
            props.setScenes(audioDescriptions);
            props.setDescriptionAvailable(true);
            await loadAudioFilesIntoMemory(title, audioDescriptions, props.setAudioObjects);
        }
        else {
            const videoDetails: VideoDetails = (await axios.get(selectedVideo.detailsJsonUrl)).data;
            setTaskId(videoDetails.taskId);
            setAnalyzerId(videoDetails.analyzerId);
            setVideoUrl(videoDetails.videoUrl);
            setMetadata(videoDetails.metadata);
            setNarrationStyle(videoDetails.narrationStyle);
            setOpenUploadDialog(false);
            setVideoUploaded(false);
            setOpenProcessVideoDialog(true);
        }
    }

    const download = async () => {
        setIsPreparingForDownload(true);
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        const ffmpegParams = [];
        await ffmpeg.writeFile('video.mp4', await fetchFile(videoUrl));
        ffmpegParams.push("-i", "video.mp4");

        const fetchFilePromises = props.scenes.map((_, i) => fetchFile(`${blobUri}/${STORAGE_CONTAINER_NAME}/${props.title}/${props.title}_${i}.wav?${blobSasToken}`));
        const fetchedFiles = await Promise.all(fetchFilePromises);
        const ffmpegWriteAudioPromises = props.scenes.map((_, i) => {
            ffmpegParams.push("-i", `audio_${i}.wav`);
            return ffmpeg.writeFile(`audio_${i}.wav`, fetchedFiles[i])
        });
        await Promise.all(ffmpegWriteAudioPromises);

        let filterComplexPart1 = "";
        let filterComplexPart2 = "[0]";
        props.scenes.forEach((scene, i) => {
            const delayMs = timeToSeconds(scene.startTime) * 1000;
            filterComplexPart1 += `[${i + 1}]adelay=${delayMs}|${delayMs}[a${i}];`;
            filterComplexPart2 += `[a${i}]`;
        });
        filterComplexPart2 += `amix=${props.scenes.length + 1}`;

        ffmpegParams.push("-filter_complex", filterComplexPart1 + filterComplexPart2);
        ffmpegParams.push("-c:v", "copy", `output.mp4`);
        await ffmpeg.exec(ffmpegParams);

        try {
            const data = await ffmpeg.readFile('output.mp4');
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
            link.download = props.title + "_output.mp4"
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        catch (e) {
            console.log(e);
        }
        finally {
            setIsPreparingForDownload(false);
        }
    }

    const readDescription = async (scenes: Segment[]) => {
        const currentTime = playerRef.current!.getCurrentTime();
        if (scenes.length > 0) {
            for (let i = 0; i < scenes.length; i++) {
                const startTime = timeToSeconds(scenes[i].startTime);
                const endTime = timeToSeconds(scenes[i].endTime);
                if (currentTime >= startTime && currentTime <= endTime) {
                    const scene = scenes[i];
                    setCurrentDescription(scene.description);
                    if (props.descriptionAvailable) {
                        props.audioObjects[i].play();
                        setIsAudioOrVideoPlaying(true);
                        setCurrentAudio(props.audioObjects[i]);
                    }
                    console.log(scene.description);
                }
            }
        }
    }

    const displayWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    const playerWidth = displayWidth > 1000 ? '640px' : '90vw';
    const playerHeight = displayWidth > 1000 ? '360px' : '70vw';

    const onProgress = (state: OnProgressProps) => {
        if (!props.videoPlaying) {
            return;
        }
        const currentTime = state.playedSeconds;
        let descriptionTime = 0;
        for (let i = 0; i < props.scenes.length; i++) {
            const startTime = timeToSeconds(props.scenes[i].startTime);
            const endTime = timeToSeconds(props.scenes[i].endTime);
            if (currentTime >= startTime && currentTime <= endTime) {
                descriptionTime = startTime;
            }
        }
        if (descriptionTime - props.lastReadTime > 0.1) {
            props.setLastReadTime(descriptionTime);
            readDescription(props.scenes);
        }
    }

    const deleteVideo = async (blobPrefix: string) => {
        resetState();
        await deleteBlobWithPrefix(blobPrefix);
        props.onVideoDeleted();
    }

    const onVideoUploadCancelled = () => {
        setOpenUploadDialog(false);
    }

    const onVideoUploaded = async (blobPrefix: string) => {
        const videoData = await getUploadedVideos({ prefix: blobPrefix });
        if (videoData.length === 1) {
            const newVideos = [...videos];
            const existingVideoIndex = newVideos.findIndex(video => video.prefix === blobPrefix);
            if (existingVideoIndex !== -1) {
                newVideos[existingVideoIndex] = videoData[0];
            } else {
                newVideos.push(videoData[0]);
            }
            setVideos(newVideos);
            setSelectedVideo(videoData[0]);
        }
    }

    const onVideoTaskCreated = (
        taskInfo: VideoDetails) => {
        setTaskId(taskInfo.taskId);
        setAnalyzerId(taskInfo.analyzerId);
        setVideoUrl(taskInfo.videoUrl);
        setMetadata(taskInfo.metadata);
        setNarrationStyle(taskInfo.narrationStyle);
        setOpenUploadDialog(false);
        setVideoUploaded(true);
        setOpenProcessVideoDialog(true);
    }

    return (
        <>
            {openUploadDialog &&
                <UploadVideoDialog
                    videos={videos}
                    onVideoUploadCancelled={onVideoUploadCancelled}
                    onVideoUploaded={onVideoUploaded}
                    onVideoTaskCreated={onVideoTaskCreated}
                    title={props.title}
                    setTitle={props.setTitle} />}
            {openProcessVideoDialog && <ProcessVideoDialog
                videoDetails={{
                    title: props.title,
                    metadata: metadata,
                    narrationStyle: narrationStyle,
                    taskId: taskId,
                    analyzerId: analyzerId,
                    videoUrl: videoUrl
                }}
                setScenes={props.setScenes}
                setAudioObjects={props.setAudioObjects}
                setDescriptionAvailable={props.setDescriptionAvailable}
                setVideoUrl={setVideoUrl}
                onVideoProcessed={onVideoUploaded}
                setOpenProcessDialog={setOpenProcessVideoDialog}
                scenes={props.scenes}
                shouldContinueWithoutAsking={videoUploaded} />}
            <Dialog open={isPreparingForDownload} modalType="modal">
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Downloading...</DialogTitle>
                        <DialogContent>
                            <div style={{ 'marginTop': '20px' }}>
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
                    ? <div style={{ maxWidth: '20vw' }}><Field validationMessage={"Loading..."} validationState="none"><ProgressBar /></Field></div>
                    : videos.length === 0 ? <p>No videos available.</p> : <ul>
                        {videos.map((video, i) => {
                            return <li key={i}>
                                <button className="button-link" onClick={() => loadVideoFromList(video)}>{video.prefix}</button>
                            </li>
                        }
                        )}
                    </ul>}
            </div>
            <div className='video-player'>
                <h2>Video Player</h2>
                <div className='player-button-group'>
                    <div className='player-button'>
                        <Button appearance="primary" onClick={playPauseHandler} disabled={!videoPlayerReady}>{playPauseString}</Button>
                    </div>
                    <div className='player-button'>
                        <Button appearance="primary" onClick={download} disabled={props.scenes.length <= 0}>Download</Button>
                    </div>
                    {selectedVideo &&
                        <div>
                            <DeleteVideoDialog video={selectedVideo} onVideoDelete={deleteVideo} />
                        </div>}
                </div>
                <ReactPlayer width={playerWidth} height={playerHeight} onProgress={onProgress} ref={playerRef} url={videoUrl} playing={props.videoPlaying} onEnded={handleStopClick} onReady={handleOnReady} />
                <p>{currentDescription}</p>
            </div>
        </>
    );
};