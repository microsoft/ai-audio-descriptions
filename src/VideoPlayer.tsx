import React from "react";
import ReactPlayer from "react-player";
import { SavedVideoResult, Segment, VideoDetails, VideoPlayerProps } from "./Models";
import { OnProgressProps } from "react-player/base";
import axios from "axios";
import { getVideoName, timeToSeconds } from "./helpers/Helper";
import { UploadVideoDialog } from "./UploadVideoDialog";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, ProgressBar } from "@fluentui/react-components";
import { loadAudioFilesIntoMemory } from "./helpers/TtsHelper";
import { ProcessVideoDialog } from "./ProcessVideoDialog";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { blobSasToken, blobUri } from "./keys";

export const VideoPlayer: React.FC<VideoPlayerProps> = (props: VideoPlayerProps) => {
    const [openUploadDialog, setOpenUploadDialog] = React.useState(false);
    const [openProcessVideoDialog, setOpenProcessVideoDialog] = React.useState(false);
    const [currentDescription, setCurrentDescription] = React.useState('');
    const playPauseString = 'Play/Pause';
    const [videoPlayerReady, setVideoPlayerReady] = React.useState(false);
    const [currentAudio, setCurrentAudio] = React.useState<HTMLAudioElement>();
    const [isAudioOrVideoPlaying, setIsAudioOrVideoPlaying] = React.useState<boolean>();
    const [videoUploaded, setVideoUploaded] = React.useState(false);
    const [taskId, setTaskId] = React.useState("");
    const [metadata, setMetadata] = React.useState("");
    const [narrationStyle, setNarrationStyle] = React.useState("");
    const [videoUrl, setVideoUrl] = React.useState("");
    const [isPreparingForDownload, setIsPreparingForDownload] = React.useState(false);
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
    }

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
            setMetadata(videoDetails.metadata);
            setTaskId(videoDetails.taskId);
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

        const fetchFilePromises = props.scenes.map((scene,i) => fetchFile(`${blobUri}/videos/${props.title}/${props.title}_${i}.wav?${blobSasToken}`));
        const fetchedFiles = await Promise.all(fetchFilePromises);
        const ffmpegWriteAudioPromises = props.scenes.map((scene, i) => {
            ffmpegParams.push("-i", `audio_${i}.wav`);
            return ffmpeg.writeFile(`audio_${i}.wav`, fetchedFiles[i])
        });
        await Promise.all(ffmpegWriteAudioPromises);

        var filterComplexPart1 = "";
        var filterComplexPart2 = "[0]";
        props.scenes.forEach((scene, i) => {
            const delayMs = timeToSeconds(scene.startTime) * 1000; 
            filterComplexPart1 += `[${i+1}]adelay=${delayMs}|${delayMs}[a${i}];`;
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
        let currentTime = playerRef.current!.getCurrentTime();
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
        let currentTime = state.playedSeconds;
        let descriptionTime = 0;
        for(let i = 0; i < props.scenes.length; i++) {
            const startTime = timeToSeconds(props.scenes[i].startTime);
            const endTime = timeToSeconds(props.scenes[i].endTime);
            if (currentTime >= startTime &&  currentTime <= endTime) {
                descriptionTime = startTime;
            }
        }
        if (descriptionTime - props.lastReadTime > 0.1) {
            props.setLastReadTime(descriptionTime);
            readDescription(props.scenes);
        }
    }

    return (
        <>
            <UploadVideoDialog 
                openUploadDialog={openUploadDialog} 
                setOpenUploadDialog={setOpenUploadDialog}
                resetState={resetState}
                title={props.title}
                setTitle={props.setTitle}
                videoUrl={videoUrl}
                setVideoUrl={setVideoUrl} 
                setScenes={props.setScenes}
                setDescriptionAvailable={props.setDescriptionAvailable}
                scenes={props.scenes}
                setAudioObjects={props.setAudioObjects}
                setOpenProcessDialog={setOpenProcessVideoDialog} 
                metadata={metadata}
                setMetadata={setMetadata}
                narrationStyle={narrationStyle}
                setNarrationStyle={setNarrationStyle}
                setTaskId={setTaskId}
                setVideoUploaded={setVideoUploaded}/>
            <ProcessVideoDialog
                openProcessDialog={openProcessVideoDialog}
                title={props.title}
                metadata={metadata}
                narrationStyle={narrationStyle}
                taskId={taskId}
                videoUrl={videoUrl}
                setScenes={props.setScenes}
                setAudioObjects={props.setAudioObjects}
                setDescriptionAvailable={props.setDescriptionAvailable}
                setVideoUrl={setVideoUrl}
                setOpenProcessDialog={setOpenProcessVideoDialog}
                scenes={props.scenes} 
                shouldContinueWithoutAsking={videoUploaded}/>
            <Dialog open={isPreparingForDownload} modalType="modal">
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Downloading...</DialogTitle>
                        <DialogContent>
                            <div style={{'marginTop':'20px'}}>
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
                { props.videoListLoading 
                ? <div style = {{maxWidth: '20vw'}}><Field validationMessage={"Loading..."} validationState="none"><ProgressBar /></Field></div>
                : props.allVideos.length === 0 ? <p>No videos available. Please upload a new video</p> : <ul>
                {props.allVideos.map((video, i) => {
                        return <li><button className="button-link" onClick={() => loadVideoFromList(video)}>{getVideoName(video.videoUrl)}</button></li>
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
                </div>
                <ReactPlayer width={playerWidth} height={playerHeight} onProgress={onProgress} ref={playerRef} url={videoUrl} playing={props.videoPlaying} onEnded={handleStopClick} onReady={handleOnReady} />
                <p>{currentDescription}</p>
            </div>
        </>
    );
};