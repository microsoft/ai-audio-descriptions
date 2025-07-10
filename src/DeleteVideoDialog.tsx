import React, { useEffect, useState } from "react";
import { SavedVideoResult } from "./Models";
import { getVideoName } from "./helpers/Helper";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";

const DeleteVideoDialog = (props: {
    video: SavedVideoResult,
    onVideoDelete: (videoFileBlobPrefix: string) => void
}) => {
    const [videoName, setVideoName] = useState("");
    const [deleteVideoAriaLabel, setDeleteVideoAriaLabel] = useState("");
    const [deleteVideoMessage, setDeleteVideoMessage] = useState("");

    useEffect(() => {
        if (props.video && props.video.videoUrl) {
            const videoName = getVideoName(props.video.videoUrl);
            setVideoName(videoName);
            setDeleteVideoAriaLabel("Delete " + videoName);
            setDeleteVideoMessage("Are you sure you want to delete video file " + videoName + " and its video description result files?");
        }
    }, [props.video]
    );

    return (
        <>
            <Dialog>
                <DialogTrigger disableButtonEnhancement>
                    <Button aria-label={deleteVideoAriaLabel} appearance={"primary"} icon={<DeleteRegular />}>Delete</Button>
                </DialogTrigger>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle tabIndex={0} aria-label={deleteVideoAriaLabel}>{deleteVideoAriaLabel}</DialogTitle>
                        <DialogContent tabIndex={0} aria-label={deleteVideoMessage}>
                            {deleteVideoMessage}
                        </DialogContent>
                        <DialogActions>
                            <DialogTrigger disableButtonEnhancement>
                                <Button aria-label="Cancel delete" appearance="secondary">Cancel</Button>
                            </DialogTrigger>
                            <Button
                                aria-label={"Continue to delete " + videoName}
                                appearance="primary"
                                onClick={() => { props.onVideoDelete(props.video.prefix) }}>
                                OK
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </>
    );
};

export default DeleteVideoDialog;