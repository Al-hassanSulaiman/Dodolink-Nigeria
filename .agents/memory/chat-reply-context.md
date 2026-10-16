---
name: Chat replies and product context
description: User expectations for swiped replies and product-origin chat, and historical-context decisions.
---

Users must be able to drag/swipe either their own or the other person's message to reply, including photo messages. Product-origin enquiries should carry a miniature product preview and slight shadow in the same quoted-card treatment used for photo replies.

**Why:** The user explicitly requested both behaviours together and wanted product enquiries to look like a dragged photo reply.

**How to apply:** Preserve the quoted target in sent-message history, not only the composer. Keep a visible cancel action and a non-gesture reply alternative. Opening a product chat must still remain an unsent draft until the user actually sends text/media.

Quoted content is server-resolved historical context, not client-supplied display content or a live product-price join. Only one selected quote target is attached at a time; explicitly choosing a message reply replaces a pending product quote.

**Why:** A customer and seller need to retain what an enquiry referred to even if a product is edited/deleted. A forged client preview or a reference to another conversation/store must not become trusted message history.

**How to apply:** Validate participant access and reference scope before constructing the snapshot. Preserve the originally quoted product details; do not retrospectively infer product links for older messages that never recorded a reference. Keep current store-owner naming rules for quoted senders too.

Keep the browser and native reply gesture implementations distinct.

**Why:** Browser checks found that React Native Web's responder handling on nested photo buttons either missed the drag or selected the quote while also opening the photo. Moving capture earlier also interfered with text dragging. Explicit browser pointer tracking and suppression of the click after a drag resolved these behaviours; a normal photo tap still opened the viewer.

**How to apply:** Retain native gesture handling rather than assuming browser pointer events prove phone behaviour. After gesture changes, check photo drags in both directions, text dragging, normal photo taps, and vertical movement separately. A fallback Reply button alone does not satisfy the requested drag behaviour. Do not capture a video player's seek/control gestures.
