import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Label, ProgressBar, makeStyles } from "@fluentui/react-components"
import { UploadDialogProps } from "./Models";
import { completeVideoUpload, createVideo, uploadVideo } from "./api";
import React, { useState } from "react";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        rowGap: "10px",
    },
});

export const UploadVideoDialog = (props: UploadDialogProps) => {
    const styles = useStyles();
    const { title, setTitle } = props;
    const [showForm, setShowForm] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadPercentage, setUploadPercentage] = useState(0);
    const [file, setFile] = useState<File>();
    const [uploadErrorMessage, setUploadErrorMessage] = useState('');
    const [metaData, setMetaData] = useState("");
    const [narrationStyle, setNarrationStyle] = useState("");
    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        setFile(event.target.files![0]);
    };

    const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setTitle(event.target.value);
    }

    const handleMetadataChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setMetaData(event.target.value);
    }

    const handleNarrationStyleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setNarrationStyle(event.target.value);
    }

    const resetFormState = () => {
        setUploading(false);
        setShowForm(true);
        setUploadPercentage(0);
        setUploadErrorMessage('');
    }

    const handleUpload = async () => {
        if (!file) {
            alert("File is not selected");
            return;
        }
        if (title === '') {
            alert("Title is not specified");
            return;
        }
        if (props.videos.some(video => video.title === title)) {
            alert("There is already an existing video file that has the same title, please use a different title.");
            return;
        }
        setShowForm(false);
        setUploading(true);
        try {
            const result = await createVideo(title, metaData, narrationStyle);
            await uploadVideo(result.uploadUrl, file, setUploadPercentage);
            const video = await completeVideoUpload(
                result.video.id,
                title,
                metaData,
                narrationStyle,
            );
            props.onVideoUploaded(video);
        }
        catch (e: any) {
            let errorMessage = "Failed to upload."
            if (e.statusCode === 401) {
                errorMessage += " Authentication failed."
            }
            setUploadErrorMessage(errorMessage);
            return;
        }
        setUploading(false);
        resetFormState();
    }

    const handleUploadError = () => {
        resetFormState();
        props.onVideoUploadCancelled();
    }

    return <>
        <Dialog modalType="modal" open={true}>
            <DialogSurface>
                {showForm && uploadErrorMessage == '' && <DialogBody>
                    <DialogTitle>Upload a new video for generating audio description</DialogTitle>
                    <DialogContent className={styles.content}>
                        <Label htmlFor={"select-file"} required>
                            Select an mp4 file
                        </Label>
                        <input required type="file" id={"select-file"} onChange={handleFileSelect} />
                        <Label required htmlFor={"file-name"}>
                            Title (a friendly name/title for the file without extension)
                        </Label>
                        <Input required type="text" id={"file-name"} onChange={handleTitleChange} />
                        <Label htmlFor={"file-metadata"}>
                            Context (optional) - Provide any additional informaiton about the video, such as key characters, places, or events
                        </Label>
                        <Input type="text" id={"file-metadata"} onChange={handleMetadataChange} />
                        <Label htmlFor={"narration-style"}>
                            Narration style (optional) - such as age of target audience, or things not to mention
                        </Label>
                        <Input type="text" id={"narration-style"} onChange={handleNarrationStyleChange} defaultValue={narrationStyle} />
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={() => props.onVideoUploadCancelled()}>Cancel</Button>
                        <Button type="submit" appearance="primary" onClick={handleUpload}>Upload</Button>
                    </DialogActions>
                </DialogBody>}
                {uploading && <DialogBody>
                    {uploadErrorMessage === ''
                        ?
                        <>
                            <DialogTitle>Uploading...</DialogTitle>
                            <DialogContent>
                                <h3>{uploadPercentage} %</h3>
                                <ProgressBar value={uploadPercentage / 100.0} />
                            </DialogContent>
                        </>
                        :
                        <>
                            <DialogTitle>Upload failed</DialogTitle>
                            <DialogContent>{uploadErrorMessage}</DialogContent>
                            <DialogActions><Button appearance="primary" onClick={() => handleUploadError()}>Ok</Button></DialogActions>
                        </>
                    }
                </DialogBody>}
            </DialogSurface>
        </Dialog>
    </>
}