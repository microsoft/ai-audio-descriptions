import React, { useEffect } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    ProgressBar,
} from "@fluentui/react-components";
import { getVideo, startVideoProcessing } from "./api";
import { ProcessVideoDialogProps, VideoResource } from "./Models";
import { loadAudioFilesIntoMemory } from "./helpers/TtsHelper";

const stageLabel = (video: VideoResource): string => {
    if (video.stage === "transcribing") {
        return "Transcribing dialogue";
    }
    if (video.stage === "detecting_shots") {
        return "Detecting shots";
    }
    if (video.stage === "describing") {
        return "Writing audio descriptions";
    }
    if (video.stage === "synthesizing") {
        return "Generating audio";
    }
    return "Preparing video";
};

export const ProcessVideoDialog = (props: ProcessVideoDialogProps) => {
    const {
        onVideoChanged,
        setAudioObjects,
        setDescriptionAvailable,
        setOpenProcessDialog,
        setScenes,
        setVideoUrl,
    } = props;
    const [video, setVideo] = React.useState(props.video);
    const [showForm, setShowForm] = React.useState(
        props.video.status === "uploaded" || props.video.status === "failed",
    );
    const [processingError, setProcessingError] = React.useState(props.video.error ?? "");
    const started = React.useRef(false);

    const monitorProcessing = React.useCallback(async () => {
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const latestVideo = await getVideo(video.id);
            setVideo(latestVideo);
            onVideoChanged(latestVideo);
            if (latestVideo.status === "failed") {
                setProcessingError(latestVideo.error ?? "Video processing failed.");
                return;
            }
            if (latestVideo.status === "ready") {
                setScenes(latestVideo.descriptions);
                setDescriptionAvailable(true);
                setVideoUrl(latestVideo.videoUrl);
                await loadAudioFilesIntoMemory(latestVideo.audioUrls, setAudioObjects);
                setOpenProcessDialog(false);
                return;
            }
        }
    }, [
        onVideoChanged,
        setAudioObjects,
        setDescriptionAvailable,
        setOpenProcessDialog,
        setScenes,
        setVideoUrl,
        video.id,
    ]);

    const handleContinue = React.useCallback(async () => {
        if (started.current) {
            return;
        }
        started.current = true;
        setShowForm(false);
        setProcessingError("");
        try {
            await startVideoProcessing(video.id);
            const processingVideo = { ...video, status: "processing", stage: "preparing" } as VideoResource;
            setVideo(processingVideo);
            onVideoChanged(processingVideo);
            await monitorProcessing();
        } catch (error) {
            setProcessingError(error instanceof Error ? error.message : "Unable to start processing.");
        }
    }, [monitorProcessing, onVideoChanged, video]);

    useEffect(() => {
        if (started.current) {
            return;
        }
        if (props.shouldContinueWithoutAsking) {
            void handleContinue();
        } else if (video.status === "processing") {
            started.current = true;
            void startVideoProcessing(video.id)
                .then(monitorProcessing)
                .catch(error => {
                    setProcessingError(
                        error instanceof Error ? error.message : "Unable to resume processing.",
                    );
                });
        }
    }, [
        handleContinue,
        monitorProcessing,
        props.shouldContinueWithoutAsking,
        video.id,
        video.status,
    ]);

    return (
        <Dialog open={true} modalType="modal">
            <DialogSurface>
                {showForm && (
                    <DialogBody>
                        <DialogTitle>Do you wish to continue processing this video?</DialogTitle>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setOpenProcessDialog(false)}>Cancel</Button>
                            <Button type="submit" appearance="primary" onClick={handleContinue}>Yes</Button>
                        </DialogActions>
                    </DialogBody>
                )}
                {!showForm && (
                    <DialogBody>
                        <DialogTitle tabIndex={0}>{stageLabel(video)}</DialogTitle>
                        <DialogContent tabIndex={0}>
                            {!processingError && video.stage !== "synthesizing" && <ProgressBar />}
                            {!processingError && video.stage === "synthesizing" && (
                                <Field
                                    validationMessage={`Audio files generated: ${video.audioGenerated} of ${video.descriptions.length}`}
                                    validationState="none">
                                    <ProgressBar
                                        max={video.descriptions.length}
                                        value={video.audioGenerated} />
                                </Field>
                            )}
                            {processingError && <p style={{ color: "red" }}>{processingError}</p>}
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setOpenProcessDialog(false)}>Close</Button>
                        </DialogActions>
                    </DialogBody>
                )}
            </DialogSurface>
        </Dialog>
    );
};
