import React from 'react';
import './App.css';
import { Segment, VideoSummary } from './Models';
import { DescriptionTable } from './DescriptionTable';
import { VideoPlayer } from './VideoPlayer';
import { getVideos } from './api';

function App() {
    const [scenes, setScenes] = React.useState<Segment[]>([]);
    const [lastReadTime, setLastReadTime] = React.useState(-1);
    const [savedVideoListLoading, setSavedVideoListLoading] = React.useState(true);
    const [allVideos, setAllVideos] = React.useState<VideoSummary[]>([]);
    const [videoPlaying, setVideoPlaying] = React.useState(false);
    const [descriptionAvailable, setDescriptionAvailable] = React.useState(false);
    const [title, setTitle] = React.useState("");
    const [videoId, setVideoId] = React.useState("");
    const [audioObjects, setAudioObjects] = React.useState<HTMLAudioElement[]>([]);

    const loadAllDescribedVideos = async () => {
        let allVideos: VideoSummary[] = [];
        try {
            allVideos = await getVideos();
        }
        catch (error) {
            console.error(error);
        }
        setAllVideos(allVideos);
        setSavedVideoListLoading(false);
    }

    React.useEffect(() => {
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
        loadAllDescribedVideos();
    }, []);

    const onVideoDeleted = () => {
        loadAllDescribedVideos();
    }

    return (
        <div className="App">
            <h1>Microsoft AI Audio Descriptions</h1>
            <div className="container">
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
                        setVideoId={setVideoId}
                        videoListLoading={savedVideoListLoading}
                        audioObjects={audioObjects}
                        setAudioObjects={setAudioObjects}
                        onVideoDeleted={onVideoDeleted}
                    />
                </div>
                <div className='half'>
                    <DescriptionTable
                        scenes={scenes}
                        setScenes={setScenes}
                        descriptionAvailable={descriptionAvailable}
                        setDescriptionAvailable={setDescriptionAvailable}
                        videoId={videoId}
                        setAudioObjects={setAudioObjects}
                    />
                </div>

            </div>
        </div>
    );
}

export default App;
