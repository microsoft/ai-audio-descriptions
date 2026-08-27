import { VideoSummary } from "./Models";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";

const DeleteVideoDialog = (props: {
    video: VideoSummary,
    onVideoDelete: (id: string) => void
}) => {
    const videoName = props.video.title;
    const deleteVideoAriaLabel = "Delete " + videoName;
    const deleteVideoMessage = "Are you sure you want to delete video file " + videoName + " and its video description result files?";

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
                                onClick={() => { props.onVideoDelete(props.video.id) }}>
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