import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';
import './controls.css';

const DETAILS: Record<string, { title: string; filePath: string }> = {
  local: { title: 'Local finds', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
  discover: { title: 'Discover', filePath: 'src/components/video/video_scenes/Scene2.tsx' },
  connect: { title: 'Connect', filePath: 'src/components/video/video_scenes/Scene3.tsx' },
  sell: { title: 'Sell', filePath: 'src/components/video/video_scenes/Scene4.tsx' },
  join: { title: 'Join DodoLink', filePath: 'src/components/video/video_scenes/Scene5.tsx' },
};

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PlaybackStatus({ controls, onJump }: {
  controls: ReturnType<typeof useSceneControls>; onJump: (index: number) => void;
}) {
  const { tick, paused, activeDuration, activeStartTime, totalDuration, sceneKeys, activeIndex } = controls;
  const [elapsed, setElapsed] = useState(0);
  const elapsedBase = useRef(0);
  useEffect(() => { setElapsed(0); elapsedBase.current = 0; }, [tick]);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const timer = window.setInterval(() => setElapsed(elapsedBase.current + performance.now() - start), 60);
    return () => {
      window.clearInterval(timer);
      elapsedBase.current += performance.now() - start;
    };
  }, [tick, paused]);
  const progress = Math.min(1, elapsed / activeDuration);
  const totalElapsed = Math.min(totalDuration, activeStartTime + Math.min(elapsed, activeDuration));
  return (
    <>
      <div className="scene-segments">
        {sceneKeys.map((key, index) => (
          <button key={key} onClick={() => onJump(index)}
            aria-label={`Jump to scene ${index + 1}: ${DETAILS[key].title}`}
            aria-current={index === activeIndex ? 'true' : undefined}>
            <span style={{ width: index === activeIndex ? `${progress * 100}%` : '0%' }} />
          </button>
        ))}
      </div>
      <span className="scene-counter">{activeIndex + 1}/{sceneKeys.length}</span>
      <span className="playback-timer" role="timer"
        aria-label={`Playback time ${formatTime(totalElapsed)} of ${formatTime(totalDuration)}`}>
        {formatTime(totalElapsed)} / {formatTime(totalDuration)}
      </span>
    </>
  );
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const controls = useSceneControls(SCENE_DURATIONS);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [touchPinned, setTouchPinned] = useState(false);
  const onAutoplayBlocked = useCallback(() => setAudioBlocked(true), []);
  const onAudioReady = useCallback(() => setAudioBlocked(false), []);
  const jumpTo = useCallback((index: number) => {
    controls.jumpTo(index);
    const details = DETAILS[controls.sceneKeys[index]];
    window.parent.postMessage({
      type: 'REPLIT_VIDEO_SCENE_SELECTED',
      payload: {
        sceneIndex: index, sceneCount: controls.sceneKeys.length,
        sceneTitle: details.title, filePath: details.filePath, lineNumber: 1,
      },
    }, '*');
  }, [controls.jumpTo, controls.sceneKeys]);
  useEffect(() => {
    if (!controls.paused) return;
    const frozen = document.getAnimations().filter((animation) => animation.playState === 'running');
    frozen.forEach((animation) => animation.pause());
    return () => frozen.forEach((animation) => animation.play());
  }, [controls.paused]);

  // The exporter is a top-level page: never pass preview state into it.
  if (!isIframed) return <VideoTemplate />;
  const visible = !collapsed || hovered || touchPinned;
  return (
    <div className="video-preview-wrapper" onTouchStart={() => touchPinned && setTouchPinned(false)}>
      <VideoTemplate key={controls.mountKey} durations={controls.durations}
        paused={controls.paused} muted={muted} onSceneChange={controls.onSceneChange}
        onAutoplayBlocked={onAutoplayBlocked} onAudioReady={onAudioReady} />
      <div className="controls-sensor" onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onTouchStart={(event) => {
          event.stopPropagation();
          if (collapsed) setTouchPinned(true);
        }}>
        <div className={`film-controls ${visible ? 'controls-visible' : ''}`} aria-hidden={!visible}>
          <button onClick={controls.togglePause} aria-label={controls.paused ? 'Play' : 'Pause'}>
            {controls.paused ? <Play /> : <Pause />}
          </button>
          <button onClick={controls.toggleLock} aria-label="Loop current scene"
            aria-pressed={controls.locked}>
            <Repeat />
          </button>
          <button onClick={() => {
            if (audioBlocked) {
              const audio = document.querySelector('audio');
              audio?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
            } else setMuted((value) => !value);
          }} aria-label={audioBlocked ? 'Enable music' : muted ? 'Unmute' : 'Mute'}>
            {muted || audioBlocked ? <VolumeX /> : <Volume2 />}
          </button>
          <span className="control-divider" />
          <PlaybackStatus controls={controls} onJump={jumpTo} />
          <button aria-label={collapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!collapsed}
            onClick={() => {
              setCollapsed((value) => !value);
              setHovered(false);
              setTouchPinned(false);
            }}>
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </button>
        </div>
      </div>
    </div>
  );
}