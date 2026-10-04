import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, MessageCircle, Store } from 'lucide-react';
import { useSceneTimer } from '@/lib/video';
import { Brand, EASE, Reveal, SceneShell } from '../film';

const messages = [
  { text: 'Is this available?', incoming: false, delay: 0.7 },
  { text: "Yes! Let's talk.", incoming: true, delay: 1.65 },
  { text: 'Great, thank you.', incoming: false, delay: 2.55 },
];

export function Scene3() {
  const [handoff, setHandoff] = useState(false);
  useSceneTimer([{ time: 3750, callback: () => setHandoff(true) }]);
  return (
    <SceneShell className="scene-connect" label="Chat directly">
      <Brand light />
      <div className="connect-copy">
        <Reveal delay={0.15}><h2>Less guessing.</h2></Reveal>
        <Reveal delay={0.65}><h2 className="lime-text">More talking.</h2></Reveal>
        <motion.p className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 1 }}>CHAT DIRECTLY WITH SELLERS</motion.p>
      </div>
      <motion.div className="connection-ring" initial={{ scale: 0.7 }}
        animate={{ scale: handoff ? 2.1 : 1, rotate: 35 }}
        transition={{ duration: handoff ? 0.9 : 3.6, ease: EASE }} />
      <motion.div className="chat-panel"
        initial={{ scale: 1.25, rotate: -4, y: 20 }}
        animate={{ scale: handoff ? 1.08 : 1, rotate: handoff ? -4 : 0, y: 0 }}
        transition={{ duration: handoff ? 0.8 : 0.65, ease: EASE }}>
        <div className="chat-person">
          <div className="seller-avatar"><Store /></div>
          <div><strong>Local seller</strong><span>Connect on DodoLink</span></div>
          <MessageCircle className="chat-symbol" />
        </div>
        <div className="message-list">
          {messages.map((message, index) => (
            <motion.div key={message.text}
              className={`message ${message.incoming ? 'incoming' : 'outgoing'}`}
              initial={{ scale: 0.7, opacity: 0, y: 14 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ delay: message.delay, type: 'spring', stiffness: 350, damping: 25 }}>
              {message.text}
              {!message.incoming && <span className="message-check"><Check /><Check /></span>}
              <span className="message-order">{index + 1}</span>
            </motion.div>
          ))}
        </div>
        <p className="illustration-label">Illustrative conversation</p>
      </motion.div>
    </SceneShell>
  );
}