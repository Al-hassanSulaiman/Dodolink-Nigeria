import { useRef } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import { Animated, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/** Horizontal drags reply; vertical movement remains owned by the message list. */
export function SwipeReply({ children, onReply, onGestureReply, disabled, messageId, isMe }: {
  children: ReactNode; onReply: () => void; onGestureReply?: () => void;
  disabled: boolean; messageId: number; isMe: boolean;
}) {
  const colors = useColors();
  const offset = useRef(new Animated.Value(0)).current;
  const latest = useRef({ onReply, onGestureReply, disabled });
  latest.current = { onReply, onGestureReply, disabled };
  const pointer = useRef({ id: -1, x: 0, y: 0, dragging: false, suppressUntil: 0 });
  const reset = () => Animated.spring(offset, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start();
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      !latest.current.disabled && Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
    onMoveShouldSetPanResponder: (_, gesture) =>
      !latest.current.disabled && Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
    onPanResponderMove: (_, gesture) => offset.setValue(Math.max(-72, Math.min(72, gesture.dx))),
    onPanResponderRelease: (_, gesture) => {
      if (!latest.current.disabled && Math.abs(gesture.dx) >= 48) {
        (latest.current.onGestureReply ?? latest.current.onReply)();
      }
      reset();
    },
    onPanResponderTerminate: reset,
    onPanResponderTerminationRequest: () => true,
  })).current;
  const webDown = (event: PointerEvent<HTMLDivElement>) => {
    if (latest.current.disabled || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if ((event.target as HTMLElement).closest('video,input,textarea')) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, suppressUntil: 0 };
    // Text dragging means reply here; Copy remains available as its own button.
    // Do not prevent normal taps/focus on the photo and other action buttons.
    if (event.pointerType === 'mouse' && !(event.target as HTMLElement).closest('button,[role="button"],input,textarea,video')) {
      event.preventDefault();
    }
  };
  const webMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (start.id !== event.pointerId || latest.current.disabled) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.dragging && Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
      start.id = -1;
      return; // Leave vertical touch scrolling to the browser.
    }
    if (!start.dragging && Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      start.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.dragging) {
      event.preventDefault();
      offset.setValue(Math.max(-72, Math.min(72, dx)));
    }
  };
  const webUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (start.id !== event.pointerId) return;
    if (start.dragging) {
      start.suppressUntil = Date.now() + 500;
      event.preventDefault();
      event.stopPropagation();
      if (!latest.current.disabled && Math.abs(event.clientX - start.x) >= 48) {
        (latest.current.onGestureReply ?? latest.current.onReply)();
      }
    }
    start.id = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    reset();
  };
  const content = <Animated.View {...(Platform.OS === 'web' ? {} : pan.panHandlers)}
    style={{ transform: [{ translateX: offset }] }}>{children}</Animated.View>;
  return (
    <View testID={`swipe-message-${messageId}`} style={{ marginBottom: 8 }}>
      {Platform.OS === 'web' ? <div style={{ touchAction: 'pan-y' }}
        onPointerDownCapture={webDown} onPointerMoveCapture={webMove} onPointerUpCapture={webUp}
        onPointerCancel={() => { pointer.current.id = -1; reset(); }}
        onDragStart={event => event.preventDefault()}
        onClickCapture={event => {
          if (Date.now() < pointer.current.suppressUntil) { event.preventDefault(); event.stopPropagation(); }
        }}>{content}</div> : content}
      <Pressable accessibilityRole="button" accessibilityLabel={isMe ? 'Reply to your message' : 'Reply to message'}
        disabled={disabled} onPress={onReply}
        style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 8 }}>
        <Feather name="corner-up-left" size={13} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Reply</Text>
      </Pressable>
    </View>
  );
}
