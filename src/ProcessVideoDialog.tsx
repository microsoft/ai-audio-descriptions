import { ProcessVideoDialogProps } from "./Models";
import React, { useEffect } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, ProgressBar } from "@fluentui/react-components";
import { getAudioDescriptionsFromVideoAnalysisResult, getVideoAnalysisTask } from "./helpers/VideoAnalysisHelper";
import { uploadToBlob } from "./helpers/BlobHelper";
import { generateAudioFiles, loadAudioFilesIntoMemory } from "./helpers/TtsHelper";

export const ProcessVideoDialog = (props: ProcessVideoDialogProps) => {
    const [showForm, setShowForm] = React.useState(true);
    const [videoProcessing, setVideoProcessing] = React.useState(false);
    const [rewritingDescriptions, setRewritingDescriptions] = React.useState(false);
    const [generatingAudio, setGeneratingAudio] = React.useState(false);
    const [loadingAudio, setLoadingAudio] = React.useState(false);
    const [numberOfAudioFilesGenerated, setNumberOfAudioFilesGenerated] = React.useState(0);
    const [videoProcessingProgress, setVideoProcessingProgress] = React.useState(0);

    const resetFormState = () => {
        setVideoProcessing(false);
        setShowForm(true);
        setGeneratingAudio(false);
        setLoadingAudio(false);
        setRewritingDescriptions(false);
        setNumberOfAudioFilesGenerated(0);
    }

    const handleContinue = async () => {
        setShowForm(false);
        setVideoProcessing(true);
        while (true) {
            let task = await getVideoAnalysisTask(props.taskId);
            if (task.status === 'completed') {
                setVideoProcessing(false);
                setRewritingDescriptions(true);
                await uploadToBlob(JSON.stringify(task.taskResult), props.title, "video-analysis-result.json", null);
                const audioDescriptions = await getAudioDescriptionsFromVideoAnalysisResult(task.taskResult, props.title, props.metadata, props.narrationStyle);
                props.setScenes(audioDescriptions);
                await uploadToBlob(JSON.stringify(audioDescriptions), props.title, props.title + ".json", null);
                setGeneratingAudio(true);
                setRewritingDescriptions(false);
                await generateAudioFiles(audioDescriptions, props.title, setNumberOfAudioFilesGenerated);
                setGeneratingAudio(false);
                setLoadingAudio(true);
                props.setDescriptionAvailable(true);
                await loadAudioFilesIntoMemory(props.title, audioDescriptions, props.setAudioObjects);
                setLoadingAudio(false);
                break;
            }
            if (task && task.taskResult && task.taskResult.videoSegments && task.taskResult.metadata) {
                setVideoProcessingProgress(Math.round(task.taskResult.videoSegments.length * 100 / task.taskResult.metadata.totalSegments));
            }
            if (task.status === 'failed') {
                break;
            }
            await new Promise(r => setTimeout(r, 15000));
        }
        resetFormState();
        props.setVideoUrl(props.videoUrl);
        props.setOpenProcessDialog(false);
    }

    useEffect(() => {
        if (props.shouldContinueWithoutAsking) {
            handleContinue();
        }
    }, [props.shouldContinueWithoutAsking]);

    return <>
    <Dialog open={props.openProcessDialog} modalType="modal">
        <DialogSurface>
            { showForm && <DialogBody>
                <DialogTitle>Do you wish to continue processing this video?</DialogTitle>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                    <Button type="submit" appearance="primary" onClick={handleContinue}>Yes</Button>
                </DialogActions>
            </DialogBody>}
            {videoProcessing && <DialogBody>
                <DialogTitle>Waiting for video to be processed</DialogTitle>
                <DialogContent>
                    <p>This can take several minutes depending on the length of the video</p>
                    {<Field validationMessage={`Video processing ${videoProcessingProgress}% complete`} validationState="none"><ProgressBar max={100} value={videoProcessingProgress} /></Field>}
                </DialogContent>
            </DialogBody>}
            {rewritingDescriptions && <DialogBody>
                <DialogTitle>Rewriting descriptions to fit silent intervals</DialogTitle>
                <DialogContent>
                    {<ProgressBar />}
                </DialogContent>
            </DialogBody>}
            {generatingAudio && <DialogBody>
                <DialogTitle>Generating audio</DialogTitle>
                <DialogContent>
                    <Field validationMessage={`Audio files generated:  ${numberOfAudioFilesGenerated} of ${props.scenes.length}`} validationState="none">
                        <ProgressBar max={props.scenes.length} value={numberOfAudioFilesGenerated}/>
                    </Field>
                </DialogContent>
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