import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";
import { DescriptionTableProps, Segment } from "./Models"
import React from "react"
import { generateAudioFiles, loadAudioFilesIntoMemory } from "./helpers/TtsHelper";
import { uploadToBlob } from "./helpers/BlobHelper";
import { timeToSeconds } from "./helpers/Helper";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, ProgressBar } from "@fluentui/react-components";

export const DescriptionTable: React.FC<DescriptionTableProps> = (props) => {
    const rows = props.scenes;
    const setRows = props.setScenes;
    const [isEdit, setEdit] = React.useState(false);
    const [disableSave, setDisableSave] = React.useState(true);
    const [showConfirmSave, setShowConfirmSave] = React.useState(false);
    const [rowsBackup, setRowsBackup] = React.useState<string>("");
    const [showAudioGenerateSpinner, setShowAudioGenerateSpinner] = React.useState(false);
    const [numberOfAudioFilesGenerated, setNumberOfAudioFilesGenerated] = React.useState(0);
    console.log(rows);

    const handleEdit = () => {
        setRowsBackup(JSON.stringify([...rows]));
        setDisableSave(false);
        setEdit(true);
    };

    const handleAdd = () => {
        handleEdit();
        const newRow: Segment = {
            startTime: "00:00:00",
            endTime: "00:00:00",
            description: ""
        };
        setRows([newRow, ...rows ]);
    }

    const handleCancel = () => {
        setRows(JSON.parse(rowsBackup));
        setEdit(!isEdit);
        setDisableSave(true);
    }

    const regenerateAudioFiles = async (currentRows: Segment[]) : Promise<void> => {
        props.setDescriptionAvailable(false);
        await generateAudioFiles(currentRows, props.title, setNumberOfAudioFilesGenerated);
        props.setScenes(currentRows);
        props.setDescriptionAvailable(true);
        await loadAudioFilesIntoMemory(props.title, currentRows, props.setAudioObjects);
        await regenerateJsonFile(currentRows);
    }

    const regenerateJsonFile = async (currentRows: Segment[]) => {
        await uploadToBlob(JSON.stringify(currentRows), props.title, props.title + ".json", null);
    }

    const handleInputChange = (e: any, index: number) => {
        setDisableSave(false);
        const { name, value } = e.target;
        const list = [...rows];
        list[index][name as keyof Segment] = value;
        setRows(list);
    };

    const handleRemoveClick = (i: number) => {
        const list = [...rows];
        list.splice(i, 1);
        setRows(list);
    };

    const handleConfirmSave = () => {
        setShowConfirmSave(true);
    }

    const handleSaveNo = () => {
        setShowConfirmSave(false);
        handleCancel();
    };

    const handleSaveYes = async () => {
        setEdit(!isEdit);
        rows.sort((a, b) => timeToSeconds(a.startTime) - timeToSeconds(b.startTime));
        setRows(rows);
        console.log("saved : ", rows);
        setDisableSave(true);
        setShowAudioGenerateSpinner(true);
        await regenerateAudioFiles(rows);
        setShowAudioGenerateSpinner(false);
        setShowConfirmSave(false);
    };

    if (rows.length === 0) {
        return <></>;
    }

    return (
        <>
        {showConfirmSave && (
            <div>
                <Dialog open={true}>
                    <DialogSurface>
                        <DialogBody>
                            {showAudioGenerateSpinner && (<>
                                <DialogTitle>{"Regenerating audio files..."}</DialogTitle>
                                <DialogContent>
                                    <Field validationMessage={`Audio files generated:  ${numberOfAudioFilesGenerated} of ${rows.length}`} validationState="none">
                                        <ProgressBar value={numberOfAudioFilesGenerated} max={rows.length} />
                                    </Field>
                                </DialogContent>
                            </>)}
                            {!showAudioGenerateSpinner && (<>
                                <DialogTitle>{"Confirm Save"}</DialogTitle>
                                <DialogContent>Are you sure you want to save the changes? This will regenerate all audio files.</DialogContent>
                                <DialogActions>
                                    <Button onClick={handleSaveYes} appearance="primary">Yes</Button>
                                    <Button onClick={handleSaveNo}>No</Button>
                                </DialogActions>
                                </>
                            )}
                            
                        </DialogBody>
                    </DialogSurface>
                    
                </Dialog>
            </div>
        )}
        <div className='half'>
            <h2>Audio Descriptions</h2>
            {!props.descriptionAvailable ? (<>Loading...</>) : (
            <>
                <div style={{ display: "flex", marginBottom: "20px" }}>
                    {!isEdit && <div className="ad-editor-button">
                        <Button onClick={handleEdit} appearance="primary">Edit</Button>
                    </div>}
                    {isEdit && <div className="ad-editor-button">
                        <Button onClick={handleCancel} appearance="secondary">Cancel</Button>
                    </div>}
                    <div className="ad-editor-button">
                        {<Button onClick={handleAdd} appearance="primary">Add</Button>}
                    </div>
                    <div className="ad-editor-button">
                        {rows.length !== 0 && <Button onClick={handleConfirmSave} appearance="primary" disabledFocusable={disableSave}>Save</Button>}
                    </div>
                </div>
                <>
                <TableContainer style={{maxHeight : "80vh"}}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Start time (s)</TableCell>
                                <TableCell>End time (s)</TableCell>
                                <TableCell>Description</TableCell>
                                {isEdit && <TableCell>Action</TableCell>}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row, i) => {
                                return (
                                    <TableRow key={i + ''}>
                                        {isEdit ? (
                                            <>
                                                <TableCell>
                                                        <input name="startTime" value={row.startTime} size={10} onChange={(e) => handleInputChange(e, i)} />
                                                </TableCell>
                                                <TableCell>
                                                        <input name="endTime" value={row.endTime} size={10} onChange={(e) => handleInputChange(e, i)} />
                                                </TableCell>
                                                <TableCell>
                                                        <textarea name="description" cols={30} rows = {row.description.length / 30 + 1} value={row.description} onChange={(e) => handleInputChange(e, i)} />
                                                </TableCell>
                                                <TableCell>
                                                        <button aria-label="Delete" id={i+''} onClick={(ev) => handleRemoveClick((ev.target as any).id)}>Delete</button>
                                                </TableCell>
                                            </>
                                        ) : (
                                            <>
                                                <TableCell>{row.startTime}</TableCell>
                                                <TableCell>{row.endTime}</TableCell>
                                                <TableCell>{row.description}</TableCell>
                                            </>
                                        )}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
                </>
            </>
            )}
        </div>
        </>
    );
}