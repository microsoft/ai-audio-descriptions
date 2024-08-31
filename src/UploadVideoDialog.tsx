import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Label, ProgressBar, makeStyles } from "@fluentui/react-components"
import {  UploadDialogProps, VideoDetails } from "./Models";
import { uploadToBlob } from "./helpers/BlobHelper";
import React from "react";
import { createVideoAnalysisTask } from "./helpers/VideoAnalysisHelper";

export const useStyles = makeStyles({
    content: {
      display: "flex",
      flexDirection: "column",
      rowGap: "10px",
    },
  });
  
export const UploadVideoDialog = (props: UploadDialogProps) => {
    const styles = useStyles();
    const [showForm, setShowForm] = React.useState(true);
    const [uploading, setUploading] = React.useState(false);
    const [uploadPercentage, setUploadPercentage] = React.useState(0);
    const [file, setFile] = React.useState<File>();

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => { 
        setFile(event.target.files![0]);
    };

    const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        props.setTitle(event.target.value);
    }

    const handleMetadataChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        props.setMetadata(event.target.value);
    }

    const handleNarrationStyleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        props.setNarrationStyle(event.target.value);
    }

    const resetFormState = () => {
        setShowForm(true);
        setUploadPercentage(0);
    }

    const handleUpload = async () => {
        if (!file) {
            alert("File is not selected");
            return;
        }
        if (props.title === '') {
            alert("Title is not specified");
            return;
        }
    
        setShowForm(false);
        props.resetState();
        setUploading(true);
        const blobUrl = await uploadToBlob(file!, props.title, props.title + ".mp4", setUploadPercentage);
        const videoAnalysisResult = await createVideoAnalysisTask(blobUrl, props.title, props.metadata, props.narrationStyle);
        props.setTaskId(videoAnalysisResult.name);
        const videoDetails: VideoDetails = { title: props.title, metadata: props.metadata, narrationStyle: props.narrationStyle, taskId: videoAnalysisResult.name };
        await uploadToBlob(JSON.stringify(videoDetails), props.title, "details.json", null);
        setUploading(false);
        resetFormState();
        props.setVideoUrl(blobUrl);
        props.setOpenUploadDialog(false);
        props.setOpenProcessDialog(true);
        props.setVideoUploaded(true);
    }
    
    return <>
        <Dialog open={props.openUploadDialog} modalType="modal">
            <DialogSurface>
                { showForm && <DialogBody>
                    <DialogTitle>Upload a new video for generating audio description</DialogTitle>
                    <DialogContent className={styles.content}>
                        <Label htmlFor={"select-file"} required>
                            Select an mp4 file
                        </Label>
                        <input required type="file" id={"select-file"} onChange={handleFileSelect}/>
                        <Label required htmlFor={"file-name"}>
                            Title (a friendly name/title for the file without extension)
                        </Label>
                        <Input required type="text" id={"file-name"} onChange={handleTitleChange}/>
                        <Label htmlFor={"file-metadata"}>
                            Metadata (optional)
                        </Label>
                        <Input type="text" id={"file-metadata"} onChange={handleMetadataChange}/>
                        <Label htmlFor={"narration-style"}>
                            Narration style (optional)
                        </Label>
                        <Input type="text" id={"narration-style"} onChange={handleNarrationStyleChange} defaultValue={props.narrationStyle}/>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={() => props.setOpenUploadDialog(false)}>Cancel</Button>
                        <Button type="submit" appearance="primary" onClick={handleUpload}>Upload</Button>
                    </DialogActions>
                </DialogBody>}
                {uploading && <DialogBody>
                    <DialogTitle>Uploading...</DialogTitle>
                    <DialogContent>
                        <h3>{uploadPercentage} %</h3>
                        <ProgressBar value={uploadPercentage/100.0} />
                    </DialogContent>
                </DialogBody>}
            </DialogSurface>
        </Dialog>
    </>
}