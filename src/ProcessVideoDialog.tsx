import { ProcessVideoDialogProps } from "./Models";
import React, { useEffect } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, ProgressBar } from "@fluentui/react-components";
import { uploadToBlob } from "./helpers/BlobHelper";
import { generateAudioFiles, loadAudioFilesIntoMemory } from "./helpers/TtsHelper";
import { getAnalyzeTaskInProgress, getAudioDescriptionsFromAnalyzeResult } from "./helpers/ContentUnderstandingHelper";

export const ProcessVideoDialog = (props: ProcessVideoDialogProps) => {
    const { title, metadata, narrationStyle, taskId, analyzerId, videoUrl } = props.videoDetails;
    const [showForm, setShowForm] = React.useState(true);
    const [videoProcessing, setVideoProcessing] = React.useState(false);
    const [rewritingDescriptions, setRewritingDescriptions] = React.useState(false);
    const [generatingAudio, setGeneratingAudio] = React.useState(false);
    const [loadingAudio, setLoadingAudio] = React.useState(false);
    const [numberOfAudioFilesGenerated, setNumberOfAudioFilesGenerated] = React.useState(0);
    const [processingError, setProcessingError] = React.useState("");

    const resetFormState = () => {
        setVideoProcessing(false);
        setShowForm(true);
        setGeneratingAudio(false);
        setLoadingAudio(false);
        setRewritingDescriptions(false);
        setNumberOfAudioFilesGenerated(0);
    }

    const handleContinue = async () => {
        if(!taskId || !analyzerId) {
            return;
        };

        setShowForm(false);
        setVideoProcessing(true);
        while (true) {
            const task = await getAnalyzeTaskInProgress(analyzerId, taskId);
            if (task.status?.toLowerCase() === "succeeded") {
                setVideoProcessing(false);
                setRewritingDescriptions(true);
                const audioDescriptions = await getAudioDescriptionsFromAnalyzeResult(task.result.contents, title, metadata, narrationStyle);
                props.setScenes(audioDescriptions);
                await uploadToBlob(JSON.stringify(audioDescriptions), title, title + ".json", null);
                setGeneratingAudio(true);
                setRewritingDescriptions(false);
                await generateAudioFiles(audioDescriptions, title, setNumberOfAudioFilesGenerated);
                setGeneratingAudio(false);
                setLoadingAudio(true);
                props.setDescriptionAvailable(true);
                await loadAudioFilesIntoMemory(title, audioDescriptions, props.setAudioObjects);
                setLoadingAudio(false);
                break;
            }
            const errorTask = task as any;
            if (errorTask.error) {
                const message = errorTask.error?.message || "An error occurred while processing the video";
                setProcessingError(message);
                break;
            }

            await new Promise(r => setTimeout(r, 15000));
            setProcessingError("");
        }
        resetFormState();
        props.setVideoUrl(videoUrl);
        props.onVideoProcessed(title);
        props.setOpenProcessDialog(false);
    }

    useEffect(() => {
        if (props.shouldContinueWithoutAsking) {
            handleContinue();
        }
    }, [props.shouldContinueWithoutAsking]);

    return <>
    <Dialog open={true} modalType="modal">
        <DialogSurface>
            { showForm && <DialogBody>
                <DialogTitle>Do you wish to continue processing this video?</DialogTitle>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                    <Button type="submit" appearance="primary" onClick={handleContinue}>Yes</Button>
                </DialogActions>
            </DialogBody>}
            {videoProcessing && <DialogBody>
                <DialogTitle tabIndex={0}>Processing Video</DialogTitle>
                <DialogContent tabIndex={0}>
                    {<ProgressBar title="This can take several minutes depending on the length of the video" />}
                    {processingError && <p style={{color: "red"}}>{processingError}</p>}
                </DialogContent>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                </DialogActions>
            </DialogBody>}
            {rewritingDescriptions && <DialogBody>
                <DialogTitle>Rewriting descriptions to fit silent intervals</DialogTitle>
                <DialogContent>
                    {<ProgressBar />}
                </DialogContent>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                </DialogActions>
            </DialogBody>}
            {generatingAudio && <DialogBody>
                <DialogTitle>Generating audio</DialogTitle>
                <DialogContent>
                    <Field validationMessage={`Audio files generated:  ${numberOfAudioFilesGenerated} of ${props.scenes.length}`} validationState="none">
                        <ProgressBar max={props.scenes.length} value={numberOfAudioFilesGenerated}/>
                    </Field>
                </DialogContent>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                </DialogActions>
            </DialogBody>}
            {loadingAudio && <DialogBody>
                <DialogTitle>Preparing video player...</DialogTitle>
                <DialogContent>
                    <ProgressBar />
                </DialogContent>
            </DialogBody>}
        </DialogSurface>
    </Dialog>
</>
}