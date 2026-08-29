import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Label, ProgressBar, makeStyles } from "@fluentui/react-components"
import { UploadDialogProps } from "./Models";
import { uploadVideo } from "./api";
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
    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        setFile(event.target.files![0]);
    };

    const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setTitle(event.target.value);
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
            const video = await uploadVideo(title, file, setUploadPercentage);
            props.onVideoUploaded(video);
        }
        catch (error) {
            setUploadErrorMessage(
                error instanceof Error ? error.message : "Failed to upload.",
            );
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