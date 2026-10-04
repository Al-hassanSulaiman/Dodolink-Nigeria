import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import { asset, EASE, SceneShell } from '../film';

export function Scene5() {
  const [handoff, setHandoff] = useState(false);
  useSceneTimer([{ time: 4250, callback: () => setHandoff(true) }]);
  return (
    <SceneShell className="scene-join" label="Join DodoLink">
      <motion.img className="final-icon" src={asset('dodolink-icon.png')} alt="DodoLink NG"
        initial={{ scale: 0.72, rotate: -5 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ duration: 0.65, ease: EASE }} />
      <motion.h2 className="final-brand" initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
        DodoLink NG
      </motion.h2>
      <motion.p className="final-words" initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.4, ease: EASE }}>
        Find. Connect. Grow.
      </motion.p>
      <motion.p className="play-invitation" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 1.3, duration: 0.4 }}>Download on Google Play</motion.p>
      <motion.div className="qr-lockup" initial={{ opacity: 0, scale: 0.93 }}
        animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.6, duration: 0.45, ease: EASE }}>
        <img src={asset('google-play-qr.svg')} alt="Scan to download DodoLink from Google Play" />
        <span>Scan to join</span>
      </motion.div>
      <motion.p className="final-website" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 2.0, duration: 0.4 }}>dodolink.com.ng</motion.p>
      <motion.p className="founder-credit" initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.4, duration: 0.45 }}>
        By Al-Hassan Sulaiman
      </motion.p>
      <motion.div className="final-loop-band loop-left"
        animate={{ x: handoff ? '-15%' : '-100%' }} transition={{ duration: 1, ease: EASE }} />
      <motion.div className="final-loop-band loop-right"
        animate={{ x: handoff ? '15%' : '100%' }} transition={{ duration: 1, ease: EASE }} />
    </SceneShell>
  );
}