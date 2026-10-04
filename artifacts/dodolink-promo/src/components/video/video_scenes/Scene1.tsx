import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { asset, Brand, EASE, Reveal, SceneShell } from '../film';

export function Scene1() {
  const [handoff, setHandoff] = useState(false);
  useSceneTimer([{ time: 3450, callback: () => setHandoff(true) }]);
  return (
    <SceneShell className="scene-local" label="Local finds">
      <motion.img
        className="entrepreneur"
        src={asset('family-opening-face-corrected.png')}
        alt="AI-composited portrait of Al-Hassan Sulaiman and his father"
        initial={{ scale: 1.05 }}
        animate={{ scale: handoff ? 1.08 : 1.02, x: handoff ? '2%' : 0 }}
        transition={{ duration: handoff ? 0.8 : 3.4, ease: EASE }}
      />
      <div className="portrait-shade" />
      <Brand light />
      <motion.div
        className="local-copy"
        animate={{ y: handoff ? '-3cqw' : 0 }}
        transition={{ duration: 0.75, ease: EASE }}
      >
        <Reveal delay={0.12}><h1>LOCAL FINDS.</h1></Reveal>
        <Reveal delay={0.58}><h1 className="real-word">REAL</h1></Reveal>
        <Reveal delay={1.02}><h1 className="connection-word">CONNECTIONS.</h1></Reveal>
        <motion.div className="lime-rule" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
          transition={{ delay: 2.2, duration: 0.6, ease: EASE }} />
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.65, duration: 0.5 }}>
          For buyers. For businesses.
        </motion.p>
      </motion.div>
      <motion.div className="portrait-edge edge-left"
        animate={{ scaleX: handoff ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE }} />
      <motion.div className="portrait-edge edge-right"
        animate={{ scaleX: handoff ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE }} />
    </SceneShell>
  );
}