import { useEffect, useRef, type ComponentType } from 'react';
import { AnimatePresence } from 'framer-motion';
import { VideoCanvas, VideoPausedContext, useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import './film.css';

export const SCENE_DURATIONS = {
  local: 4200,
  discover: 5000,
  connect: 4600,
  sell: 6000,
  join: 5200,
};
const VIDEO_ASPECT_RATIO = '9:16' as const;
const SCENE_COMPONENTS: Record<string, ComponentType> = {
  local: Scene1, discover: Scene2, connect: Scene3, sell: Scene4, join: Scene5,
};
const SCENE_START_SEC: Record<string, number> = (() => {
  let cumulativeMs = 0;
  return Object.fromEntries(Object.entries(SCENE_DURATIONS).map(([key, duration]) => {
    const offset = cumulativeMs / 1000;
    cumulativeMs += duration;
    return [key, offset];
  }));
})();

export default function VideoTemplate({
  durations = SCENE_DURATIONS, loop = true, paused = false, muted = false,
  onSceneChange, onAutoplayBlocked, onAudioReady,
}: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean;
  onSceneChange?: (key: string) => void; onAutoplayBlocked?: () => void; onAudioReady?: () => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const Scene = SCENE_COMPONENTS[baseSceneKey];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSceneKey = useRef<string | null>(null);
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    if (paused) { audio.pause(); return; }
    if (lastSceneKey.current !== currentSceneKey) {
      lastSceneKey.current = currentSceneKey;
      const target = SCENE_START_SEC[baseSceneKey] ?? 0;
      if (Math.abs(audio.currentTime - target) > 0.18) audio.currentTime = target;
    }
    audio.play().then(() => onAudioReady?.()).catch((error: DOMException) => {
      if (error.name === 'NotAllowedError') onAutoplayBlocked?.();
      else if (error.name !== 'AbortError') console.warn('Music playback failed:', error.name);
    });
  }, [currentSceneKey, baseSceneKey, muted, paused, onAutoplayBlocked, onAudioReady]);
  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#062B1B' }}
        data-film-scene={baseSceneKey}>
        <AnimatePresence mode="sync">
          {Scene && <Scene key={currentSceneKey} />}
        </AnimatePresence>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/calm-instrumental-mastered.mp3`}
          preload="auto" autoPlay muted={muted} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
