import React from 'react';
import './App.css';
import { SavedVideoResult, Segment } from './Models';
import { DescriptionTable } from './DescriptionTable';
import { VideoPlayer } from './VideoPlayer';
import { getAllUploadedVideos } from './helpers/BlobHelper';

function App() {
    const [scenes, setScenes] = React.useState<Segment[]>([]);
    const [lastReadTime, setLastReadTime] = React.useState(-1);
    const [savedVideoListLoading, setSavedVideoListLoading] = React.useState(true);
    const [allVideos, setAllVideos] = React.useState<SavedVideoResult[]>([]);
    const [videoPlaying, setVideoPlaying] = React.useState(false);
    const [descriptionAvailable, setDescriptionAvailable] = React.useState(false);
    const [title, setTitle] = React.useState("");
    const [audioObjects, setAudioObjects] = React.useState<HTMLAudioElement[]>([]);

    const loadAllDescribedVideos = async () => {
        const allVideos = await getAllUploadedVideos();
        setAllVideos(allVideos);
        setSavedVideoListLoading(false);
    }
    
    React.useEffect(() => {
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
        loadAllDescribedVideos();
    }, []);
    
    return (
        <div className="App">
            <div className='half'>
                <VideoPlayer 
                    scenes={scenes}
                    setScenes={setScenes}
                    lastReadTime={lastReadTime}
                    setLastReadTime={setLastReadTime}
                    allVideos={allVideos}
                    videoPlaying={videoPlaying}
                    setVideoPlaying={setVideoPlaying}
                    descriptionAvailable={descriptionAvailable}
                    setDescriptionAvailable={setDescriptionAvailable}
                    title={title}
                    setTitle={setTitle}
                    videoListLoading={savedVideoListLoading}
                    audioObjects={audioObjects}
                    setAudioObjects={setAudioObjects}
                />
            </div>
            <div className='half'>
                <DescriptionTable 
                    scenes={scenes}
                    setScenes={setScenes}
                    descriptionAvailable={descriptionAvailable}
                    setDescriptionAvailable={setDescriptionAvailable}
                    title={title}
                    setAudioObjects={setAudioObjects}
                />
            </div>
        </div>
    );
}

export default App;
